// Procedural animation for the cartoon characters.
//
// Each frame we build target poses (flat Float32Arrays of joint channels)
// for the active states, crossfade them by smoothly-changing weights, layer
// one-shot overlays (land squash, jump stretch, the double-jump somersault),
// add look-at / glances / blinking / expressions and write the result to the
// rig's TransformNodes. Grounded legs use 2-bone IK against foot targets that
// travel exactly with the gait phase, so planted feet don't slide.

import { clamp, lerp, smoothstep, TAU } from "./geometry.js";

// ---- pose channels ---------------------------------------------------------
const CH = [
  "HIPS_PX", "HIPS_PY", "HIPS_PZ", "HIPS_X", "HIPS_Y", "HIPS_Z",
  "SPINE_X", "SPINE_Y", "SPINE_Z", "HEAD_X", "HEAD_Y", "HEAD_Z",
  "SHL_X", "SHL_Y", "SHL_Z", "ELL_X", "ELL_Y", "ELL_Z",
  "SHR_X", "SHR_Y", "SHR_Z", "ELR_X", "ELR_Y", "ELR_Z",
  "THL_X", "THL_Y", "THL_Z", "KNL_X", "ANL_X", "ANL_Z",
  "THR_X", "THR_Y", "THR_Z", "KNR_X", "ANR_X", "ANR_Z",
];
const C = Object.fromEntries(CH.map((k, i) => [k, i]));
const NCH = CH.length;
/** Channels the "wave" overlay owns. */
const WAVE_MASK = [C.SHR_X, C.SHR_Y, C.SHR_Z, C.ELR_X, C.ELR_Y, C.ELR_Z, C.HEAD_X, C.HEAD_Z, C.SPINE_Z];
/** Channels the somersault tuck overrides (everything but the hips offset). */
const TUCK_FROM = C.HIPS_X;

const STATES = new Set(["idle", "walk", "run", "jump", "doubleJump", "fall", "land", "wave"]);
const AIR = new Set(["jump", "doubleJump", "fall"]);
const NOMINAL_SPEED = { idle: 0, walk: 1.6, run: 6.6, land: 0, wave: 0 };

const FLIP_TIME = 0.45;
const LID_OPEN = -0.96;
const LID_CLOSED = 0.62;

const SIDES = [-1, 1];

const approach = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/** Damped spring step for secondary motion; returns the new angle. */
function spring(sp, k, damp, target, dt) {
  sp.v += (k * (target - sp.a) - damp * sp.v) * dt;
  sp.a = clamp(sp.a + sp.v * dt, -0.8, 1.1);
  if (!Number.isFinite(sp.a) || !Number.isFinite(sp.v)) {
    sp.a = 0;
    sp.v = 0;
  }
  return sp.a;
}

export class Animator {
  /**
   * @param {import("@babylonjs/core").TransformNode} root
   * @param {object} rig   from buildRig (nodes, rest)
   * @param {object} dims  from makeDims
   * @param {() => number} rng  seeded random
   * @param {number} scale  overall body scale
   */
  constructor(root, rig, dims, rng, scale) {
    this.root = root;
    this.n = rig.nodes;
    this.rest = rig.rest;
    this.d = dims;
    this.rng = rng;
    this.scale = scale;
    this.state = "idle";
    this.stateT = 0;
    this.time = rng() * 50;
    this.shiftPhase = rng() * TAU;
    this.w = { ground: 1, jump: 0, fall: 0, wave: 0 };
    this.phase = rng();
    this.speedSm = 0;
    this.accel = 0;
    this.landT = -1;
    this.landAmp = 1;
    this.jumpT = -1;
    /** Optional callback(side) when a foot plants while walking/running (-1 left, +1 right). */
    this.onStep = null;
    this.flipT = -1;
    this.crouch = 0;
    this.blinkWait = 0.8 + rng() * 2.5;
    this.blinkT = -1;
    this.blinkAgain = false;
    this.glanceWait = 2 + rng() * 3;
    this.glanceAway = false;
    this.glanceYawT = 0;
    this.glancePitchT = 0;
    this.glanceYaw = 0;
    this.glancePitch = 0;
    this.lookTarget = null;
    this.lookW = 0;
    this.lookYaw = 0;
    this.lookPitch = 0;
    this.lookYawT = 0;
    this.lookPitchT = 0;
    this.lookActive = false;
    this.eyeYaw = 0;
    this.eyePitch = 0;
    this.mouth = 0;
    this.brow = 0;
    this.squint = 0;
    this.wide = 0;
    this.tail = { a: 0, v: 0 };
    this.pack = { a: 0, v: 0 };
    this.yawPrev = null;
    this.yawRate = 0;
    this.turnLean = 0;
    this.pose = new Float32Array(NCH);
    this.good = new Float32Array(NCH);
    this.tmpG = new Float32Array(NCH);
    this.tmpJ = new Float32Array(NCH);
    this.tmpF = new Float32Array(NCH);
    this.tmpW = new Float32Array(NCH);
    this.tmpT = new Float32Array(NCH);
    this.leg = { tx: 0, tz: 0, kx: 0, ax: 0, az: 0 };
    this.foot = { x: 0, y: 0, z: 0, pitch: 0 };
    this.g = { D: 0, beta: 0.5, lift: 0, wv: 0, runW: 0 };
  }

  setState(s) {
    if (!STATES.has(s)) s = "idle";
    if (s === this.state) return;
    const prev = this.state;
    this.state = s;
    this.stateT = 0;
    if (s === "jump") {
      this.jumpT = 0;
      this.tail.v += 5;
      this.pack.v += 3;
    } else if (s === "doubleJump") {
      if (this.flipT < 0) {
        this.flipT = 0;
        this.jumpT = 0;
      }
      this.tail.v += 4;
    } else if (s === "land" || (AIR.has(prev) && !AIR.has(s) && this.landT < 0)) {
      // an explicit "land" gets the full squash; a plain air->ground switch a lighter one
      this.landAmp = s === "land" ? 1 : 0.5;
      this.landT = 0;
      this.tail.v -= 4 * this.landAmp;
      this.pack.v -= 3.5 * this.landAmp;
    }
  }

  setLookAt(p) {
    if (p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)) {
      if (!this.lookTarget) this.lookTarget = { x: 0, y: 0, z: 0 };
      this.lookTarget.x = p.x;
      this.lookTarget.y = p.y;
      this.lookTarget.z = p.z;
    } else {
      this.lookTarget = null;
    }
  }

  // ---------------------------------------------------------------- gait --
  /**
   * Gait parameters for a speed (written into this.g, no allocation): half
   * stance length D, stance fraction beta, swing lift, walk/run blend factors.
   * Stride length (distance per cycle) is 2·D/beta.
   */
  gait(v) {
    const g = this.g;
    g.wv = clamp((v - 0.8) / 3.8, 0, 1);
    g.runW = smoothstep(4.7, 6.1, v);
    const rv = clamp((v - 6) / 2, 0, 1);
    g.D = lerp(lerp(0.16, 0.25, g.wv), lerp(0.255, 0.27, rv), g.runW);
    g.beta = lerp(lerp(0.58, 0.4, g.wv), lerp(0.28, 0.24, rv), g.runW);
    g.lift = lerp(lerp(0.065, 0.11, g.wv), 0.2, g.runW);
    return g;
  }

  /** Foot target (body space, relative to ground under the hip) for leg phase p. */
  gaitFoot(p, g, out) {
    if (p < g.beta) {
      const u = p / g.beta;
      out.z = g.D * (1 - 2 * u);
      out.y = 0;
      out.pitch = -0.22 * (1 - g.runW * 0.6) * (1 - u) ** 5;
    } else {
      const u = (p - g.beta) / (1 - g.beta);
      const k = lerp(1, 0.68, g.runW);
      const uz = 0.5 - 0.5 * Math.cos(Math.PI * u ** lerp(1, 1.25, g.runW));
      out.z = -g.D + 2 * g.D * uz;
      out.y = g.lift * Math.sin(Math.PI * u ** k);
      out.pitch = 0.75 * Math.sin(Math.PI * Math.min(1, u * 1.5)) * (1 - u) - 0.22 * (1 - g.runW * 0.6) * smoothstep(0.55, 1, u);
    }
  }

  /**
   * 2-bone IK for one leg. foot = ankle target in body space; hips transform
   * given by position (hx,hy,hz) and Euler (lx,ly,lz). Writes thigh/knee/ankle angles.
   */
  solveLeg(side, foot, hx, hy, hz, lx, ly, lz, out) {
    const d = this.d;
    // foot relative to hips origin, rotated into hips-local space: R^T = Rz^T Rx^T Ry^T
    let x = foot.x - hx;
    let y = foot.y + d.ankleH - hy;
    let z = foot.z - hz;
    let c = Math.cos(ly);
    let s = Math.sin(ly);
    let x1 = c * x - s * z;
    let z1 = s * x + c * z;
    x = x1;
    z = z1;
    c = Math.cos(lx);
    s = Math.sin(lx);
    const y1 = c * y + s * z;
    z1 = -s * y + c * z;
    y = y1;
    z = z1;
    c = Math.cos(lz);
    s = Math.sin(lz);
    x1 = c * x + s * y;
    const y2 = -s * x + c * y;
    x = x1 - side * d.hipX;
    y = y2 - d.hipDY;
    const L1 = d.thigh;
    const L2 = d.shin;
    const len = Math.hypot(x, y, z) || 1e-4;
    const dist = clamp(len, 0.05, (L1 + L2) * 0.9995);
    const roll = Math.asin(clamp(x / len, -1, 1));
    const alpha = Math.atan2(-z, -y);
    const gamma = Math.acos(clamp((L1 * L1 + dist * dist - L2 * L2) / (2 * L1 * dist), -1, 1));
    const knee = Math.PI - Math.acos(clamp((L1 * L1 + L2 * L2 - dist * dist) / (2 * L1 * L2), -1, 1));
    out.tx = alpha - gamma;
    out.tz = roll;
    out.kx = knee;
    out.ax = foot.pitch - (lx + out.tx + knee);
    out.az = -(roll + lz);
  }

  // --------------------------------------------------------------- poses --
  groundPose(P) {
    const d = this.d;
    const v = this.speedSm;
    const t = this.time;
    const g = this.gait(v);
    const { runW, wv } = g;
    const moveW = smoothstep(0.06, 0.9, v);
    const idleW = 1 - moveW;
    const phi = this.phase;
    const L = d.thigh + d.shin;
    const Lr = L * 0.985;

    // hip joint height above the ankle plane: inverted-pendulum walk bob,
    // compressing run bob, near-straight idle legs
    const low = Math.sqrt(Math.max(0.01, Lr * Lr - g.D * g.D));
    const high = Lr - 0.006;
    const hWalk = (high + low) / 2 - ((high - low) / 2) * Math.cos(2 * TAU * phi);
    const hRun = Lr - 0.064 - 0.034 * Math.cos(2 * TAU * (phi - g.beta / 2));
    const H = lerp(Lr - 0.008, lerp(hWalk, hRun, runW), moveW) - this.crouch;

    const S = Math.cos(TAU * (phi - g.beta / 2)); // +1 at mid-stance of the left leg
    const Cc = Math.cos(TAU * phi); // +1 when the left foot is forward
    const shift = Math.sin(t * 0.9 + this.shiftPhase) * 0.7 + Math.sin(t * 0.37 + 1.3) * 0.3;

    P[C.HIPS_PX] = moveW * -lerp(0.014, 0.006, runW) * S + idleW * 0.014 * shift;
    P[C.HIPS_PY] = d.ankleH + H - d.hipDY - d.hipsY;
    P[C.HIPS_PZ] = 0;
    const lean = moveW * (lerp(0.035, 0.085, wv) + runW * 0.15) + clamp(this.accel * 0.02, -0.12, 0.14) * moveW;
    P[C.HIPS_X] = lean;
    P[C.HIPS_Y] = moveW * lerp(0.11, 0.17, runW) * Cc;
    P[C.HIPS_Z] = moveW * lerp(0.055, 0.03, runW) * S + idleW * 0.035 * shift + this.turnLean;

    P[C.SPINE_X] = runW * 0.07 + idleW * 0.0;
    P[C.SPINE_Y] = -1.5 * P[C.HIPS_Y];
    P[C.SPINE_Z] = -0.6 * P[C.HIPS_Z] - idleW * 0.012 * shift;
    P[C.HEAD_X] = -(P[C.HIPS_X] + P[C.SPINE_X]) * 0.72 + moveW * 0.03 * Math.cos(2 * TAU * phi + 0.6);
    P[C.HEAD_Y] = -(P[C.HIPS_Y] + P[C.SPINE_Y]) * 0.85;
    P[C.HEAD_Z] = -(P[C.HIPS_Z] + P[C.SPINE_Z]) * 0.55 + idleW * 0.02 * shift;

    // arms: counter-swing, bent and pumping when running
    const armAmp = moveW * lerp(lerp(0.3, 0.62, wv), 0.95, runW);
    const breath = Math.sin(t * 1.9);
    const abd = lerp(0.2, 0.3, runW) + idleW * 0.012 * breath;
    const fwd = -runW * 0.22 + idleW * 0.04;
    P[C.SHL_X] = armAmp * Cc + fwd;
    P[C.SHR_X] = -armAmp * Cc + fwd;
    P[C.SHL_Y] = runW * 0.25 * Cc;
    P[C.SHR_Y] = runW * 0.25 * Cc;
    P[C.SHL_Z] = -abd;
    P[C.SHR_Z] = abd;
    const elBase = lerp(lerp(0.3, 0.42, wv), 1.45, runW);
    P[C.ELL_X] = -(elBase + (1 - runW) * 0.35 * Math.max(0, -P[C.SHL_X]) + idleW * 0.02 * breath);
    P[C.ELR_X] = -(elBase + (1 - runW) * 0.35 * Math.max(0, -P[C.SHR_X]) + idleW * 0.02 * breath);
    P[C.ELL_Y] = 0;
    P[C.ELR_Y] = 0;
    P[C.ELL_Z] = 0.05;
    P[C.ELR_Z] = -0.05;

    // legs via IK
    const hx = P[C.HIPS_PX];
    const hy = this.rest.hips.pos.y + d.pivotY + P[C.HIPS_PY];
    const hz = 0;
    const f = this.foot;
    for (let si = 0; si < 2; si++) {
      const side = SIDES[si];
      const p = (phi + (side < 0 ? 0 : 0.5)) % 1;
      this.gaitFoot(p, g, f);
      const idleZ = side < 0 ? 0.018 : -0.012;
      f.x = side * lerp(0.098, 0.088, moveW) * lerp(1, d.W, 0.6);
      f.z = lerp(idleZ, f.z, moveW);
      f.y *= moveW;
      f.pitch *= moveW;
      this.solveLeg(side, f, hx, hy, hz, P[C.HIPS_X], P[C.HIPS_Y], P[C.HIPS_Z], this.leg);
      const o = side < 0 ? 0 : 6;
      P[C.THL_X + o] = this.leg.tx;
      P[C.THL_Y + o] = 0;
      P[C.THL_Z + o] = this.leg.tz;
      P[C.KNL_X + o] = this.leg.kx;
      P[C.ANL_X + o] = this.leg.ax;
      P[C.ANL_Z + o] = this.leg.az;
    }
  }

  jumpPose(P, t) {
    P.fill(0);
    const wig = Math.sin(t * 9) * 0.07;
    P[C.HIPS_X] = -0.05;
    P[C.SPINE_X] = -0.09;
    P[C.HEAD_X] = -0.16;
    P[C.SHL_X] = -0.28;
    P[C.SHR_X] = -0.28;
    P[C.SHL_Z] = -2.3 - wig;
    P[C.SHR_Z] = 2.3 - wig;
    P[C.ELL_X] = -0.32;
    P[C.ELR_X] = -0.32;
    P[C.THL_X] = -1.05;
    P[C.THL_Z] = -0.07;
    P[C.KNL_X] = 1.65;
    P[C.ANL_X] = 0.45;
    P[C.THR_X] = -0.28;
    P[C.THR_Z] = 0.07;
    P[C.KNR_X] = 0.85;
    P[C.ANR_X] = 0.55;
  }

  fallPose(P, t) {
    P.fill(0);
    P[C.SPINE_X] = 0.04;
    P[C.HEAD_X] = 0.1;
    const a = Math.sin(t * 12.5);
    const b = Math.sin(t * 11 + 1.7);
    P[C.SHL_Z] = -1.85 - 0.2 * a;
    P[C.SHR_Z] = 1.85 - 0.2 * b;
    P[C.SHL_X] = 0.12 * b;
    P[C.SHR_X] = 0.12 * a;
    P[C.ELL_X] = -0.5 - 0.15 * b;
    P[C.ELR_X] = -0.5 - 0.15 * a;
    const l = Math.sin(t * 7);
    P[C.THL_X] = -0.42 + 0.14 * l;
    P[C.KNL_X] = 0.55 + 0.15 * Math.sin(t * 7 + 1);
    P[C.ANL_X] = 0.35;
    P[C.THL_Z] = -0.06;
    P[C.THR_X] = -0.06 - 0.14 * l;
    P[C.KNR_X] = 0.78 - 0.12 * Math.sin(t * 7 + 1);
    P[C.ANR_X] = 0.4;
    P[C.THR_Z] = 0.06;
  }

  /** Tight tuck for the somersault: knees to chest, arms hugging the shins. */
  tuckPose(P) {
    P.fill(0);
    P[C.HIPS_X] = 0.12;
    P[C.SPINE_X] = 0.5;
    P[C.HEAD_X] = 0.32;
    P[C.SHL_X] = -1.3;
    P[C.SHR_X] = -1.3;
    P[C.SHL_Z] = -0.32;
    P[C.SHR_Z] = 0.32;
    P[C.ELL_X] = -1.25;
    P[C.ELR_X] = -1.25;
    P[C.THL_X] = -2.05;
    P[C.THR_X] = -2.05;
    P[C.THL_Z] = -0.14;
    P[C.THR_Z] = 0.14;
    P[C.KNL_X] = 2.35;
    P[C.KNR_X] = 2.35;
    P[C.ANL_X] = 0.55;
    P[C.ANR_X] = 0.55;
  }

  wavePose(P, t) {
    // upper arm raised out to the side, forearm upright and swinging side to side
    const w = Math.sin(t * TAU * 2.0);
    // (the big chibi head means the hand must swing well out to the side to read)
    P[C.SHR_X] = 0.12;
    P[C.SHR_Y] = 0;
    P[C.SHR_Z] = 1.5 + 0.06 * w;
    P[C.ELR_X] = -0.3;
    P[C.ELR_Y] = 0;
    P[C.ELR_Z] = 1.0 + 0.42 * w;
    // lean away from the waving hand so it reads clear of the big head
    P[C.HEAD_X] = -0.07;
    P[C.HEAD_Z] = 0.05 + 0.025 * w;
    P[C.SPINE_Z] = 0.09;
  }

  // -------------------------------------------------------------- update --
  update(dt, speed) {
    if (!(dt > 0)) dt = 0;
    dt = Math.min(dt, 0.1);
    let v = Number(speed);
    if (!Number.isFinite(v)) v = NOMINAL_SPEED[this.state] ?? 0;
    v = clamp(v, 0, 25);
    this.time += dt;
    this.stateT += dt;
    const air = AIR.has(this.state);

    // ---- auto transitions for one-shot states
    if (this.state === "land" && this.stateT > 0.32) {
      this.state = v > 5.3 ? "run" : v > 0.3 ? "walk" : "idle";
      this.stateT = 0;
    }

    // ---- speed smoothing, gait phase advanced by distance (no foot sliding)
    const prevSm = this.speedSm;
    this.speedSm = approach(this.speedSm, v, 9, dt);
    if (dt > 0) this.accel = approach(this.accel, (this.speedSm - prevSm) / dt, 6, dt);
    const g = this.gait(this.speedSm);
    const stride = (2 * g.D) / g.beta;
    const prevPhase = this.phase;
    this.phase = (this.phase + (v * dt) / stride) % 1;
    if (!Number.isFinite(this.phase)) this.phase = 0;
    // foot contacts happen at phase 0 (left) and 0.5 (right)
    if (this.onStep && !air && v > 0.5 && this.phase !== prevPhase) {
      const side = this.phase < prevPhase ? -1 : prevPhase < 0.5 && this.phase >= 0.5 ? 1 : 0;
      if (side) {
        try {
          this.onStep(side);
        } catch (err) {
          console.error(err);
        }
      }
    }

    // ---- turning lean from the root's yaw rate
    const yaw = this.rootYaw();
    if (this.yawPrev !== null && dt > 0) this.yawRate = approach(this.yawRate, wrapAngle(yaw - this.yawPrev) / dt, 8, dt);
    this.yawPrev = yaw;
    this.turnLean = clamp(-this.yawRate * this.speedSm * 0.03, -0.26, 0.26);

    // ---- state weights (crossfade)
    const w = this.w;
    const st = this.state;
    w.ground = approach(w.ground, air ? 0 : 1, air ? 13 : 16, dt);
    w.jump = approach(w.jump, st === "jump" || st === "doubleJump" ? 1 : 0, 10, dt);
    w.fall = approach(w.fall, st === "fall" ? 1 : 0, 7, dt);
    w.wave = approach(w.wave, st === "wave" ? 1 : 0, 7, dt);

    // ---- one-shots
    let squash = 1;
    let landEnv = 0;
    if (this.landT >= 0) {
      const x = this.landT;
      const a = 0.2 * this.landAmp;
      squash *= x < 0.045 ? 1 - a * smoothstep(0, 0.045, x) : 1 - a * Math.exp(-(x - 0.045) * 11) * Math.cos((x - 0.045) * 17);
      landEnv = smoothstep(0, 0.05, x) * Math.exp(-Math.max(0, x - 0.05) * 9) * this.landAmp;
      this.landT += dt;
      if (this.landT > 0.6) this.landT = -1;
    }
    if (this.jumpT >= 0) {
      const x = this.jumpT;
      if (x < 0.05) squash *= 1 - 0.1 * smoothstep(0, 0.05, x);
      else {
        const y = x - 0.05;
        const e = Math.exp(-25 * y);
        squash *= 1 - 0.1 * e + 0.3 * (1 - e) * Math.exp(-6 * y);
      }
      this.jumpT += dt;
      if (this.jumpT > 0.9) this.jumpT = -1;
    }
    let flipAngle = 0;
    let tuckW = 0;
    if (this.flipT >= 0) {
      const u = this.flipT / FLIP_TIME;
      if (u >= 1) {
        this.flipT = -1;
        if (this.state === "doubleJump") {
          this.state = "fall";
          this.stateT = 0;
        }
      } else {
        // slow-fast-slow spin (tucked = faster), ends exactly at 360°
        flipAngle = TAU * (0.78 * (u - Math.sin(TAU * u) / TAU) + 0.22 * u);
        tuckW = smoothstep(0, 0.2, u) * (1 - smoothstep(0.72, 1, u));
        // landing mid-flip: finish quickly instead of spinning on the ground
        this.flipT += dt * (AIR.has(this.state) ? 1 : 2.5);
      }
    }
    const waveBounce = w.wave * 0.012 * (0.5 - 0.5 * Math.cos(this.time * TAU * 2.0));
    this.crouch = 0.075 * landEnv + waveBounce;

    // ---- build & blend poses
    const P = this.pose;
    const sum = w.ground + w.jump + w.fall || 1;
    P.fill(0);
    if (w.ground > 0.001) {
      this.groundPose(this.tmpG);
      for (let i = 0; i < NCH; i++) P[i] += this.tmpG[i] * (w.ground / sum);
    }
    if (w.jump > 0.001) {
      this.jumpPose(this.tmpJ, this.time);
      for (let i = 0; i < NCH; i++) P[i] += this.tmpJ[i] * (w.jump / sum);
    }
    if (w.fall > 0.001) {
      this.fallPose(this.tmpF, this.time);
      for (let i = 0; i < NCH; i++) P[i] += this.tmpF[i] * (w.fall / sum);
    }
    if (w.wave > 0.001) {
      this.wavePose(this.tmpW, this.time);
      for (let k = 0; k < WAVE_MASK.length; k++) {
        const i = WAVE_MASK[k];
        P[i] = lerp(P[i], this.tmpW[i], w.wave);
      }
    }
    if (tuckW > 0) {
      this.tuckPose(this.tmpT);
      for (let i = TUCK_FROM; i < NCH; i++) P[i] = lerp(P[i], this.tmpT[i], tuckW);
    }
    // landing: arms flare for balance, head dips
    P[C.SHL_Z] -= 0.45 * landEnv;
    P[C.SHR_Z] += 0.45 * landEnv;
    P[C.HEAD_X] += 0.1 * landEnv;

    // ---- look-at & idle glances (head leads with the eyes)
    this.updateLook(dt, w.ground * (1 - 0.7 * smoothstep(0.1, 1.5, this.speedSm)));
    P[C.HEAD_Y] += this.lookW * this.lookYaw * 0.72 + this.glanceYaw;
    P[C.SPINE_Y] += this.lookW * this.lookYaw * 0.28;
    P[C.HEAD_X] += -this.lookW * this.lookPitch * 0.9 - this.glancePitch;

    // ---- guard against NaN (never let a bad frame reach the nodes)
    let ok = true;
    for (let i = 0; i < NCH; i++) {
      if (!Number.isFinite(P[i])) {
        ok = false;
        break;
      }
    }
    if (ok) this.good.set(P);
    else P.set(this.good);

    this.apply(P, dt, squash, flipAngle, tuckW, air);
  }

  rootYaw() {
    const q = this.root.rotationQuaternion;
    if (q) return Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.x * q.x));
    return this.root.rotation.y || 0;
  }

  updateLook(dt, glanceAllowed) {
    // explicit look target (in root-local space, so the root's own rotation is respected)
    let wT = 0;
    if (this.lookTarget) {
      const m = this.root.computeWorldMatrix(true);
      const e = m.m;
      // invert the (rigid + uniform scale) root transform: local = R^T (p - t) / s^2
      const px = this.lookTarget.x - e[12];
      const py = this.lookTarget.y - e[13];
      const pz = this.lookTarget.z - e[14];
      const s2 = e[0] * e[0] + e[1] * e[1] + e[2] * e[2] || 1;
      const lx = (px * e[0] + py * e[1] + pz * e[2]) / s2;
      const ly = (px * e[4] + py * e[5] + pz * e[6]) / s2;
      const lz = (px * e[8] + py * e[9] + pz * e[10]) / s2;
      const headY = (this.d.hipsY + this.d.spineDY + this.d.neckDY + this.d.headCY) * this.scale;
      const yaw = Math.atan2(lx, lz);
      const pitch = Math.atan2(ly - headY, Math.hypot(lx, lz));
      if (Math.abs(yaw) < 2.2 && Number.isFinite(yaw) && Number.isFinite(pitch)) {
        wT = 1;
        this.lookYawT = clamp(yaw, -1.22, 1.22);
        this.lookPitchT = clamp(pitch, -0.44, 0.44);
      }
    }
    this.lookW = approach(this.lookW, wT, 4, dt);
    this.lookYaw = approach(this.lookYaw, this.lookYawT, 6, dt);
    this.lookPitch = approach(this.lookPitch, this.lookPitchT, 6, dt);

    // idle glances: look somewhere for a moment, then back
    this.glanceWait -= dt;
    if (this.glanceWait <= 0) {
      this.glanceAway = !this.glanceAway && glanceAllowed > 0.5 && !this.lookTarget;
      if (this.glanceAway) {
        this.glanceYawT = (this.rng() - 0.5) * 1.1;
        this.glancePitchT = (this.rng() - 0.4) * 0.28;
        this.glanceWait = 0.8 + this.rng() * 1.1;
      } else {
        this.glanceYawT = 0;
        this.glancePitchT = 0;
        this.glanceWait = 2.2 + this.rng() * 3.5;
      }
    }
    const gw = clamp(glanceAllowed, 0, 1) * (1 - this.lookW);
    this.glanceYaw = approach(this.glanceYaw, this.glanceYawT * gw, 5, dt);
    this.glancePitch = approach(this.glancePitch, this.glancePitchT * gw, 5, dt);

    // eyes lead the head: they jump to the target first, then relax as the head arrives
    const eyeYawT = clamp((this.glanceYawT * gw - this.glanceYaw) * 1.4 + this.lookW * ((this.lookYawT - this.lookYaw) * 1.2 + this.lookYawT * 0.12), -0.38, 0.38);
    const eyePitchT = clamp((this.glancePitchT * gw - this.glancePitch) * 1.2 + this.lookW * (this.lookPitchT - this.lookPitch) * 1.0, -0.25, 0.25);
    this.eyeYaw = approach(this.eyeYaw, eyeYawT, 22, dt);
    this.eyePitch = approach(this.eyePitch, eyePitchT, 22, dt);
  }

  /** Blink timing: random intervals with occasional double blinks. Returns 0 (open) .. 1 (closed). */
  blink(dt) {
    if (this.blinkT < 0) {
      this.blinkWait -= dt;
      if (this.blinkWait <= 0) this.blinkT = 0;
      return 0;
    }
    this.blinkT += dt;
    const T = 0.16;
    const u = this.blinkT / T;
    if (u >= 1) {
      this.blinkT = -1;
      if (this.blinkAgain) {
        this.blinkAgain = false;
        this.blinkWait = 2 + this.rng() * 3.5;
      } else if (this.rng() < 0.2) {
        this.blinkAgain = true;
        this.blinkWait = 0.09;
      } else {
        this.blinkWait = 1.8 + this.rng() * 3.4;
      }
      return 0;
    }
    return u < 0.35 ? smoothstep(0, 0.35, u) : u < 0.5 ? 1 : 1 - smoothstep(0.5, 1, u);
  }

  apply(P, dt, squash, flipAngle, tuckW, air) {
    const n = this.n;
    const r = this.rest;
    const sc = this.scale;
    // body: overall scale + volume-preserving squash/stretch (pivot at the feet)
    const sq = clamp(squash, 0.5, 1.6);
    const sxz = 1 / Math.sqrt(sq);
    n.body.scaling.set(sc * sxz, sc * sq, sc * sxz);
    n.pivot.rotation.x = flipAngle;
    n.hips.position.set(r.hips.pos.x + P[C.HIPS_PX], r.hips.pos.y + P[C.HIPS_PY], r.hips.pos.z + P[C.HIPS_PZ]);
    n.hips.rotation.set(P[C.HIPS_X], P[C.HIPS_Y], P[C.HIPS_Z]);
    n.spine.rotation.set(P[C.SPINE_X], P[C.SPINE_Y], P[C.SPINE_Z]);
    n.head.rotation.set(P[C.HEAD_X], P[C.HEAD_Y], P[C.HEAD_Z]);
    n.shoulderL.rotation.set(P[C.SHL_X], P[C.SHL_Y], P[C.SHL_Z]);
    n.elbowL.rotation.set(P[C.ELL_X], P[C.ELL_Y], P[C.ELL_Z]);
    n.shoulderR.rotation.set(P[C.SHR_X], P[C.SHR_Y], P[C.SHR_Z]);
    n.elbowR.rotation.set(P[C.ELR_X], P[C.ELR_Y], P[C.ELR_Z]);
    n.thighL.rotation.set(P[C.THL_X], P[C.THL_Y], P[C.THL_Z]);
    n.kneeL.rotation.x = P[C.KNL_X];
    n.ankleL.rotation.set(P[C.ANL_X], 0, P[C.ANL_Z]);
    n.thighR.rotation.set(P[C.THR_X], P[C.THR_Y], P[C.THR_Z]);
    n.kneeR.rotation.x = P[C.KNR_X];
    n.ankleR.rotation.set(P[C.ANR_X], 0, P[C.ANR_Z]);

    // breathing (faster when running)
    const moveW = smoothstep(0.06, 0.9, this.speedSm);
    const b = Math.sin(this.time * lerp(1.9, 5.5, moveW)) * lerp(1, 0.5, moveW) * (air ? 0.3 : 1);
    n.chest.scaling.set(1 + 0.012 * b, 1 + 0.016 * b, 1 + 0.014 * b);

    // ---- face: expressions, blinks, eyes
    const excited = air ? 1 : this.state === "wave" ? 0.85 : 0;
    this.mouth = approach(this.mouth, excited, 12, dt);
    const mA = 1 - smoothstep(0, 0.6, this.mouth);
    const mB = smoothstep(0.4, 1, this.mouth);
    n.mouthA.scaling.setAll(Math.max(0.001, mA));
    n.mouthB.scaling.setAll(Math.max(0.001, mB));
    this.brow = approach(this.brow, air ? 1 : this.state === "wave" ? 0.6 : this.landT >= 0 ? -0.4 : 0, 10, dt);
    n.brows.rotation.x = -0.065 * this.brow;
    this.squint = approach(this.squint, tuckW > 0.1 ? 0.55 : 0, 14, dt);
    this.wide = approach(this.wide, this.state === "fall" ? 1 : 0, 6, dt);
    const closed = Math.max(this.blink(dt), this.squint);
    const lid = lerp(LID_OPEN - 0.12 * this.wide, LID_CLOSED, closed);
    n.lidL.rotation.x = lid;
    n.lidR.rotation.x = lid;
    n.eyeballL.rotation.set(-this.eyePitch, this.eyeYaw, 0);
    n.eyeballR.rotation.set(-this.eyePitch, this.eyeYaw, 0);

    // ---- secondary motion: ponytail & backpack springs
    const drive = clamp(this.speedSm / 7, 0, 1) * 0.35 + moveW * 0.05 * Math.cos(2 * TAU * this.phase) + (tuckW > 0 ? 0.5 * tuckW : 0);
    n.dangle.rotation.x = spring(this.tail, 120, 7, drive, dt);
    n.pack.rotation.x = spring(this.pack, 160, 9, drive * 0.25, dt);
    n.dangle.rotation.z = clamp(-this.turnLean * 1.5, -0.4, 0.4);
  }
}

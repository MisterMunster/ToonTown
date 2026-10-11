// A loose flock of low-poly birds circling over the town in slow, swooping
// figure-eights. One mesh for the whole flock (CPU-animated parts: body and
// two-segment flapping wings). When night falls they climb away and hide.

import { PartBuilder, PartMesh, setBody, setHinge } from "./partmesh.js";
import { makeRng } from "../palette.js";

const P_BODY = 0;
const P_LIN = 1; // left inner wing
const P_LOUT = 2;
const P_RIN = 3;
const P_ROUT = 4;
const PARTS = 5;

const TAU = Math.PI * 2;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// colours: cheerful bluebirds with cream bellies and navy wing tips
const C = {
  back: "#4d8ff0",
  head: "#3f82ea",
  belly: "#fff3dc",
  beak: "#ffb347",
  eye: "#1d2b3a",
  wingTop: "#5b9bf5",
  wingUnder: "#dfe9f7",
  tipTop: "#24356b",
  tipUnder: "#6476a6",
  tail: "#2f5fb8",
};

/** Bird template (~1.25 m wingspan at scale 1), facing +Z, wing hinges along Z. */
function buildBird() {
  const b = new PartBuilder();
  b.ellipsoid([0, 0.02, -0.02], [0.085, 0.08, 0.19], (d) => (d[1] < -0.3 ? C.belly : C.back), P_BODY, 8, 5);
  b.ellipsoid([0, 0.085, 0.17], [0.072, 0.07, 0.074], (d) => (d[1] < -0.25 && d[2] > -0.3 ? C.belly : C.head), P_BODY, 8, 5);
  for (const s of [-1, 1]) b.ellipsoid([s * 0.052, 0.1, 0.21], [0.017, 0.021, 0.017], C.eye, P_BODY, 5, 3);
  // beak
  const tip = [0, 0.075, 0.3];
  const bl = [-0.026, 0.088, 0.225];
  const br = [0.026, 0.088, 0.225];
  const bb = [0, 0.055, 0.232];
  const inside = [0, 0.074, 0.24];
  b.tri(bl, br, tip, C.beak, P_BODY, inside);
  b.tri(br, bb, tip, C.beak, P_BODY, inside);
  b.tri(bb, bl, tip, C.beak, P_BODY, inside);
  // forked tail
  const t0 = [0, 0.045, -0.17];
  b.tri2(t0, [0.12, 0.05, -0.41], [0.025, 0.05, -0.3], C.tail, P_BODY);
  b.tri2(t0, [0.025, 0.05, -0.3], [-0.025, 0.05, -0.3], C.tail, P_BODY);
  b.tri2(t0, [-0.025, 0.05, -0.3], [-0.12, 0.05, -0.41], C.tail, P_BODY);
  // wings: inner panel hinged at the body side, rounded outer panel at the elbow
  for (const s of [-1, 1]) {
    const inner = s < 0 ? P_LIN : P_RIN;
    const outer = s < 0 ? P_LOUT : P_ROUT;
    const y = 0.06;
    const rf = [s * 0.06, y, 0.11];
    const rb = [s * 0.06, y, -0.09];
    const ef = [s * 0.32, y, 0.1];
    const eb = [s * 0.32, y, -0.12];
    b.tri2(rf, ef, eb, C.wingTop, inner, C.wingUnder);
    b.tri2(rf, eb, rb, C.wingTop, inner, C.wingUnder);
    b.wing(
      [[s * 0.32, y, -0.01], ef, [s * 0.47, y, 0.08], [s * 0.59, y, 0.01], [s * 0.63, y, -0.08], [s * 0.55, y, -0.15], eb],
      {
        top: { centre: C.wingTop, fill: C.wingTop, rim: C.tipTop },
        bottom: { centre: C.wingUnder, fill: C.wingUnder, rim: C.tipUnder },
      },
      outer,
      [0, 1, 0],
      0.55,
    );
  }
  return b;
}

/**
 * @param {import("@babylonjs/core").Scene} scene
 * @param {object} env
 * @param {import("@babylonjs/core").Material} material  shared vertex-colour material
 * @param {{ count?: number, center?: {x:number, z:number}, castShadows?: boolean }} [opts]
 */
export function createBirds(scene, env, material, { count = 10, center = { x: 0, z: 0 }, castShadows = false } = {}) {
  const rng = makeRng(7771);
  const tpl = buildBird();
  // a little per-bird tint so the flock isn't a clone army
  const tints = [];
  for (let i = 0; i < count; i++) tints.push(0.88 + rng() * 0.24);
  const pm = new PartMesh(scene, "npc_birds", tpl, count, material, PARTS, (i, r, g, b, part, out) => {
    // shift the blues a touch towards teal or violet per bird
    const k = tints[i] - 1;
    out[0] = clamp(r - k * 0.5 * (1 - r), 0, 1);
    out[1] = clamp(g + k * 0.4 * (1 - g), 0, 1);
    out[2] = b;
  });
  if (castShadows) env?.addShadowCaster?.(pm.mesh, false);

  const birds = [];
  for (let i = 0; i < count; i++) {
    birds.push({
      lag: i === 0 ? 0 : 0.03 + rng() * 0.2, // phase lag behind the leader along the loop
      lat: (rng() - 0.5) * 9,
      up: (rng() - 0.5) * 3.5,
      scale: 1.15 + rng() * 0.35,
      flapRate: 2.3 + rng() * 1.1, // Hz
      phase: rng() * TAU,
      glidePhase: rng() * TAU,
      glideRate: 0.25 + rng() * 0.25,
      n1: rng() * TAU,
      n2: rng() * TAU,
      x: 0,
      y: 0,
      z: 0,
      yaw: 0,
      pitch: 0,
      bank: 0,
      init: false,
    });
  }

  const A = 46; // figure-eight half-width (m), east-west
  const B = 22; // half-depth
  const OMEGA = 0.16; // rad/s along the loop (~7 m/s)
  // Lowest where the loops cross (over the open town square), highest at the
  // far ends of the lobes (over the rooftops).
  const ALT_LOW = 13;
  const ALT_HIGH = 22;
  let t = 0;
  let away = 0;
  let hidden = false;

  /** World position of bird bd at time tt (written into out.x/y/z). */
  function target(bd, tt, out) {
    const u = tt * OMEGA - bd.lag;
    const lx = A * Math.sin(u);
    const lz = B * Math.sin(2 * u);
    // tangent (for the lateral formation offset)
    let dx = A * Math.cos(u);
    let dz = 2 * B * Math.cos(2 * u);
    const l = Math.hypot(dx, dz) || 1;
    dx /= l;
    dz /= l;
    const lat = bd.lat + 1.4 * Math.sin(tt * 0.6 + bd.n1);
    let x = lx + dz * lat;
    let z = lz - dx * lat;
    const spread = 1 + away * 1.6;
    // the pattern sways a little so passes vary, without reaching the Town Hall tower
    const rot = 0.35 * Math.sin(tt * 0.021);
    const cr = Math.cos(rot);
    const sr = Math.sin(rot);
    const rx = (x * cr + z * sr) * spread;
    const rz = (-x * sr + z * cr) * spread;
    x = center.x + rx;
    z = center.z + rz;
    const y = ALT_LOW + (ALT_HIGH - ALT_LOW) * Math.abs(Math.sin(u)) + bd.up + 0.8 * Math.sin(tt * 0.9 + bd.n2) + away * 70;
    out.x = x;
    out.y = y;
    out.z = z;
  }

  const p = { x: 0, y: 0, z: 0 };
  const m = pm.mats;

  function update(dt) {
    if (!(dt > 0)) return;
    dt = Math.min(dt, 0.1);
    t += dt;
    const night = Number(env?.nightFactor) || 0;
    away = smoothstep(0.35, 0.7, night);
    if (away > 0.985) {
      if (!hidden) pm.mesh.setEnabled(false);
      hidden = true;
      return;
    }
    if (hidden) {
      pm.mesh.setEnabled(true);
      hidden = false;
    }
    for (let i = 0; i < birds.length; i++) {
      const bd = birds[i];
      target(bd, t, p);
      if (!bd.init) {
        // start already flying the right way
        target(bd, t - dt, bd);
        bd.yaw = Math.atan2(p.x - bd.x, p.z - bd.z);
        bd.init = true;
      }
      const vx = (p.x - bd.x) / dt;
      const vy = (p.y - bd.y) / dt;
      const vz = (p.z - bd.z) / dt;
      bd.x = p.x;
      bd.y = p.y;
      bd.z = p.z;
      const hs = Math.hypot(vx, vz);
      if (hs > 0.05) {
        const yaw = Math.atan2(vx, vz);
        const dyaw = wrapAngle(yaw - bd.yaw);
        bd.yaw = wrapAngle(bd.yaw + dyaw * (1 - Math.exp(-8 * dt)));
        const yawRate = dyaw / Math.max(dt, 1e-3);
        bd.bank += (clamp(yawRate * 0.5, -0.7, 0.7) - bd.bank) * (1 - Math.exp(-3 * dt));
        bd.pitch += (clamp(Math.atan2(vy, hs), -0.5, 0.5) - bd.pitch) * (1 - Math.exp(-4 * dt));
      }
      // flap/glide rhythm: climbing birds flap harder
      const glide = smoothstep(-0.4, 0.5, Math.sin(t * bd.glideRate + bd.glidePhase));
      const effort = clamp(0.25 + glide * 0.75 + bd.pitch * 1.2, 0.15, 1);
      bd.phase += dt * bd.flapRate * TAU * (0.6 + 0.4 * effort);
      const amp = 0.12 + 0.75 * effort;
      const s = Math.sin(bd.phase);
      const dihedral = 0.16 * (1 - effort);
      const a = dihedral + amp * s;
      const b2 = 0.08 + amp * 0.65 * Math.sin(bd.phase - 0.9);
      const bob = -0.05 * s * effort;

      const o = pm.at(i, P_BODY);
      setBody(m, o, bd.x, bd.y + bob, bd.z, bd.yaw, bd.pitch, bd.bank, bd.scale);
      // left wing rotates by -angle about +Z to lift its tip; right by +angle
      setHinge(m, pm.at(i, P_LIN), o, -0.06, 0.06, 0, -a);
      setHinge(m, pm.at(i, P_LOUT), pm.at(i, P_LIN), -0.36, 0.06, 0, -b2);
      setHinge(m, pm.at(i, P_RIN), o, 0.06, 0.06, 0, a);
      setHinge(m, pm.at(i, P_ROUT), pm.at(i, P_RIN), 0.36, 0.06, 0, b2);
    }
    pm.update();
  }

  return { mesh: pm.mesh, update, birds };
}

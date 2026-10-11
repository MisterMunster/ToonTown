// Third-person follow camera built on ArcRotateCamera.
//
// Babylon's own pointer / wheel inputs stay attached (mouse drag, wheel,
// one-finger drag, pinch). Each frame we read back how much they moved
// alpha / beta / radius since our last write ("user deltas"), then compose the
// final pose ourselves:
//   - target: damped follow of the hero (fast in XZ, slow in Y with a jump
//     anchor so hops don't bob the view), clamped so the hero never leaves frame
//   - alpha: user orbit + gamepad right stick + gentle auto-follow behind the
//     hero after ~1.5 s without manual orbiting, or a smooth swing on reset
//   - radius: user zoom, pulled in when the view to the hero is blocked
// See ARCHITECTURE.md "Camera" for the contract.

import { ArcRotateCamera, Vector3 } from "@babylonjs/core";
import { events as globalEvents } from "./events.js";

// Framing: the camera aims at a point a little above Pip's head and looks
// down only ~14°, so Pip sits in the lower-middle of the frame, the ground
// ahead stays readable and a band of sky shows above the rooftops. (The lens
// ends up about as high as with a steeper, head-height aim; only the view
// direction is raised.)
const TARGET_HEIGHT = 2.0; // look-at point above the feet (Pip is ~1.6 m tall)
const DEFAULT_RADIUS = 9;
const MIN_ZOOM = 3.5;
const MAX_ZOOM = 18;
const DEFAULT_BETA = 1.33; // ≈ 14° below horizontal
const MIN_BETA = 0.35;
const MAX_BETA = 1.48;
const BASE_FOV = 0.95; // vertical, landscape
const MAX_PORTRAIT_FOV = 1.2; // portrait screens widen the vertical FOV up to this
const MIN_CAM_Y = 0.4;

const FOLLOW_RATE_XZ = 10; // 1/s
const FOLLOW_RATE_Y = 4.5; // 1/s
const MAX_LAG_XZ = 1.4; // m
const MAX_LAG_Y = 1.6; // m
const JUMP_ANCHOR_RANGE = 1.4; // m the hero may rise above the anchor before the view follows

const AUTO_FOLLOW_DELAY = 1.5; // s after the last manual orbit
const AUTO_FOLLOW_RAMP = 0.8; // s to blend auto-follow back in
const AUTO_FOLLOW_GAIN = 0.13; // (1/s) per (m/s) of hero speed — gentle, never fights the stick
const LOOK_RATE_X = 2.6; // rad/s at full stick
const LOOK_RATE_Y = 1.5;
const RESET_RATE = 7; // 1/s

// Occlusion probe: colliders are only slightly inflated so a view that merely
// grazes a wall (hero walking along a building) doesn't slam the camera in;
// on a real hit the camera stops COLLISION_PULLBACK before the surface.
const COLLISION_PAD = 0.06;
const COLLISION_PULLBACK = 0.3;
const COLLISION_MIN_RADIUS = 1.5;
const COLLISION_EASE_OUT = 2.2; // 1/s

// Title-screen orbit: the lens circles ~16.5 m up (above every roof and rooftop
// mascot, so nothing ever passes close in front of it) but looks only ~16°
// down through a wider lens, so the fountain square sits between the PLAY
// button and the controls card and a band of sky shows behind the logo.
const INTRO_TARGET = new Vector3(0, 8.2, 0);
const INTRO_RADIUS = 30;
const INTRO_BETA = 1.29; // ≈ 16° below horizontal
const INTRO_FOV = 1.08;
const INTRO_SPIN = 0.07; // rad/s
const SWOOP_TIME = 1.6; // s

const TWO_PI = Math.PI * 2;
function wrapAngle(a) {
  a = (a + Math.PI) % TWO_PI;
  if (a < 0) a += TWO_PI;
  return a - Math.PI;
}
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const damp = (rate, dt) => 1 - Math.exp(-rate * dt);
const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
/** ArcRotateCamera alpha that puts the camera behind something facing `heading`. */
const alphaBehind = (heading) => Math.atan2(-Math.cos(heading), -Math.sin(heading));

/**
 * @param {import("@babylonjs/core").Scene} scene
 * @param {HTMLCanvasElement} canvas  (unused: Babylon's inputs attach to the scene's canvas)
 * @param {ReturnType<import("./player.js").createPlayer>} player
 * @param {ReturnType<import("./input.js").createInput>} input
 * @param {import("./colliders.js").ColliderWorld} colliders
 * @param {{ quality?: string, events?: any }} [opts]  events defaults to the shared bus (for "camera:reset")
 */
export function createCameraRig(scene, canvas, player, input, colliders, opts = {}) {
  const events = opts.events ?? globalEvents;
  const feet = player.position; // live reference

  const startAlpha = alphaBehind(player.heading ?? 0);
  const camera = new ArcRotateCamera("followCam", startAlpha, DEFAULT_BETA, DEFAULT_RADIUS, new Vector3(feet.x, feet.y + TARGET_HEIGHT, feet.z), scene);
  camera.fov = BASE_FOV;
  camera.minZ = 0.1;
  camera.maxZ = 1200;
  camera.inputs.removeByType("ArcRotateCameraKeyboardMoveInput"); // arrows belong to the player
  camera.panningSensibility = 0;
  camera.angularSensibilityX = 900;
  camera.angularSensibilityY = 1100;
  camera.inertia = 0.82;
  camera.wheelDeltaPercentage = 0.015; // ≈8% zoom per wheel notch (with inertia)
  camera.useNaturalPinchZoom = true; // the hero scales with the fingers
  camera.useInputToRestoreState = false; // no double-tap "restore" jumps
  camera.lowerBetaLimit = MIN_BETA;
  camera.upperBetaLimit = MAX_BETA;
  camera.lowerRadiusLimit = COLLISION_MIN_RADIUS;
  camera.upperRadiusLimit = MAX_ZOOM;

  // ---- state (all preallocated: no per-frame allocations) ----------------
  let mode = "follow"; // "intro" | "swoop" | "follow"
  let controlsAttached = false;
  const target = camera.target.clone(); // smoothed follow target
  let anchorY = feet.y;
  let zoomRadius = DEFAULT_RADIUS;
  let collRadius = DEFAULT_RADIUS; // current radius after collision pull-in
  let prevZoom = DEFAULT_RADIUS;
  let alpha = camera.alpha;
  let beta = camera.beta;
  let radius = camera.radius;
  let lastAlpha = alpha;
  let lastBeta = beta;
  let lastRadius = radius;
  let userIdle = AUTO_FOLLOW_DELAY + AUTO_FOLLOW_RAMP; // s since last manual orbit
  let resetting = false;
  let introAlpha = startAlpha;
  let swoopT = 0;
  let fov = BASE_FOV; // landscape vertical FOV for the current mode (portrait widens it)
  let fromAlpha = 0;
  let fromBeta = 0;
  let fromRadius = 0;
  const fromTarget = new Vector3();
  const goalTarget = new Vector3();
  const queryList = [];

  function setControls(on) {
    if (on === controlsAttached) return;
    controlsAttached = on;
    try {
      if (on) camera.attachControl();
      else camera.detachControl();
    } catch (err) {
      console.error(err);
    }
  }
  setControls(true);

  events?.on?.("camera:reset", () => {
    if (mode === "follow") resetting = true;
  });

  // ---- camera collision -------------------------------------------------
  // Same slab test as ColliderWorld.segmentHit, but allocation-free, it skips
  // thin posts / trunks so the view doesn't "pump" when running past them,
  // and it ignores colliders that contain the ray origin.
  let sMin = 0;
  let sMax = 1;
  function slab(o, d, lo, hi) {
    if (Math.abs(d) < 1e-9) return o >= lo && o <= hi;
    let t1 = (lo - o) / d;
    let t2 = (hi - o) / d;
    if (t1 > t2) {
      const t = t1;
      t1 = t2;
      t2 = t;
    }
    if (t1 > sMin) sMin = t1;
    if (t2 < sMax) sMax = t2;
    return sMin <= sMax;
  }
  function ignoredForCamera(c) {
    if (c.type === "cyl") return c.radius < 0.45;
    return c.maxX - c.minX < 0.4 && c.maxZ - c.minZ < 0.4;
  }
  function segmentHit(ax, ay, az, bx, by, bz, pad) {
    if (!colliders) return 1;
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const list = colliders.queryXZ(Math.min(ax, bx) - pad, Math.min(az, bz) - pad, Math.max(ax, bx) + pad, Math.max(az, bz) + pad, queryList);
    let best = 1;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (ignoredForCamera(c)) continue;
      sMin = 0;
      sMax = 1;
      if (!slab(ax, dx, c.minX - pad, c.maxX + pad)) continue;
      if (!slab(ay, dy, c.minY - pad, c.maxY + pad)) continue;
      if (!slab(az, dz, c.minZ - pad, c.maxZ + pad)) continue;
      // Ray starts inside this (padded) collider, e.g. the jump-anchored
      // target dips into a crate the hero is hopping onto. It can't hide the
      // hero, so ignore it instead of collapsing to the minimum radius.
      if (sMin <= 0) continue;
      if (sMin < best) best = sMin;
    }
    return best;
  }

  /** Largest radius (≤ wanted) with a clear line from the target, never below the minimum. */
  function clearRadius(tx, ty, tz, a, b, wanted) {
    const sb = Math.sin(b);
    const ox = Math.cos(a) * sb;
    const oy = Math.cos(b);
    const oz = Math.sin(a) * sb;
    const t = segmentHit(tx, ty, tz, tx + ox * wanted, ty + oy * wanted, tz + oz * wanted, COLLISION_PAD);
    return t >= 1 ? wanted : Math.max(COLLISION_MIN_RADIUS, t * wanted - COLLISION_PULLBACK);
  }

  // ---- per-mode pose solvers ---------------------------------------------
  function updateFollow(dt) {
    userIdle += dt;

    // Gamepad right stick orbits (push up = look up).
    const lx = input?.lookX || 0;
    const ly = input?.lookY || 0;
    if (lx || ly) {
      alpha -= lx * LOOK_RATE_X * dt;
      beta -= ly * LOOK_RATE_Y * dt;
      userIdle = 0;
      resetting = false;
    }

    // Target: fast in XZ, slower in Y, with a jump anchor so hops don't bob the view.
    if (player.grounded) anchorY = feet.y;
    else {
      if (feet.y < anchorY) anchorY = feet.y;
      if (feet.y - anchorY > JUMP_ANCHOR_RANGE) anchorY = feet.y - JUMP_ANCHOR_RANGE;
    }
    const kxz = damp(FOLLOW_RATE_XZ, dt);
    target.x += (feet.x - target.x) * kxz;
    target.z += (feet.z - target.z) * kxz;
    target.y += (anchorY + TARGET_HEIGHT - target.y) * damp(FOLLOW_RATE_Y, dt);
    // Never let the hero drift out of frame.
    const lagX = target.x - feet.x;
    const lagZ = target.z - feet.z;
    const lag = Math.hypot(lagX, lagZ);
    if (lag > MAX_LAG_XZ) {
      target.x = feet.x + (lagX / lag) * MAX_LAG_XZ;
      target.z = feet.z + (lagZ / lag) * MAX_LAG_XZ;
    }
    const idealY = feet.y + TARGET_HEIGHT;
    target.y = clamp(target.y, idealY - MAX_LAG_Y, idealY + MAX_LAG_Y);

    // Gentle auto-follow: ease behind the direction of travel.
    const vx = player.velocity?.x || 0;
    const vz = player.velocity?.z || 0;
    const speed = Math.hypot(vx, vz);
    if (resetting) {
      const k = damp(RESET_RATE, dt);
      const da = wrapAngle(alphaBehind(player.heading) - alpha);
      alpha += da * k;
      beta += (DEFAULT_BETA - beta) * k;
      if (Math.abs(da) < 0.01 && Math.abs(beta - DEFAULT_BETA) < 0.01) resetting = false;
    } else if (speed > 0.5 && userIdle > AUTO_FOLLOW_DELAY) {
      const ramp = smoothstep(AUTO_FOLLOW_DELAY, AUTO_FOLLOW_DELAY + AUTO_FOLLOW_RAMP, userIdle);
      // Moving toward the camera → don't swing around (would be disorienting).
      const away = (vx * -Math.cos(alpha) + vz * -Math.sin(alpha)) / speed;
      const w = smoothstep(-0.35, 0.25, away) * ramp;
      if (w > 0) {
        const da = wrapAngle(Math.atan2(-vz, -vx) - alpha);
        alpha += da * damp(AUTO_FOLLOW_GAIN * Math.min(speed, 8) * w, dt);
      }
    }
    beta = clamp(beta, MIN_BETA, MAX_BETA);

    // Collision: snap in when blocked, ease back out when clear. When the
    // camera wasn't pulled in, zooming applies directly (no easing lag).
    const free = clearRadius(target.x, target.y, target.z, alpha, beta, zoomRadius);
    if (free < collRadius || collRadius >= prevZoom - 1e-3) collRadius = free;
    else collRadius = Math.min(free, collRadius + (free - collRadius) * damp(COLLISION_EASE_OUT, dt));
    prevZoom = zoomRadius;
    radius = collRadius;
  }

  function updateIntro(dt) {
    introAlpha = wrapAngle(introAlpha + INTRO_SPIN * dt);
    alpha = introAlpha;
    beta = INTRO_BETA;
    radius = INTRO_RADIUS;
    fov = INTRO_FOV;
    target.copyFrom(INTRO_TARGET);
  }

  function updateSwoop(dt) {
    swoopT += dt;
    const u = Math.min(1, swoopT / SWOOP_TIME);
    const e = easeInOutCubic(u);
    const eT = easeInOutCubic(Math.min(1, u * 1.15)); // target lands slightly first

    goalTarget.set(feet.x, feet.y + TARGET_HEIGHT, feet.z);
    const goalAlpha = alphaBehind(player.heading);
    alpha = fromAlpha + wrapAngle(goalAlpha - fromAlpha) * e;
    beta = fromBeta + (DEFAULT_BETA - fromBeta) * e;
    radius = fromRadius + (zoomRadius - fromRadius) * e;
    fov = INTRO_FOV + (BASE_FOV - INTRO_FOV) * e;
    Vector3.LerpToRef(fromTarget, goalTarget, eT, target);
    radius = Math.min(radius, clearRadius(target.x, target.y, target.z, alpha, beta, radius));

    if (u >= 1) {
      mode = "follow";
      fov = BASE_FOV;
      anchorY = feet.y;
      collRadius = radius;
      prevZoom = zoomRadius;
      userIdle = 0;
      camera.upperRadiusLimit = MAX_ZOOM;
      setControls(true);
    }
  }

  // ---- public API ---------------------------------------------------------
  const rig = {
    camera,
    get yaw() {
      return Math.atan2(-Math.cos(camera.alpha), -Math.sin(camera.alpha));
    },

    update(dt) {
      if (!(dt > 0)) return;
      dt = Math.min(dt, 0.1);

      // Harvest what Babylon's pointer / wheel inputs did during the last render.
      if (mode === "follow") {
        const dA = camera.alpha - lastAlpha;
        const dB = camera.beta - lastBeta;
        const dR = camera.radius - lastRadius;
        if (Math.abs(dA) > 1e-6 || Math.abs(dB) > 1e-6) {
          userIdle = 0;
          resetting = false;
        }
        if (Math.abs(dR) > 1e-6) zoomRadius = clamp(zoomRadius + dR, MIN_ZOOM, MAX_ZOOM);
        alpha = camera.alpha;
        beta = camera.beta;
        updateFollow(dt);
      } else if (mode === "intro") updateIntro(dt);
      else updateSwoop(dt);

      // Keep the lens above the ground.
      if (target.y + radius * Math.cos(beta) < MIN_CAM_Y) beta = Math.acos(clamp((MIN_CAM_Y - target.y) / radius, -1, 1));

      // Portrait screens: widen the vertical FOV so the view isn't claustrophobic.
      const aspect = scene.getEngine().getAspectRatio(camera) || 1;
      camera.fov = aspect < 1 ? Math.min(Math.max(fov, MAX_PORTRAIT_FOV), fov / Math.sqrt(aspect)) : fov;

      alpha = wrapAngle(alpha);
      // While following, the wheel / pinch may only zoom down to the current
      // (possibly collision-shortened) radius, never below MIN_ZOOM by itself.
      if (mode === "follow") camera.lowerRadiusLimit = Math.min(MIN_ZOOM, radius);
      camera.alpha = lastAlpha = alpha;
      camera.beta = lastBeta = beta;
      camera.radius = lastRadius = radius;
      camera.target.copyFrom(target);
    },

    /** true: slow cinematic orbit of the town square; false: swoop to behind the hero. */
    setIntro(on) {
      if (on) {
        mode = "intro";
        resetting = false;
        setControls(false);
        camera.upperRadiusLimit = INTRO_RADIUS + 10;
        camera.lowerRadiusLimit = COLLISION_MIN_RADIUS;
        introAlpha = camera.alpha;
        updateIntro(0);
        camera.alpha = lastAlpha = alpha;
        camera.beta = lastBeta = beta;
        camera.radius = lastRadius = radius;
        camera.target.copyFrom(target);
      } else if (mode === "intro") {
        mode = "swoop";
        swoopT = 0;
        fromAlpha = camera.alpha;
        fromBeta = camera.beta;
        fromRadius = camera.radius;
        fromTarget.copyFrom(camera.target);
        zoomRadius = DEFAULT_RADIUS;
      }
    },
  };

  return rig;
}

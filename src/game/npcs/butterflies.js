// Butterflies fluttering around the park's flowery verges: erratic little
// flights between nearby spots, short rests with slowly opening wings, and a
// startled hop away when the hero gets close. Daytime only. One mesh total.

import { PartBuilder, PartMesh, setBody, setHinge } from "./partmesh.js";
import { makeRng } from "../palette.js";

const P_BODY = 0;
const P_L = 1;
const P_R = 2;
const PARTS = 3;

const TAU = Math.PI * 2;
const FAR = 70; // m beyond their area: too small to see, skip the work
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/** Wing colour schemes: [centre, fill, rim]. */
const SCHEMES = [
  ["#fff1b8", "#ffa62b", "#8a3b12"], // monarch orange
  ["#ffe3f1", "#ff6b9d", "#8e1c4f"], // pink
  ["#e3f2ff", "#4d96ff", "#1d3f8a"], // blue
  ["#f6ebff", "#c77dff", "#4b1f7a"], // violet
  ["#fffde7", "#ffe14d", "#b5651d"], // lemon
  ["#eaffea", "#6bcb77", "#1f6b35"], // green
];
const BODY = "#3b2a3a";

/** Butterfly template (~0.36 m span at scale 1) facing +Z; wings hinge on the body's Z axis. */
function buildButterfly() {
  const b = new PartBuilder();
  b.ellipsoid([0, 0, -0.01], [0.014, 0.016, 0.075], BODY, P_BODY, 6, 4);
  b.ellipsoid([0, 0.004, 0.075], [0.021, 0.02, 0.02], BODY, P_BODY, 5, 3);
  for (const s of [-1, 1]) b.tri2([s * 0.004, 0.012, 0.085], [s * 0.012, 0.012, 0.085], [s * 0.045, 0.06, 0.15], BODY, P_BODY);
  // wings: colour codes are placeholders (#000001..6), tinted per butterfly below
  const top = { centre: "#000001", fill: "#000002", rim: "#000003" };
  const bottom = { centre: "#000004", fill: "#000005", rim: "#000006" };
  for (const s of [-1, 1]) {
    const part = s < 0 ? P_L : P_R;
    const fore = [[0, 0, 0.015], [0, 0, 0.03], [s * 0.05, 0, 0.11], [s * 0.13, 0, 0.14], [s * 0.185, 0, 0.085], [s * 0.17, 0, 0.012], [s * 0.07, 0, -0.005], [0, 0, 0]];
    const hind = [[0, 0, -0.0175], [0, 0, -0.005], [s * 0.085, 0, -0.008], [s * 0.13, 0, -0.055], [s * 0.115, 0, -0.115], [s * 0.05, 0, -0.135], [s * 0.012, 0, -0.085], [0, 0, -0.03]];
    b.wing(fore, { top, bottom }, part, [0, 1, 0], 0.66);
    b.wing(hind, { top, bottom }, part, [0, 1, 0], 0.62);
  }
  return b;
}

/**
 * @param {import("@babylonjs/core").Scene} scene
 * @param {object} env
 * @param {import("../colliders.js").ColliderWorld} colliders
 * @param {import("@babylonjs/core").Material} material
 * @param {{ count?: number, anchors: Array<{x:number, z:number}>, castShadows?: boolean }} opts
 */
export function createButterflies(scene, env, colliders, material, { count = 8, anchors, castShadows = false }) {
  const rng = makeRng(9091);
  const tpl = buildButterfly();
  const hex = (h) => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
  const schemes = [];
  for (let i = 0; i < count; i++) schemes.push(SCHEMES[(i * 5 + 1) % SCHEMES.length].map(hex));
  const pm = new PartMesh(scene, "npc_butterflies", tpl, count, material, PARTS, (i, r, g, bl, part, out) => {
    if (part === P_BODY) return;
    // decode the placeholder (blue channel 1..6); the underside is paler
    const code = clamp(Math.round(bl * 255), 1, 6);
    const c = schemes[i][(code - 1) % 3];
    const pale = code > 3 ? 0.35 : 0;
    out[0] = c[0] + (1 - c[0]) * pale;
    out[1] = c[1] + (1 - c[1]) * pale;
    out[2] = c[2] + (1 - c[2]) * pale;
  });
  if (castShadows) env?.addShadowCaster?.(pm.mesh, false);

  const list = [];
  for (let i = 0; i < count; i++) {
    const a = anchors[i % anchors.length];
    const bf = {
      ax: a.x,
      az: a.z,
      x: a.x + (rng() - 0.5) * 2,
      y: 0.5 + rng() * 0.8,
      z: a.z + (rng() - 0.5) * 2,
      vx: 0,
      vy: 0,
      vz: 0,
      tx: a.x,
      ty: 0.8,
      tz: a.z,
      yaw: rng() * TAU,
      phase: rng() * TAU,
      rate: 7 + rng() * 4, // flaps per second
      speed: 0.9 + rng() * 0.6,
      rest: 0, // > 0 while perched
      landing: false,
      bobW: 1,
      gy: 0, // ground height under the current target
      wander: rng() * TAU,
      scale: 1.25 + rng() * 0.35,
      rng: makeRng(500 + i * 13),
    };
    pickTarget(bf, false);
    list.push(bf);
  }

  function groundAt(x, z) {
    return colliders?.groundHeightAt ? colliders.groundHeightAt(x, z, 0.05, 3) : 0;
  }

  function pickTarget(bf, flee, fx = 0, fz = 0) {
    const r = bf.rng;
    bf.landing = false;
    if (flee) {
      // dart away from the hero and up
      const d = Math.hypot(bf.x - fx, bf.z - fz) || 1;
      bf.tx = bf.x + ((bf.x - fx) / d) * (2 + r() * 1.5) + (r() - 0.5);
      bf.tz = bf.z + ((bf.z - fz) / d) * (2 + r() * 1.5) + (r() - 0.5);
      bf.ty = 1.6 + r() * 1.0;
    } else {
      const ang = r() * TAU;
      const rad = 0.6 + r() * 2.6;
      bf.tx = bf.ax + Math.sin(ang) * rad;
      bf.tz = bf.az + Math.cos(ang) * rad;
      bf.ty = 0.35 + r() * 1.25;
    }
    bf.gy = groundAt(bf.tx, bf.tz);
  }

  const m = pm.mats;
  let hidden = false;
  let t = 0;

  // centre / radius of the area they live in (for distance culling)
  let cx = 0;
  let cz = 0;
  for (const a of anchors) {
    cx += a.x / anchors.length;
    cz += a.z / anchors.length;
  }
  let areaR = 0;
  for (const a of anchors) areaR = Math.max(areaR, Math.hypot(a.x - cx, a.z - cz) + 8);

  /**
   * @param {number} dt
   * @param {{x:number,y:number,z:number}|null} hero
   * @param {{x:number,y:number,z:number}|null} [camPos]  skip all work when far from the camera
   */
  function update(dt, hero, camPos) {
    if (!(dt > 0)) return;
    dt = Math.min(dt, 0.1);
    t += dt;
    const night = Number(env?.nightFactor) || 0;
    const vis = 1 - smoothstep(0.25, 0.45, night);
    const far = camPos ? Math.hypot(camPos.x - cx, camPos.z - cz) - areaR > FAR : false;
    if (vis <= 0.001 || far) {
      if (!hidden) pm.mesh.setEnabled(false);
      hidden = true;
      return;
    }
    if (hidden) {
      pm.mesh.setEnabled(true);
      hidden = false;
    }
    const hx = hero?.x;
    const hz = hero?.z;
    const hasHero = Number.isFinite(hx) && Number.isFinite(hz);

    for (let i = 0; i < list.length; i++) {
      const bf = list[i];
      const r = bf.rng;
      const gy = bf.gy;
      // startled by the hero: dart away and up
      if (hasHero && (bf.rest > 0 || bf.ty < 1.4) && Math.hypot(bf.x - hx, bf.z - hz) < 1.4) {
        bf.rest = 0;
        pickTarget(bf, true, hx, hz);
      }
      let flap;
      if (bf.rest > 0) {
        // perched: wings open and close slowly
        bf.rest -= dt;
        bf.vx = bf.vy = bf.vz = 0;
        bf.phase += dt * 1.6;
        flap = 0.5 + 0.45 * Math.sin(bf.phase);
        if (bf.rest <= 0) {
          bf.rest = 0;
          pickTarget(bf, false);
        }
      } else {
        const dx = bf.tx - bf.x;
        const dy = bf.ty + gy - bf.y;
        const dz = bf.tz - bf.z;
        const d = Math.hypot(dx, dy, dz);
        if (d < 0.25) {
          if (bf.landing) {
            // touched down on a flower / blade of grass: rest a moment
            bf.landing = false;
            bf.rest = 1.5 + r() * 3;
          } else if (r() < 0.3 && bf.ty < 1.0) {
            // drift down to land just below
            bf.landing = true;
            bf.tx = bf.x + (r() - 0.5) * 0.4;
            bf.tz = bf.z + (r() - 0.5) * 0.4;
            bf.ty = 0.12 + r() * 0.15;
            bf.gy = groundAt(bf.tx, bf.tz);
          } else pickTarget(bf, false);
        }
        // erratic steering: wobble the desired direction
        bf.wander += (r() - 0.5) * 6 * dt;
        const wob = Math.sin(t * 2.3 + bf.wander) * 0.9;
        const inv = 1 / (d || 1);
        const sp = bf.speed * (bf.ty > 1.5 ? 1.8 : 1);
        const cw = Math.cos(wob);
        const sw = Math.sin(wob);
        const dxn = dx * inv * cw + dz * inv * sw;
        const dzn = -dx * inv * sw + dz * inv * cw;
        const k = 1 - Math.exp(-3.2 * dt);
        bf.vx += (dxn * sp - bf.vx) * k;
        bf.vz += (dzn * sp - bf.vz) * k;
        bf.vy += (dy * inv * sp * 0.8 - bf.vy) * k;
        bf.phase += dt * bf.rate * TAU;
        bf.x += bf.vx * dt;
        bf.y += bf.vy * dt;
        bf.z += bf.vz * dt;
        if (bf.y < gy + 0.1) {
          bf.y = gy + 0.1;
          bf.vy = Math.abs(bf.vy) * 0.3;
        }
        // stay near home
        const hd = Math.hypot(bf.x - bf.ax, bf.z - bf.az);
        if (hd > 7) pickTarget(bf, false);
        const hs = Math.hypot(bf.vx, bf.vz);
        if (hs > 0.05) bf.yaw = wrapAngle(bf.yaw + wrapAngle(Math.atan2(bf.vx, bf.vz) - bf.yaw) * (1 - Math.exp(-6 * dt)));
        flap = 0.5 + 0.5 * Math.sin(bf.phase);
      }
      // wings: from nearly flat (0.15 rad) to almost closed above the back (1.35 rad)
      const ang = 0.15 + flap * 1.2;
      const o = pm.at(i, P_BODY);
      // the classic bobbing flight: a hop per wingbeat plus a slow drift
      bf.bobW += ((bf.rest > 0 || bf.landing ? 0 : 1) - bf.bobW) * (1 - Math.exp(-4 * dt));
      const bob = bf.bobW * (0.035 * Math.sin(bf.phase + 1.2) + 0.08 * Math.sin(t * 1.7 + i * 2.1));
      setBody(m, o, bf.x, bf.y + bob, bf.z, bf.yaw, bf.rest > 0 ? 0 : 0.25, 0, bf.scale * vis);
      setHinge(m, pm.at(i, P_L), o, 0, 0, 0, -ang);
      setHinge(m, pm.at(i, P_R), o, 0, 0, 0, ang);
    }
    pm.update();
  }

  return { mesh: pm.mesh, update, list };
}

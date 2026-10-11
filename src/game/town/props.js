// Reusable street furniture / nature props. Every builder takes a Frame `f`
// plus local coordinates and registers its own colliders, so props can be
// dropped anywhere (on a sidewalk, in the park, on a building lot...).
import { PALETTE } from "../palette.js";
import { shade, T } from "./geo.js";

export const COL = {
  metal: PALETTE.metal,
  metalLight: PALETTE.metalLight,
  wood: PALETTE.wood,
  woodDark: PALETTE.woodDark,
  stone: PALETTE.stone,
  stoneDark: PALETTE.stoneDark,
  trunk: PALETTE.trunk,
  lampGreen: "#2f5d50",
  hedge: "#3f9a45",
  hedgeLight: "#57b55a",
  white: "#ffffff",
  cream: "#fff6e5",
  gold: "#f2c14e",
  red: "#e05d5d",
  tire: "#2b2d33",
  soil: "#7a5236",
  blossom: ["#ffb7d5", "#ff9ecb", "#ffc8e0"],
  maple: ["#e8743b", "#f2a541", "#d9534f", "#f08a3c"],
};

const TAU = Math.PI * 2;

// ------------------------------------------------------------------ trees --
/**
 * Cartoon tree. style: round | pine | bush | blossom | maple | poplar.
 * (x, y, z) = base on the ground. Registers a trunk collider.
 */
export function tree(ctx, f, x, y, z, style = "round", s = 1, seed = 0) {
  const { colliders } = ctx;
  const r = (k) => {
    const v = Math.sin((seed + 1) * 12.9898 + k * 78.233) * 43758.5453;
    return v - Math.floor(v);
  };
  const foliage = PALETTE.foliage;
  const leaf = (i) => foliage[Math.floor(r(i) * foliage.length)];
  const g = (y0, h) => ({ grad: [y0, y0 + h, 0.72, 1.08] });
  const seg = ctx.lowDetail ? 4 : 5;
  const wy = f.pt(x, y, z)[1];
  switch (style) {
    case "pine": {
      const h = 1.1 * s;
      f.cylB("solid", COL.trunk, x, y, z, 0.38 * s, h, 6, 0.8);
      const col = r(3) > 0.5 ? "#2e7d32" : "#3f8f45";
      const tiers = [
        [3.4, 2.4, 0.9],
        [2.7, 2.1, 2.2],
        [1.9, 1.8, 3.4],
      ];
      for (const [d, th, ty] of tiers) {
        f.shape("solid", T.cyl(8, 0), col, x, y + (ty + th / 2) * s, z, d * s, th * s, d * s, [0, r(5) * TAU, 0], g(wy + ty * s, th * s));
      }
      colliders && f.colCyl(colliders, x, z, 0.3 * s, y, y + 4 * s, "tree");
      break;
    }
    case "bush": {
      const col = leaf(2);
      const n = 3 + Math.floor(r(1) * 2);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU + r(i + 4);
        const d = (1.1 + r(i + 7) * 0.7) * s;
        f.sphere("solid", col, x + Math.sin(a) * 0.45 * s, y + d * 0.42, z + Math.cos(a) * 0.45 * s, d, d * 0.85, d, seg, null, g(wy, d));
      }
      colliders && f.colCyl(colliders, x, z, 0.8 * s, y, y + 1.4 * s, "prop");
      break;
    }
    case "poplar": {
      f.cylB("solid", COL.trunk, x, y, z, 0.32 * s, 1.4 * s, 6, 0.8);
      const col = leaf(3);
      f.sphere("solid", col, x, y + 3.4 * s, z, 1.9 * s, 4.6 * s, 1.9 * s, seg + 1, null, g(wy + 1.2 * s, 4.4 * s));
      colliders && f.colCyl(colliders, x, z, 0.25 * s, y, y + 3 * s, "tree");
      break;
    }
    default: {
      // round / blossom / maple share a trunk + clustered canopy
      const th = 2.1 * s;
      f.cylB("solid", COL.trunk, x, y, z, 0.46 * s, th, 7, 0.65);
      // a little branch stub for character
      f.cyl("solid", COL.trunk, x + 0.28 * s, y + th * 0.7, z, 0.14 * s, 0.7 * s, 5, 0.6, [0, 0, -0.8]);
      const palette = style === "blossom" ? COL.blossom : style === "maple" ? COL.maple : null;
      const pickCol = (i) => (palette ? palette[Math.floor(r(i + 9) * palette.length)] : leaf(1));
      const base = pickCol(0);
      const main = (3.0 + r(2) * 0.6) * s;
      const cy = y + th + main * 0.38;
      f.sphere("solid", base, x, cy, z, main, main * 0.92, main, seg + 1, null, g(cy - main * 0.5, main));
      const blobs = 3;
      for (let i = 0; i < blobs; i++) {
        const a = (i / blobs) * TAU + r(11) * TAU;
        const d = main * (0.55 + r(i + 20) * 0.15);
        const px = x + Math.sin(a) * main * 0.42;
        const pz = z + Math.cos(a) * main * 0.42;
        const py = cy - main * 0.12 + r(i + 30) * main * 0.3;
        f.sphere("solid", palette ? pickCol(i + 1) : base, px, py, pz, d, d * 0.9, d, seg, null, g(py - d * 0.5, d));
      }
      if (style === "blossom") {
        // a few white blossom clusters nestled into the canopy
        for (let i = 0; i < 5; i++) {
          const a = r(i + 40) * TAU;
          const e = r(i + 50) * 0.9;
          f.sphere("solid", "#fff3f8", x + Math.sin(a) * main * 0.43, cy + e * main * 0.3, z + Math.cos(a) * main * 0.43, 0.42 * s, 0.32 * s, 0.42 * s, 3);
        }
      }
      colliders && f.colCyl(colliders, x, z, 0.32 * s, y, y + th + 1, "tree");
    }
  }
}

// ------------------------------------------------------------------ lamps --
/**
 * Globe street lamp. Adds an additive light pool on the ground (bucket
 * "pool") that only shows at night. Returns the bulb's world position.
 */
export function lamp(ctx, f, x, y, z, { poolR = 4.2, height = 3.6 } = {}) {
  const c = COL.lampGreen;
  f.cylB("solid", c, x, y, z, 0.42, 0.45, 10, 0.55);
  f.cylB("solid", c, x, y + 0.45, z, 0.13, height - 0.45, 8, 0.85);
  f.cylB("solid", COL.gold, x, y + 1.2, z, 0.2, 0.08, 8);
  f.cylB("solid", c, x, y + height - 0.05, z, 0.26, 0.16, 8, 1.3);
  f.sphere("bulb", null, x, y + height + 0.3, z, 0.56, 0.56, 0.56, 6);
  f.cylB("solid", c, x, y + height + 0.52, z, 0.38, 0.14, 8, 0.4);
  f.gem("solid", COL.gold, x, y + height + 0.74, z, 0.14);
  if (poolR > 0) poolDecal(f, x, y + 0.025, z, poolR);
  ctx.colliders && f.colCyl(ctx.colliders, x, z, 0.16, y, y + height + 0.6, "prop");
  return f.pt(x, y + height + 0.3, z);
}

/** Round additive light pool decal (0..1 uvs across the disc). */
export function poolDecal(f, x, y, z, r, segs = 20) {
  const pts = [];
  const uvs = [];
  for (let i = 0; i < segs; i++) {
    const a = (i / segs) * TAU;
    pts.push([x + Math.sin(a) * r, y, z + Math.cos(a) * r]);
    uvs.push([0.5 + Math.sin(a) * 0.5, 0.5 + Math.cos(a) * 0.5]);
  }
  f.poly("pool", null, pts, [0, 1, 0], uvs);
}

// --------------------------------------------------------------- benches --
/** Park bench facing local +Z (rotated by ry). Seat top ~0.5 m (platform). */
export function bench(ctx, f, x, y, z, ry = 0, color = COL.wood) {
  const b = f.child(x, y, z, ry);
  const leg = COL.metal;
  for (const sx of [-0.85, 0.85]) {
    b.boxB("solid", leg, sx, 0, 0.12, 0.08, 0.44, 0.08);
    b.boxB("solid", leg, sx, 0, -0.18, 0.08, 0.9, 0.08);
    b.box("solid", leg, sx, 0.42, -0.02, 0.08, 0.06, 0.46);
  }
  for (let i = 0; i < 3; i++) b.rbox("solid", color, 0, 0.47, 0.17 - i * 0.16, 2.0, 0.06, 0.13, 0.025);
  for (let i = 0; i < 2; i++) b.rbox("solid", color, 0, 0.66 + i * 0.18, -0.2, 2.0, 0.12, 0.05, 0.025, [-0.12, 0, 0]);
  ctx.colliders && b.colBox(ctx.colliders, -1.0, 0, -0.28, 1.0, 0.5, 0.26, "platform");
}

/** Trash can (cylinder r 0.28). */
export function trashCan(ctx, f, x, y, z) {
  f.cylB("solid", "#3a7d5c", x, y, z, 0.52, 0.85, 12, 1.05);
  for (const h of [0.2, 0.62]) f.cylB("solid", "#2d6249", x, y + h, z, 0.56, 0.05, 12);
  f.cylB("solid", "#2d6249", x, y + 0.85, z, 0.6, 0.08, 12);
  f.sphere("solid", "#2d6249", x, y + 0.93, z, 0.5, 0.2, 0.5, 5);
  ctx.colliders && f.colCyl(ctx.colliders, x, z, 0.3, y, y + 1.0, "prop");
}

/** Fire hydrant (cylinder r 0.22). */
export function hydrant(ctx, f, x, y, z) {
  const red = "#e23b3b";
  f.cylB("solid", red, x, y, z, 0.4, 0.1, 10);
  f.cylB("solid", red, x, y + 0.1, z, 0.3, 0.5, 10);
  f.cylB("solid", "#f5d76e", x, y + 0.56, z, 0.36, 0.06, 10);
  f.sphere("solid", red, x, y + 0.62, z, 0.3, 0.26, 0.3, 6);
  f.gem("solid", "#f5d76e", x, y + 0.77, z, 0.1);
  f.cyl("solid", red, x, y + 0.42, z, 0.12, 0.5, 8, 1, [0, 0, Math.PI / 2]);
  f.cyl("solid", red, x, y + 0.42, z, 0.15, 0.4, 8, 1, [Math.PI / 2, 0, 0]);
  ctx.colliders && f.colCyl(ctx.colliders, x, z, 0.22, y, y + 0.8, "prop");
}

/** Red pillar post box. */
export function postBox(ctx, f, x, y, z, ry = 0) {
  const b = f.child(x, y, z, ry);
  const red = "#d64545";
  b.cylB("solid", "#2b2b35", 0, 0, 0, 0.6, 0.12, 12);
  b.cylB("solid", red, 0, 0.12, 0, 0.5, 1.0, 12);
  b.cylB("solid", red, 0, 1.08, 0, 0.6, 0.1, 12);
  b.sphere("solid", red, 0, 1.18, 0, 0.56, 0.3, 0.56, 6);
  b.box("solid", "#2b2b35", 0, 0.92, 0.25, 0.28, 0.05, 0.02);
  b.box("solid", COL.gold, 0, 0.7, 0.25, 0.16, 0.12, 0.02);
  ctx.colliders && b.colCyl(ctx.colliders, 0, 0, 0.3, 0, 1.3, "prop");
}

/** Little house mailbox on a post (front yards). */
export function mailbox(ctx, f, x, y, z, ry = 0, color = "#4d96ff") {
  const b = f.child(x, y, z, ry);
  b.boxB("solid", COL.woodDark, 0, 0, 0, 0.1, 1.0, 0.1);
  b.rbox("solid", color, 0, 1.12, 0, 0.3, 0.28, 0.5, 0.1);
  b.box("solid", "#ff5d5d", 0.17, 1.22, -0.1, 0.03, 0.2, 0.06);
  ctx.colliders && b.colCyl(ctx.colliders, 0, 0, 0.15, 0, 1.3, "prop");
}

/** Street name post with two crossed blades (uv rects from the atlas). */
export function streetSignPost(ctx, f, x, y, z, uvA, uvB, ry = 0) {
  const b = f.child(x, y, z, ry);
  b.cylB("solid", COL.metal, 0, 0, 0, 0.1, 3.0, 8);
  b.gem("solid", COL.gold, 0, 3.08, 0, 0.14);
  const blade = (h, rot, uv) => {
    const s = b.child(0, h, 0, rot);
    s.box("solid", "#2e8b57", 0, 0, 0, 1.5, 0.38, 0.04);
    s.quad("sign", null, 0, 0, 0.022, 1.46, 0.36, 0, uv);
    s.quad("sign", null, 0, 0, -0.022, 1.46, 0.36, Math.PI, uv);
  };
  blade(2.75, 0, uvA);
  blade(2.35, Math.PI / 2, uvB);
  ctx.colliders && b.colCyl(ctx.colliders, 0, 0, 0.12, 0, 3.1, "prop");
}

// ----------------------------------------------------------------- crates --
/** Wooden crate, size s (cube), bottom at y. Platform. */
export function crate(ctx, f, x, y, z, s = 1, ry = 0, tint = COL.wood) {
  const b = f.child(x, y, z, ry);
  const h = s / 2;
  b.rbox("solid", tint, 0, h, 0, s, s, s, 0.04 * s);
  const dark = shade(tint, 0.72);
  // corner posts + bands for that "crate" read
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) b.box("solid", dark, sx * (h - 0.05 * s), h, sz * (h - 0.05 * s), 0.12 * s, s * 1.002, 0.12 * s);
  }
  for (const side of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    const w = b.child(0, 0, 0, side);
    w.box("solid", dark, 0, h, h + 0.005, s * 0.98, 0.11 * s, 0.02, [0, 0, Math.atan2(s * 0.8, s * 0.8)]);
  }
  ctx.colliders && b.colBox(ctx.colliders, -h, 0, -h, h, s, h, "platform");
}

/** Barrel, bottom at y (height 0.95, platform). */
export function barrel(ctx, f, x, y, z, color = "#b0703c") {
  f.cylB("solid", color, x, y, z, 0.66, 0.3, 12, 1.12);
  f.cylB("solid", color, x, y + 0.3, z, 0.74, 0.35, 12, 1);
  f.cylB("solid", color, x, y + 0.65, z, 0.74, 0.3, 12, 0.89);
  for (const h of [0.12, 0.47, 0.83]) f.cylB("solid", COL.metal, x, y + h, z, h === 0.47 ? 0.78 : 0.72, 0.05, 12);
  f.cylB("solid", shade(color, 0.8), x, y + 0.93, z, 0.6, 0.03, 12);
  ctx.colliders && f.colCyl(ctx.colliders, x, z, 0.37, y, y + 0.95, "platform");
}

// ------------------------------------------------------------------- cars --
/** Parked cartoon car facing local +Z rotated by ry. Body & roof are platforms. */
export function car(ctx, f, x, y, z, ry, color) {
  const b = f.child(x, y, z, ry);
  const L = 3.7;
  const W = 1.85;
  const glass = "#a8dcff";
  b.rbox("solid", color, 0, 0.72, 0, W, 0.72, L, 0.26);
  b.rbox("solid", color, 0, 1.3, -0.25, W * 0.86, 0.62, L * 0.52, 0.22);
  // windows: slightly inset glass panels around the cabin
  b.box("solid", glass, 0, 1.34, 0.42, W * 0.74, 0.42, 0.04, [-0.35, 0, 0]);
  b.box("solid", glass, 0, 1.34, -0.92, W * 0.74, 0.42, 0.04, [0.3, 0, 0]);
  for (const sx of [-1, 1]) b.box("solid", glass, sx * W * 0.43, 1.34, -0.25, 0.04, 0.4, L * 0.44);
  b.box("solid", color, 0, 1.34, -0.25, W * 0.87, 0.42, 0.08);
  // bumpers, lights
  b.rbox("solid", "#e8e8ee", 0, 0.5, L / 2 + 0.02, W * 0.95, 0.18, 0.16, 0.06);
  b.rbox("solid", "#e8e8ee", 0, 0.5, -L / 2 - 0.02, W * 0.95, 0.18, 0.16, 0.06);
  for (const sx of [-1, 1]) {
    b.sphere("solid", "#fff3b0", sx * 0.6, 0.82, L / 2 - 0.02, 0.32, 0.26, 0.12, 6);
    b.box("solid", "#ff4d4d", sx * 0.62, 0.84, -L / 2 + 0.01, 0.34, 0.16, 0.06);
  }
  // wheels
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      b.cyl("solid", COL.tire, sx * (W / 2 - 0.12), 0.36, sz * 1.15, 0.72, 0.3, 14, 1, [0, 0, Math.PI / 2]);
      b.cyl("solid", "#d9dde3", sx * (W / 2 - 0.02), 0.36, sz * 1.15, 0.36, 0.1, 10, 1, [0, 0, Math.PI / 2]);
    }
  }
  if (ctx.colliders) {
    b.colBox(ctx.colliders, -W / 2, 0, -L / 2 - 0.1, W / 2, 1.08, L / 2 + 0.1, "platform");
    b.colBox(ctx.colliders, -W * 0.43, 1.0, -1.2, W * 0.43, 1.62, 0.7, "platform");
  }
}

// ----------------------------------------------------------------- fences --
/** White picket fence along a local axis-aligned run (x0,z0)->(x1,z1). */
export function picketFence(ctx, f, x0, z0, x1, z1, y = 0, color = COL.white, h = 0.85) {
  const len = Math.hypot(x1 - x0, z1 - z0);
  if (len < 0.3) return;
  const ry = Math.atan2(x1 - x0, z1 - z0); // run direction as yaw
  const run = f.child(x0, y, z0, ry);
  // rails (local +Z along the run)
  for (const ry2 of [0.3, h - 0.25]) run.box("solid", color, 0, ry2, len / 2, 0.05, 0.09, len);
  const n = Math.max(2, Math.round(len / 0.27));
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * len;
    const post = i % 8 === 0 || i === n;
    const w = post ? 0.12 : 0.09;
    run.boxB("solid", color, 0, 0, t, 0.05, post ? h + 0.08 : h - 0.08, w);
    run.shape("solid", T.cyl(4, 0), color, 0, (post ? h + 0.08 : h - 0.08) + 0.06, t, 0.05, 0.12, w, null);
  }
  if (ctx.colliders) run.colBox(ctx.colliders, -0.08, 0, 0, 0.08, h, len, "prop");
}

/** Boxy hedge with fluffy top along a run. */
export function hedge(ctx, f, x0, z0, x1, z1, y = 0, h = 1.0, wdt = 0.9) {
  const len = Math.hypot(x1 - x0, z1 - z0);
  if (len < 0.3) return;
  const ry = Math.atan2(x1 - x0, z1 - z0);
  const run = f.child(x0, y, z0, ry);
  run.rbox("solid", COL.hedge, 0, h / 2, len / 2, wdt, h, len, 0.18, null, { grad: [y, y + h, 0.75, 1.05] });
  // fluffy bumps along the top (skipped on low quality)
  if (!ctx.lowDetail) {
    const n = Math.max(1, Math.round(len / 1.5));
    for (let i = 0; i < n; i++) {
      const t = ((i + 0.5) / n) * len;
      run.sphere("solid", i % 2 ? COL.hedgeLight : COL.hedge, 0, h - 0.05, t, wdt * 0.95, 0.5, 1.6, 3);
    }
  }
  if (ctx.colliders) run.colBox(ctx.colliders, -wdt / 2, 0, 0, wdt / 2, h + 0.15, len, "prop");
}

// ----------------------------------------------------------------- flowers --
/** Round raised flower bed (stone rim, soil, colourful blooms). Platform. */
export function flowerBed(ctx, f, x, y, z, r = 1.6, seed = 1) {
  const rim = 0.32;
  f.cylB("solid", "#d9cdb8", x, y, z, r * 2, rim, 20);
  f.cylB("solid", COL.soil, x, y + rim, z, r * 2 - 0.3, 0.02, 20);
  const n = Math.round(r * r * 7);
  for (let i = 0; i < n; i++) {
    const a = i * 2.39996 + seed;
    const d = Math.sqrt((i + 0.5) / n) * (r - 0.3);
    const px = x + Math.sin(a) * d;
    const pz = z + Math.cos(a) * d;
    const col = PALETTE.flowers[(i + seed) % PALETTE.flowers.length];
    if (i % 3 === 0) f.sphere("solid", "#4caf50", px, y + rim + 0.12, pz, 0.38, 0.28, 0.38, 3);
    else f.sphere("solid", col, px, y + rim + 0.2, pz, 0.26, 0.17, 0.26, 3);
  }
  ctx.colliders && f.colCyl(ctx.colliders, x, z, r, y, y + rim, "platform");
}

/** Square stone planter with a bush and blooms. Platform top 0.6. */
export function planter(ctx, f, x, y, z, s = 1.2, seed = 0) {
  f.rbox("solid", "#e7dcc8", x, y + 0.3, z, s, 0.6, s, 0.06);
  f.box("solid", COL.soil, x, y + 0.6, z, s - 0.2, 0.02, s - 0.2);
  f.sphere("solid", "#5fb052", x, y + 0.85, z, s * 0.7, s * 0.55, s * 0.7, 5);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + seed;
    f.sphere("solid", PALETTE.flowers[(i + seed) % 6], x + Math.sin(a) * s * 0.33, y + 0.88 + (i % 2) * 0.1, z + Math.cos(a) * s * 0.33, 0.24, 0.16, 0.24, 3);
  }
  ctx.colliders && f.colBox(ctx.colliders, x - s / 2, y, z - s / 2, x + s / 2, y + 0.6, z + s / 2, "platform");
}

// ---------------------------------------------------------------- tables --
/** Picnic table with attached benches. Table top 0.78 (platform). */
export function picnicTable(ctx, f, x, y, z, ry = 0) {
  const b = f.child(x, y, z, ry);
  const w = COL.wood;
  b.rbox("solid", w, 0, 0.76, 0, 2.0, 0.08, 0.9, 0.03);
  for (const s of [-1, 1]) {
    b.rbox("solid", w, 0, 0.44, s * 0.78, 2.0, 0.06, 0.32, 0.02);
    for (const ex of [-0.75, 0.75]) b.box("solid", COL.woodDark, ex, 0.38, s * 0.42, 0.08, 0.86, 0.08, [s * 0.5, 0, 0]);
  }
  b.box("solid", COL.woodDark, 0, 0.38, 0, 1.6, 0.06, 1.7);
  ctx.colliders && b.colBox(ctx.colliders, -1, 0, -0.95, 1, 0.8, 0.95, "platform");
}

/** Café table with striped umbrella and two chairs. */
export function cafeTable(ctx, f, x, y, z, colA = "#ff8c42", seed = 0) {
  f.cylB("solid", COL.metal, x, y, z, 0.5, 0.04, 10);
  f.cylB("solid", COL.metal, x, y, z, 0.07, 2.3, 6);
  f.cylB("solid", COL.white, x, y + 0.72, z, 0.95, 0.05, 14);
  for (let i = 0; i < 2; i++) {
    const a = seed + i * Math.PI + 0.4;
    const cx = x + Math.sin(a) * 0.85;
    const cz = z + Math.cos(a) * 0.85;
    const c = f.child(cx, y, cz, a + Math.PI);
    c.rbox("solid", colA, 0, 0.45, 0, 0.45, 0.06, 0.45, 0.02);
    c.rbox("solid", colA, 0, 0.72, -0.21, 0.45, 0.5, 0.05, 0.02);
    for (const sx of [-0.18, 0.18]) for (const sz of [-0.18, 0.18]) c.boxB("solid", COL.metal, sx, 0, sz, 0.04, 0.45, 0.04);
  }
  // umbrella canopy: 8 alternating slices
  const R = 1.35;
  const top = y + 2.45;
  const rim = y + 2.05;
  for (let i = 0; i < 8; i++) {
    const a0 = (i / 8) * TAU;
    const a1 = ((i + 1) / 8) * TAU;
    const p = (a) => [x + Math.sin(a) * R, rim, z + Math.cos(a) * R];
    const am = (a0 + a1) / 2;
    const n = [Math.sin(am) * 0.3, 1, Math.cos(am) * 0.3];
    f.poly("cloth", i % 2 ? COL.white : colA, [[x, top, z], p(a0), p(a1)], n);
  }
  f.gem("solid", COL.white, x, top + 0.05, z, 0.12);
  ctx.colliders && f.colCyl(ctx.colliders, x, z, 0.48, y, y + 0.75, "platform");
}

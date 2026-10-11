// Buildings: cottages, townhouses, shops (with awnings, painted signs and
// giant rooftop mascots) and the Town Hall with its working clock tower.
// Each building is modelled in a local frame whose origin is the middle of
// the front facade at slab level; local +Z points out of the front door and
// the body occupies x in [-w/2, w/2], z in [-d, 0].
import { PALETTE } from "../palette.js";
import { CURB_H, BLOCKS, SIDEWALK } from "./layout.js";
import { shade } from "./geo.js";
import { COL, picketFence, mailbox, flowerBed, tree, postBox } from "./props.js";

const S = Math.PI;
const N = 0;
const E = Math.PI / 2;
const W = -Math.PI / 2;
const TAU = Math.PI * 2;
const W_ = PALETTE.walls;
const R_ = PALETTE.roofs;
const DOORS = ["#e05d5d", "#4d96ff", "#3fa66b", "#f2b134", "#9b5de5", "#ff7f50", "#00a6c8"];
const SHUTTERS = ["#4d96ff", "#3fa66b", "#e05d5d", "#7a5cc9", "#2f8f9d", "#f08a3c"];
const BASE = 0.35; // foundation height

/**
 * The town plan. x/z = middle of the front facade, f = facing, yard =
 * distance from facade to the sidewalk (front garden for homes).
 */
const LOTS = [
  // ---- Main Street shops around the square (NE / NW blocks)
  { type: "shop", x: 8, z: 21.5, f: W, w: 7, d: 9, wall: W_[2], roof: R_[1], sign: "BOOKS", style: { bg: "#2f4b7c", fg: "#ffd93d", icon: "book" }, awning: "#2f4b7c", mascot: "books", landmark: "Bookshop", icon: "📚" },
  { type: "shop", x: 8, z: 29.6, f: W, w: 7.4, d: 10, wall: W_[1], roof: R_[2], sign: "TOY SHOP", style: { bg: "#4d96ff", icon: "bear" }, awning: "#4d96ff", mascot: "duck", landmark: "Toy Shop", icon: "🧸", floors: 2 },
  { type: "shop", x: 23, z: 8, f: S, w: 7, d: 9, wall: W_[0], roof: R_[0], sign: "ICE CREAM", style: { bg: "#ff7aa8", icon: "cone" }, awning: "#ff7aa8", mascot: "cone", landmark: "Ice Cream", icon: "🍦" },
  { type: "shop", x: 30.5, z: 8, f: S, w: 5.6, d: 8, wall: W_[3], roof: R_[4], sign: "FLOWERS", style: { bg: "#ffd1dc", fg: "#c2185b", icon: "flower" }, awning: "#ff6b9d", mascot: "flower", landmark: "Flower Shop", icon: "💐", floors: 1 },
  { type: "townhouse", x: 32, z: 26, f: E, w: 9, d: 9, wall: W_[5], roof: R_[2], floors: 3, yard: 1 },
  { type: "shop", x: -8, z: 21.5, f: E, w: 7, d: 9, wall: W_[4], roof: R_[0], sign: "CAFE", style: { bg: "#6b3e1f", fg: "#ffe6a7", icon: "cup" }, awning: "#8b4f2a", mascot: "cup", landmark: "Cafe", icon: "☕" },
  { type: "shop", x: -8, z: 29.6, f: E, w: 7.4, d: 10, wall: W_[6], roof: R_[3], sign: "BAKERY", style: { bg: "#ffe6a7", fg: "#8a4b2a", icon: "bread" }, awning: "#e0915d", mascot: "cupcake", landmark: "Bakery", icon: "🥐" },
  { type: "shop", x: -23, z: 8, f: S, w: 7, d: 9, wall: W_[7], roof: R_[5], sign: "POST OFFICE", style: { bg: "#e05d5d", icon: "letter" }, awning: "#e05d5d", landmark: "Post Office", icon: "✉️", postBox: true },
  { type: "shop", x: -30.5, z: 8, f: S, w: 5.6, d: 8, wall: W_[3], roof: R_[4], sign: "GROCER", style: { bg: "#3fa66b", icon: "apple" }, awning: "#3fa66b", mascot: "apple", landmark: "Grocer", icon: "🍎", floors: 1 },
  { type: "townhouse", x: -32, z: 26, f: W, w: 9, d: 9, wall: W_[0], roof: R_[1], floors: 2, yard: 1 },
  // ---- Town Hall block
  { type: "hall", x: 0, z: 55, f: S, w: 22, d: 15 },
  { type: "cottage", x: -29, z: 50, f: S, w: 8, d: 8, wall: W_[1], roof: R_[0], yard: 3, ridge: "z" },
  { type: "townhouse", x: -19.5, z: 50, f: S, w: 7, d: 8, wall: W_[2], roof: R_[5], floors: 2, yard: 3, roofStyle: "mansard" },
  { type: "townhouse", x: 19.5, z: 50, f: S, w: 7, d: 8, wall: W_[4], roof: R_[1], floors: 3, yard: 3 },
  { type: "cottage", x: 29, z: 50, f: S, w: 8, d: 8, wall: W_[5], roof: R_[4], yard: 3, ridge: "x" },
  // ---- north-west / north-east residential
  { type: "cottage", x: -72, z: 50, f: S, w: 8, d: 8, wall: W_[6], roof: R_[0], yard: 3, ridge: "x" },
  { type: "cottage", x: -61, z: 50, f: S, w: 7.5, d: 7.5, wall: W_[3], roof: R_[1], yard: 3, ridge: "z" },
  { type: "cottage", x: -50, z: 66, f: E, w: 8, d: 8, wall: W_[0], roof: R_[2], yard: 3, ridge: "x" },
  { type: "cottage", x: 61, z: 50, f: S, w: 7.5, d: 7.5, wall: W_[7], roof: R_[3], yard: 3, ridge: "z" },
  { type: "cottage", x: 72, z: 50, f: S, w: 8, d: 8, wall: W_[1], roof: R_[5], yard: 3, ridge: "x" },
  { type: "townhouse", x: 50, z: 66, f: W, w: 8, d: 8, wall: W_[2], roof: R_[0], floors: 2, yard: 3, roofStyle: "hip" },
  // ---- west (Residential Lane)
  { type: "cottage", x: -71, z: 10, f: S, w: 8, d: 8, wall: W_[4], roof: R_[1], yard: 3, ridge: "z" },
  { type: "townhouse", x: -59.5, z: 10, f: S, w: 7, d: 8, wall: W_[5], roof: R_[3], floors: 2, yard: 3, roofStyle: "hip" },
  { type: "cottage", x: -66, z: 30, f: N, w: 8, d: 8, wall: W_[2], roof: R_[0], yard: 3, ridge: "x" },
  // ---- east (Cherry Hill)
  { type: "townhouse", x: 51.5, z: 10, f: S, w: 7, d: 8, wall: W_[0], roof: R_[4], floors: 2, yard: 3, roofStyle: "mansard" },
  { type: "townhouse", x: 60, z: 10, f: S, w: 7, d: 8, wall: W_[6], roof: R_[5], floors: 3, yard: 3 },
  { type: "cottage", x: 71, z: 10, f: S, w: 8, d: 8, wall: W_[3], roof: R_[2], yard: 3, ridge: "z" },
  { type: "townhouse", x: 52, z: -10, f: N, w: 7, d: 8, wall: W_[7], roof: R_[0], floors: 2, yard: 3, roofStyle: "hip" },
  { type: "cottage", x: 62, z: -10, f: N, w: 8, d: 8, wall: W_[1], roof: R_[1], yard: 3, ridge: "x" },
  { type: "cottage", x: 72.5, z: -10, f: N, w: 7.5, d: 7.5, wall: W_[5], roof: R_[0], yard: 3, ridge: "z" },
  // ---- south-east (Oak Street)
  { type: "cottage", x: 14, z: -50, f: N, w: 8, d: 8, wall: W_[2], roof: R_[3], yard: 3, ridge: "z" },
  { type: "townhouse", x: 25, z: -50, f: N, w: 7, d: 8, wall: W_[4], roof: R_[5], floors: 2, yard: 3 },
  { type: "cottage", x: 10, z: -66, f: W, w: 8, d: 8, wall: W_[6], roof: R_[1], yard: 3, ridge: "x" },
  { type: "cottage", x: 53, z: -50, f: N, w: 8, d: 8, wall: W_[0], roof: R_[4], yard: 3, ridge: "x" },
  { type: "townhouse", x: 64, z: -50, f: N, w: 7, d: 8, wall: W_[3], roof: R_[2], floors: 2, yard: 3, roofStyle: "mansard" },
];

/** True when a world point lies on a block's sidewalk ring. */
function onSidewalk(p) {
  const [x, , z] = p;
  for (const b of BLOCKS) {
    if (x < b.x0 || x > b.x1 || z < b.z0 || z > b.z1) continue;
    const s = SIDEWALK + 0.3;
    return (
      (b.walk.includes("w") && x < b.x0 + s) ||
      (b.walk.includes("e") && x > b.x1 - s) ||
      (b.walk.includes("s") && z < b.z0 + s) ||
      (b.walk.includes("n") && z > b.z1 - s)
    );
  }
  return false;
}

// --------------------------------------------------------------- details --
function pickGlass(rng) {
  const r = rng();
  return r < 0.36 ? "glass0" : r < 0.62 ? "glass1" : r < 0.82 ? "glass2" : "glassDark";
}

/** Window centred at (x, y) on a wall frame (local +Z out of the wall). */
function win(ctx, wf, x, y, w, h, o = {}) {
  const trim = o.trim ?? COL.white;
  const glass = o.glass ?? pickGlass(ctx.rng);
  wf.box("solid", trim, x, y, 0.045, w + 0.24, h + 0.24, 0.09);
  wf.quad(glass, null, x, y, 0.095, w, h);
  if (o.mullions !== false) {
    wf.box("solid", trim, x, y, 0.11, 0.07, h, 0.04);
    wf.box("solid", trim, x, y + h * 0.1, 0.11, w, 0.07, 0.04);
  }
  wf.box("solid", trim, x, y - h / 2 - 0.13, 0.12, w + 0.42, 0.1, 0.24);
  if (o.shutters) {
    for (const s of [-1, 1]) {
      const sx = x + s * (w / 2 + 0.16 + w * 0.22);
      wf.box("solid", o.shutters, sx, y, 0.05, w * 0.44, h + 0.06, 0.07);
      const dark = shade(o.shutters, 0.8);
      for (const i of [-1, 1]) wf.box("solid", dark, sx, y + i * h * 0.2, 0.09, w * 0.36, 0.05, 0.02);
    }
  }
  if (o.box) {
    const by = y - h / 2 - 0.36;
    wf.box("solid", o.boxColor ?? COL.woodDark, x, by, 0.2, w + 0.2, 0.26, 0.3);
    const n = Math.max(3, Math.round(w * 4));
    for (let i = 0; i < n; i++) {
      const fx = x - w / 2 + (w * (i + 0.5)) / n;
      if (i % 2) wf.sphere("solid", "#4caf50", fx, by + 0.2, 0.24, 0.26, 0.2, 0.22, 3);
      else wf.sphere("solid", PALETTE.flowers[(i + i3(x)) % 6], fx, by + 0.22, 0.24, 0.22, 0.15, 0.22, 3);
    }
  }
  if (o.top) {
    // little pediment / lintel over the window
    wf.box("solid", trim, x, y + h / 2 + 0.2, 0.1, w + 0.5, 0.12, 0.2);
  }
}

/** Front door with frame, panels, knob and steps (steps go from y=0 up to base). */
function door(ctx, wf, x, base, w, h, color, { trim = COL.white, glass = false, steps = true } = {}) {
  const c = ctx.colliders;
  wf.box("solid", trim, x, base + h / 2 + 0.05, 0.05, w + 0.32, h + 0.18, 0.1);
  wf.rbox("solid", color, x, base + h / 2, 0.11, w, h, 0.06, 0.02);
  const dark = shade(color, 0.82);
  if (glass) wf.quad("glassShop", null, x, base + h * 0.68, 0.145, w * 0.7, h * 0.42);
  else {
    wf.box("solid", dark, x, base + h * 0.7, 0.145, w * 0.62, h * 0.3, 0.02);
    wf.box("solid", dark, x, base + h * 0.27, 0.145, w * 0.62, h * 0.3, 0.02);
  }
  wf.gem("solid", COL.gold, x + w * 0.34, base + h * 0.48, 0.18, 0.1);
  if (steps && base > 0.05) {
    const n = Math.max(1, Math.round(base / 0.18));
    for (let i = 0; i < n; i++) {
      const top = base * ((i + 1) / n);
      const depth = 0.38 * (n - i);
      wf.boxB("solid", "#d9d0c0", x, 0, depth / 2, w + 0.7 - i * 0.12, top, depth, null, { top: "#e9e2d4" });
      c && wf.colBox(c, x - (w + 0.7) / 2, 0, 0, x + (w + 0.7) / 2, top, depth, "platform");
    }
  }
}

/** Chimney on a roof at local (x, z) rising from y0 to y1. */
function chimney(wf, x, y0, z, y1, color = "#c0504d") {
  wf.boxB("solid", color, x, y0, z, 0.7, y1 - y0, 0.7);
  wf.boxB("solid", shade(color, 0.75), x, y1, z, 0.86, 0.16, 0.86);
  wf.boxB("solid", "#4a4f5a", x, y1 + 0.16, z, 0.4, 0.14, 0.4);
}

/** Striped awning with scalloped valance, out from the wall at y top. */
function awning(wf, x, y, w, color, depth = 1.45, drop = 0.6) {
  const slope = Math.atan2(drop, depth);
  const len = Math.hypot(depth, drop);
  const n = Math.max(4, Math.round(w / 0.5));
  const sw = w / n;
  for (let i = 0; i < n; i++) {
    const sx = x - w / 2 + sw * (i + 0.5);
    const col = i % 2 ? COL.cream : color;
    wf.box("cloth", col, sx, y - drop / 2, depth / 2, sw, 0.05, len, [slope, 0, 0]);
    wf.box("cloth", col, sx, y - drop - 0.14, depth, sw, 0.28, 0.04);
    wf.cyl("cloth", col, sx, y - drop - 0.28, depth, sw, 0.04, 10, 1, [Math.PI / 2, 0, 0]);
  }
  // metal brackets
  for (const s of [-1, 1]) wf.box("solid", COL.metal, x + s * (w / 2 - 0.1), y - drop / 2 - 0.1, depth / 2, 0.05, 0.05, len, [slope, 0, 0]);
}

/** Painted sign board (atlas quad on a wooden backing). */
function signBoard(ctx, wf, x, y, w, h, uv, frame = COL.woodDark) {
  wf.rbox("solid", frame, x, y, 0.08, w + 0.2, h + 0.2, 0.14, 0.05);
  wf.quad("sign", null, x, y, 0.155, w, h, 0, uv);
}

// -------------------------------------------------------------- mascots --
function mascot(kind, f, x, y, z) {
  switch (kind) {
    case "cone": {
      f.cylB("solid", "#d9cdb8", x, y, z, 1.2, 0.3, 12);
      f.cyl("solid", "#e8b06a", x, y + 1.6, z, 1.7, 2.6, 14, 0.04, [Math.PI, 0, 0], { grad: [y, y + 3, 0.8, 1.05] });
      for (let i = 0; i < 4; i++) {
        f.box("solid", "#c98d4c", x, y + 1.9, z, 1.72 - 0.0, 0.05, 0.06, [0, (i / 4) * Math.PI, 0.55]);
      }
      f.sphere("solid", "#ffd1e8", x, y + 3.15, z, 2.0, 1.75, 2.0, 8);
      f.sphere("solid", "#a8e6cf", x, y + 4.35, z, 1.6, 1.45, 1.6, 8);
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * TAU;
        f.sphere("solid", "#ffd1e8", x + Math.sin(a) * 0.9, y + 2.55 - (i % 2) * 0.15, z + Math.cos(a) * 0.9, 0.45, 0.6, 0.45, 4);
      }
      f.sphere("solid", "#ff3b5c", x, y + 5.25, z, 0.5, 0.5, 0.5, 6);
      f.cyl("solid", "#3f8f45", x + 0.12, y + 5.6, z, 0.06, 0.45, 5, 1, [0, 0, -0.4]);
      for (let i = 0; i < 9; i++) {
        const a = i * 2.4;
        f.box("solid", PALETTE.flowers[i % 6], x + Math.sin(a) * 0.7, y + 4.4 + (i % 3) * 0.25, z + Math.cos(a) * 0.7, 0.18, 0.06, 0.06, [0, a, 0.6]);
      }
      return 5.8;
    }
    case "cup": {
      f.cylB("solid", COL.white, x, y, z, 2.4, 0.16, 18);
      f.cylB("solid", COL.white, x, y + 0.16, z, 1.6, 1.25, 18, 1.18);
      f.cylB("solid", "#ff8c42", x, y + 0.6, z, 1.78, 0.25, 18);
      f.cylB("solid", "#6b3e1f", x, y + 1.38, z, 1.75, 0.02, 18);
      const handle = [];
      for (let i = 0; i <= 10; i++) {
        const a = -Math.PI / 2 + (i / 10) * Math.PI;
        handle.push([x + 0.95 + Math.cos(a) * 0.38, y + 0.85 + Math.sin(a) * 0.38, z]);
      }
      f.tube("solid", COL.white, handle, 0.09, 6);
      for (let i = 0; i < 3; i++) f.sphere("solid", "#ffffff", x + (i - 1) * 0.35, y + 2.0 + i * 0.45, z + Math.sin(i) * 0.2, 0.55 - i * 0.1, 0.5 - i * 0.1, 0.55, 5);
      return 3.2;
    }
    case "cupcake": {
      f.cylB("solid", "#ff9ecb", x, y, z, 1.6, 1.0, 16, 1.3);
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * TAU;
        f.box("solid", "#ff7fb8", x + Math.sin(a) * 0.92, y + 0.5, z + Math.cos(a) * 0.92, 0.1, 1.0, 0.06, [0, a, 0]);
      }
      f.sphere("solid", "#fff3e0", x, y + 1.25, z, 2.3, 0.9, 2.3, 8);
      f.sphere("solid", "#fff3e0", x, y + 1.75, z, 1.6, 0.8, 1.6, 8);
      f.sphere("solid", "#fff3e0", x, y + 2.2, z, 0.9, 0.7, 0.9, 6);
      f.sphere("solid", "#ff3b5c", x, y + 2.65, z, 0.5, 0.5, 0.5, 6);
      for (let i = 0; i < 14; i++) {
        const a = i * 2.4;
        const r = 0.5 + (i % 3) * 0.25;
        f.box("solid", PALETTE.flowers[i % 6], x + Math.sin(a) * r, y + 1.6 + (i % 4) * 0.15, z + Math.cos(a) * r, 0.2, 0.07, 0.07, [0, a, 0]);
      }
      return 3.0;
    }
    case "duck": {
      f.sphere("solid", "#ffd93d", x, y + 0.8, z, 2.2, 1.5, 2.6, 8);
      f.sphere("solid", "#ffd93d", x, y + 2.0, z + 0.65, 1.3, 1.3, 1.3, 8);
      f.sphere("solid", "#ff8c42", x, y + 1.9, z + 1.35, 0.6, 0.25, 0.6, 6);
      for (const s of [-1, 1]) {
        f.sphere("solid", "#1d2b3a", x + s * 0.32, y + 2.25, z + 1.18, 0.18, 0.24, 0.12, 4);
        f.sphere("solid", "#ffc61a", x + s * 1.0, y + 0.95, z - 0.1, 0.5, 0.7, 1.1, 5, [0.3, 0, s * 0.3]);
      }
      f.sphere("solid", "#ffd93d", x, y + 1.2, z - 1.3, 0.7, 0.8, 0.6, 5, [-0.6, 0, 0]);
      return 2.8;
    }
    case "books": {
      const cols = ["#e05d5d", "#4d96ff", "#6bcb77"];
      let yy = y;
      for (let i = 0; i < 3; i++) {
        const h = 0.5;
        f.rbox("solid", cols[i], x, yy + h / 2, z, 2.2 - i * 0.2, h, 1.6 - i * 0.1, 0.06, [0, i * 0.35 - 0.3, 0]);
        f.box("solid", "#fff8e1", x + 0.05, yy + h / 2, z, 2.1 - i * 0.2, h * 0.7, 1.62 - i * 0.1, [0, i * 0.35 - 0.3, 0]);
        yy += h;
      }
      // open book on top
      for (const s of [-1, 1]) f.box("solid", "#fffaf0", x + s * 0.5, yy + 0.12, z, 1.0, 0.06, 1.3, [0, 0, s * 0.18]);
      f.box("solid", "#c0504d", x, yy + 0.04, z, 2.1, 0.06, 1.35);
      return 2.0;
    }
    case "flower": {
      f.cylB("solid", "#3f8f45", x, y, z, 0.18, 2.4, 6);
      f.sphere("solid", "#4caf50", x + 0.4, y + 1.0, z, 0.9, 0.2, 0.45, 4, [0, 0, 0.5]);
      f.sphere("solid", "#4caf50", x - 0.4, y + 1.4, z, 0.9, 0.2, 0.45, 4, [0, 0, -0.5]);
      const cy = y + 2.6;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TAU;
        f.sphere("solid", "#ffffff", x + Math.sin(a) * 0.62, cy + Math.cos(a) * 0.62, z, 0.62, 0.62, 0.22, 5, [0, 0, -a]);
      }
      f.sphere("solid", "#ffd93d", x, cy, z + 0.05, 0.62, 0.62, 0.35, 6);
      return 3.4;
    }
    case "apple": {
      f.sphere("solid", "#ff4d4d", x, y + 0.9, z, 1.9, 1.7, 1.9, 8);
      f.sphere("solid", "#ff6b6b", x - 0.35, y + 1.3, z + 0.55, 0.5, 0.4, 0.3, 4);
      f.cyl("solid", "#7a4a28", x, y + 1.9, z, 0.12, 0.5, 5);
      f.sphere("solid", "#4caf50", x + 0.3, y + 2.0, z, 0.6, 0.12, 0.3, 4, [0, 0, -0.4]);
      return 2.3;
    }
    default:
      return 0;
  }
}

// ---------------------------------------------------------- house types --
function foundationAndWalls(ctx, f, w, d, H, wall) {
  f.boxB("solid", COL.stoneDark, 0, 0, -d / 2, w + 0.24, BASE, d + 0.24, null, { top: COL.stone });
  f.boxB("solid", wall, 0, BASE, -d / 2, w, H, d, null, { grad: [f.pt(0, 0, 0)[1] + BASE, f.pt(0, 0, 0)[1] + BASE + 2.2, 0.86, 1] });
  // corner boards
  for (const sx of [-1, 1]) for (const sz of [0, -d]) f.boxB("solid", COL.white, sx * (w / 2), BASE, sz, 0.2, H, 0.2);
}

/** Wall frames: front, back, left (-X), right (+X). */
function walls(f, w, d) {
  return {
    front: f.child(0, 0, 0, 0),
    back: f.child(0, 0, -d, Math.PI),
    right: f.child(w / 2, 0, -d / 2, Math.PI / 2),
    left: f.child(-w / 2, 0, -d / 2, -Math.PI / 2),
  };
}

function cottage(ctx, f, L) {
  const { rng } = ctx;
  const { w, d, wall, roof } = L;
  const H = 3.0;
  const shut = SHUTTERS[Math.floor(rng() * SHUTTERS.length)];
  const doorCol = DOORS[Math.floor(rng() * DOORS.length)];
  foundationAndWalls(ctx, f, w, d, H, wall);
  const wf = walls(f, w, d);
  const top = BASE + H;
  // roof
  const ridge = L.ridge ?? "x";
  f.box("solid", COL.white, 0, top - 0.06, -d / 2, w + 0.12, 0.12, d + 0.12);
  const rise = f.gable("solid", roof, wall, COL.white, 0, top, -d / 2, w, d, { ridge, pitch: 0.68, overhang: 0.4 });
  // front
  const doorX = ridge === "z" ? 0 : -w * 0.22;
  door(ctx, wf.front, doorX, BASE, 1.05, 2.15, doorCol);
  // little porch canopy over the door
  const pc = wf.front.child(doorX, BASE + 2.55, 0.55, 0);
  pc.gable("solid", roof, COL.white, COL.white, 0, 0, 0, 1.7, 1.1, { ridge: "z", pitch: 0.6, overhang: 0.1, thick: 0.1 });
  for (const s of [-1, 1]) pc.box("solid", COL.white, s * 0.75, -0.25, -0.2, 0.08, 0.5, 0.08, [0.6, 0, 0]);
  if (ridge === "z") {
    for (const s of [-1, 1]) win(ctx, wf.front, s * w * 0.3, BASE + 1.55, 1.0, 1.25, { shutters: shut, box: true });
    // round attic window in the gable
    const ay = top + rise * 0.42;
    wf.front.cyl("solid", COL.white, 0, ay, 0.04, 1.0, 0.1, 16, 1, [Math.PI / 2, 0, 0]);
    attic(wf.front, 0, ay, ctx.rng);
  } else {
    win(ctx, wf.front, w * 0.2, BASE + 1.55, 1.5, 1.25, { shutters: shut, box: true });
    // dormer on the front slope
    const dz = -d / 2 + d * 0.28;
    const dy = top + rise * 0.3;
    const dm = f.child(w * 0.12, dy, dz + 0.6, 0);
    dm.boxB("solid", wall, 0, 0, -0.4, 1.4, 1.3, 1.6);
    dm.gable("solid", roof, wall, COL.white, 0, 1.3, -0.4, 1.4, 1.6, { ridge: "z", pitch: 0.7, overhang: 0.15, thick: 0.12 });
    win(ctx, dm, 0, 0.7, 0.7, 0.75, { mullions: true });
  }
  // sides & back
  for (const side of [wf.left, wf.right]) win(ctx, side, 0, BASE + 1.6, 1.0, 1.2, { shutters: shut });
  win(ctx, wf.back, -w * 0.22, BASE + 1.6, 1.0, 1.2, {});
  win(ctx, wf.back, w * 0.22, BASE + 1.6, 1.0, 1.2, {});
  chimney(f, w * 0.28 * (ctx.rng() > 0.5 ? 1 : -1), top + rise * 0.3, -d * 0.62, top + rise + 0.9);
  return top + rise + 1.1;
}

function attic(wf, x, y, rng) {
  wf.quad(pickGlass(rng), null, x, y, 0.1, 0.62, 0.62);
  wf.box("solid", COL.white, x, y, 0.12, 0.06, 0.66, 0.04);
  wf.box("solid", COL.white, x, y, 0.12, 0.66, 0.06, 0.04);
}

function townhouse(ctx, f, L) {
  const { rng } = ctx;
  const { w, d, wall, roof } = L;
  const floors = L.floors ?? 2;
  const FH = 2.9;
  const H = floors * FH + 0.3;
  const shut = SHUTTERS[Math.floor(rng() * SHUTTERS.length)];
  const doorCol = DOORS[Math.floor(rng() * DOORS.length)];
  const trim = rng() > 0.5 ? COL.white : "#fff3d6";
  foundationAndWalls(ctx, f, w, d, H, wall);
  const wf = walls(f, w, d);
  const top = BASE + H;
  // floor bands
  for (let i = 1; i < floors; i++) f.box("solid", trim, 0, BASE + i * FH + 0.15, -d / 2, w + 0.1, 0.14, d + 0.1);
  const cols = w >= 8 ? 3 : 2;
  const xs = cols === 3 ? [-w * 0.32, 0, w * 0.32] : [-w * 0.24, w * 0.24];
  door(ctx, wf.front, cols === 3 ? 0 : -w * 0.24, BASE, 1.1, 2.3, doorCol, { trim });
  // transom light over the door
  for (let fl = 0; fl < floors; fl++) {
    const cy = BASE + fl * FH + 1.6;
    xs.forEach((x, i) => {
      if (fl === 0 && ((cols === 3 && i === 1) || (cols === 2 && i === 0))) return;
      win(ctx, wf.front, x, cy, 0.95, 1.45, { shutters: fl > 0 ? shut : null, box: fl === 1, trim, top: true });
    });
    for (const side of [wf.left, wf.right]) win(ctx, side, 0, cy, 0.9, 1.35, { trim, mullions: fl % 2 === 0 });
    win(ctx, wf.back, -w * 0.22, cy, 0.9, 1.35, { trim });
    win(ctx, wf.back, w * 0.22, cy, 0.9, 1.35, { trim });
  }
  // balcony on the 2nd floor
  if (floors >= 2) {
    const bx = cols === 3 ? 0 : w * 0.24;
    const by = BASE + FH + 0.2;
    const bf = wf.front;
    bf.boxB("solid", trim, bx, by - 0.16, 0.45, 1.9, 0.16, 0.9);
    bf.boxB("solid", COL.metal, bx, by + 0.85, 0.88, 1.9, 0.06, 0.06);
    for (const s of [-1, 1]) bf.boxB("solid", COL.metal, bx + s * 0.93, by + 0.85, 0.45, 0.06, 0.06, 0.9);
    for (let i = 0; i <= 8; i++) bf.boxB("solid", COL.metal, bx - 0.93 + (i * 1.86) / 8, by, 0.88, 0.04, 0.88, 0.04);
    for (const s of [-1, 1]) bf.sphere("solid", PALETTE.flowers[(i3(bx) + (s > 0 ? 1 : 3)) % 6], bx + s * 0.7, by + 0.2, 0.6, 0.4, 0.35, 0.4, 4);
  }
  // roof
  const style = L.roofStyle ?? "flat";
  f.box("solid", trim, 0, top + 0.12, -d / 2, w + 0.5, 0.26, d + 0.5);
  // dentils under the cornice (front only)
  for (let i = 0; i < Math.floor(w / 0.45); i++) wf.front.box("solid", trim, -w / 2 + 0.25 + i * 0.45, top - 0.06, 0.12, 0.18, 0.14, 0.18);
  let peak = top + 0.25;
  if (style === "mansard") {
    f.frustum("solid", roof, 0, top + 0.25, -d / 2, w + 0.2, d + 0.2, w - 1.6, d - 1.6, 1.8);
    f.box("solid", shade(roof, 0.85), 0, top + 2.1, -d / 2, w - 1.4, 0.12, d - 1.4);
    for (const x of xs) {
      const dm = f.child(x, top + 0.6, -0.55, 0);
      dm.boxB("solid", wall, 0, 0, -0.3, 0.95, 1.15, 0.7);
      dm.frustum("solid", roof, 0, 1.15, -0.3, 1.15, 0.9, 0.0, 0.9, 0.45);
      win(ctx, dm, 0, 0.6, 0.55, 0.65, { trim, mullions: false });
    }
    peak = top + 2.2;
  } else if (style === "hip") {
    const ridgeLen = Math.max(0.01, w - d * 0.9);
    f.frustum("solid", roof, 0, top + 0.25, -d / 2, w + 0.7, d + 0.7, ridgeLen, 0, 2.4);
    peak = top + 2.65;
    chimney(f, w * 0.25, top + 0.8, -d * 0.4, peak + 0.5);
  } else {
    // flat roof with parapet + rooftop bits
    f.boxB("solid", trim, 0, top + 0.25, -d / 2, w + 0.3, 0.55, d + 0.3);
    f.box("solid", "#8d8d99", 0, top + 0.81, -d / 2, w - 0.1, 0.02, d - 0.1);
    chimney(f, -w * 0.3, top + 0.8, -d * 0.7, top + 1.9);
    f.cylB("solid", "#a0673a", w * 0.22, top + 0.8, -d * 0.6, 1.2, 1.2, 10);
    f.frustum("solid", "#7a4a28", w * 0.22, top + 2.0, -d * 0.6, 1.3, 1.3, 0, 0, 0.6);
    peak = top + 1.2;
  }
  return peak;
}

const i3 = (x) => Math.abs(Math.round(x * 3));

function shop(ctx, f, L) {
  const { w, d, wall, roof } = L;
  const floors = L.floors ?? 2;
  const G = 3.5;
  const FH = 2.8;
  const H = floors === 1 ? G + 0.3 : G + (floors - 1) * FH + 0.2;
  const trim = COL.white;
  const shut = SHUTTERS[Math.floor(ctx.rng() * SHUTTERS.length)];
  foundationAndWalls(ctx, f, w, d, H, wall);
  const wf = walls(f, w, d);
  const front = wf.front;
  const top = BASE + H;
  // ---- ground floor: big display window + glazed door
  const dw = w * 0.5;
  const dx = w * 0.14;
  const doorX = -w * 0.3;
  front.box("solid", shade(L.awning, 0.9), dx, BASE + 0.3, 0.06, dw + 0.3, 0.6, 0.12);
  front.box("solid", trim, dx, BASE + 1.65, 0.05, dw + 0.3, 2.1, 0.1);
  front.quad("glassShop", null, dx, BASE + 1.65, 0.105, dw, 1.9);
  for (let i = 1; i < 3; i++) front.box("solid", trim, dx - dw / 2 + (dw * i) / 3, BASE + 1.65, 0.12, 0.06, 1.9, 0.04);
  door(ctx, front, doorX, BASE, 1.05, 2.35, L.awning, { glass: true });
  // awning over the shop front
  awning(front, (dx + doorX) / 2 + 0.05, BASE + 3.05, w - 0.5, L.awning);
  // painted sign above the awning
  const uv = ctx.atlas.shopSign(L.sign, L.style);
  const sw = Math.min(w - 0.6, 5.2);
  const sh = (sw * (uv[3] - uv[1])) / (uv[2] - uv[0]);
  signBoard(ctx, front, 0, BASE + 3.55 + (floors === 1 ? 0.05 : 0.1), sw, sh, uv);
  // ---- upper floors
  for (let fl = 1; fl < floors; fl++) {
    const cy = BASE + G + (fl - 1) * FH + 1.35;
    // raised a little and without window boxes so they clear the sign board
    for (const x of [-w * 0.25, w * 0.25]) win(ctx, front, x, cy + 0.45, 0.95, 1.3, { shutters: shut, top: fl === floors - 1 });
  }
  for (let fl = 0; fl < floors; fl++) {
    const cy = fl === 0 ? BASE + 1.7 : BASE + G + (fl - 1) * FH + 1.5;
    for (const side of [wf.left, wf.right]) win(ctx, side, -d * 0.0, cy, 0.9, 1.3, {});
    win(ctx, wf.back, 0, cy, 0.9, 1.3, {});
  }
  if (floors > 1) f.box("solid", trim, 0, BASE + G + 0.05, -d / 2, w + 0.1, 0.14, d + 0.1);
  // ---- roof: cornice + stepped false front, or a gable for 1-floor shops
  let roofTop;
  if (floors === 1) {
    f.box("solid", trim, 0, top - 0.06, -d / 2, w + 0.12, 0.12, d + 0.12);
    const rise = f.gable("solid", roof, wall, trim, 0, top, -d / 2, w, d, { ridge: "z", pitch: 0.6, overhang: 0.35 });
    roofTop = top + rise * 0.55;
    attic(front, 0, top + rise * 0.4, ctx.rng);
    if (L.mascot) {
      // mascot sits on a little platform at the front of the ridge
      f.boxB("solid", trim, 0, top + rise - 0.2, -1.4, 1.3, 0.25, 1.3);
      mascot(L.mascot, f, 0, top + rise + 0.05, -1.4);
    }
  } else {
    f.box("solid", trim, 0, top + 0.12, -d / 2, w + 0.5, 0.26, d + 0.5);
    f.boxB("solid", wall, 0, top + 0.25, -d / 2, w, 0.6, d);
    f.box("solid", trim, 0, top + 0.9, -d / 2, w + 0.3, 0.14, d + 0.3);
    f.box("solid", "#8d8d99", 0, top + 0.86, -d / 2, w - 0.1, 0.02, d - 0.1);
    // stepped false front
    front.boxB("solid", wall, 0, top + 0.9, -0.15, w * 0.46, 0.7, 0.3);
    front.box("solid", trim, 0, top + 1.62, -0.15, w * 0.5, 0.12, 0.42);
    front.cyl("solid", L.awning, 0, top + 1.2, 0.02, 0.5, 0.06, 14, 1, [Math.PI / 2, 0, 0]);
    roofTop = top + 0.9;
    if (L.mascot) mascot(L.mascot, f, 0, roofTop, -d * 0.55);
  }
  if (L.postBox) postBox(ctx, front, w * 0.5 + 0.2, 0, 0.6, 0);
  return roofTop + 2;
}

// ------------------------------------------------------------ Town Hall --
function townHall(ctx, f, L) {
  const c = ctx.colliders;
  const { w, d } = L;
  const wall = "#fdf0d5";
  const roof = "#5d7be0";
  const trim = "#ffffff";
  const P = 0.8; // plinth height
  const H = 8;
  const top = P + H;
  f.boxB("solid", COL.stoneDark, 0, 0, -d / 2, w + 0.6, P, d + 0.6, null, { top: COL.stone });
  f.boxB("solid", wall, 0, P, -d / 2, w, H, d, null, { grad: [CURB_H + P, CURB_H + P + 3, 0.88, 1] });
  const wf = walls(f, w, d);
  // pilasters + windows
  const bays = [-9, -6.6, 6.6, 9];
  for (const x of [-10.8, -7.8, -5.4, 5.4, 7.8, 10.8]) wf.front.boxB("solid", trim, x, P, 0.08, 0.5, H, 0.16);
  for (const x of bays) {
    win(ctx, wf.front, x, P + 2.1, 1.3, 2.2, { top: true, glass: "glass0" });
    win(ctx, wf.front, x, P + 5.8, 1.3, 2.0, { top: true, box: true });
  }
  for (const side of [wf.left, wf.right]) {
    for (const x of [-4.5, 0, 4.5]) {
      win(ctx, side, x, P + 2.1, 1.2, 2.1, { top: true, glass: "glass1" });
      win(ctx, side, x, P + 5.8, 1.2, 1.9, { top: true });
    }
  }
  for (const x of [-7.5, -2.5, 2.5, 7.5]) {
    win(ctx, wf.back, x, P + 2.1, 1.2, 2.1, {});
    win(ctx, wf.back, x, P + 5.8, 1.2, 1.9, {});
  }
  f.box("solid", trim, 0, P + 4.0, -d / 2, w + 0.12, 0.2, d + 0.12);
  // cornice + hip roof
  f.box("solid", trim, 0, top + 0.2, -d / 2, w + 0.9, 0.4, d + 0.9);
  f.frustum("solid", roof, 0, top + 0.4, -d / 2, w + 0.7, d + 0.7, w - d + 0.7, 0, 3.6);
  // ---- portico
  const pw = 9.4;
  const pd = 3.8;
  f.boxB("solid", COL.stoneDark, 0, 0, pd / 2, pw + 0.4, P, pd, null, { top: COL.stone });
  c && f.colBox(c, -(pw + 0.4) / 2, 0, 0, (pw + 0.4) / 2, P, pd, "platform");
  for (const x of [-3.6, -1.2, 1.2, 3.6]) {
    f.boxB("solid", trim, x, P, pd - 0.6, 0.85, 0.25, 0.85);
    f.cylB("solid", trim, x, P + 0.25, pd - 0.6, 0.62, 5.9, 14, 0.85);
    f.boxB("solid", trim, x, P + 6.15, pd - 0.6, 0.85, 0.3, 0.85);
    c && f.colCyl(c, x, pd - 0.6, 0.32, P, P + 6.4, "prop");
  }
  f.boxB("solid", trim, 0, P + 6.45, pd / 2 - 0.1, pw + 0.3, 1.0, pd + 0.3);
  const uv = ctx.atlas.banner("TOWN HALL", { bg: "#3c4a63", fg: "#ffe08a", h: 160 });
  f.quad("sign", null, 0, P + 6.95, pd + 0.06, 6.0, 0.94, 0, uv);
  // pediment
  const ped = f.child(0, P + 7.45, pd / 2 - 0.1, 0);
  ped.gable("solid", roof, trim, trim, 0, 0, 0, pw + 0.3, pd + 0.3, { ridge: "z", pitch: 0.38, overhang: 0.25 });
  ped.cyl("solid", "#f2c14e", 0, 0.75, pd / 2 + 0.2, 0.8, 0.08, 16, 1, [Math.PI / 2, 0, 0]);
  // big double door
  door(ctx, wf.front, -0.62, P, 1.2, 3.3, "#3fa66b", { steps: false });
  door(ctx, wf.front, 0.62, P, 1.2, 3.3, "#3fa66b", { steps: false });
  wf.front.quad("glass0", null, 0, P + 3.95, 0.11, 2.2, 0.55);
  // grand steps
  for (let i = 0; i < 4; i++) {
    const h = P * ((4 - i) / 4);
    const z0 = pd + i * 0.5;
    f.boxB("solid", "#d9d0c0", 0, 0, z0 + 0.25, pw + 1.2 - i * 0.3 + 1.2, h, 0.5, null, { top: "#ebe4d6" });
    c && f.colBox(c, -(pw + 2.4) / 2, 0, z0, (pw + 2.4) / 2, h, z0 + 0.5, "platform");
  }
  // ---- clock tower
  const tz = -6.5;
  const tw = 5;
  f.boxB("solid", wall, 0, top, tz, tw, 6.4, tw);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) f.boxB("solid", trim, sx * tw / 2, top, tz + sz * tw / 2, 0.35, 6.4, 0.35);
  const cs = top + 6.4;
  f.boxB("solid", trim, 0, cs - 0.1, tz, tw + 0.5, 0.25, tw + 0.5);
  f.boxB("solid", "#e9dcc0", 0, cs + 0.15, tz, tw + 0.3, 3.4, tw + 0.3);
  f.boxB("solid", trim, 0, cs + 3.55, tz, tw + 0.6, 0.3, tw + 0.6);
  // round louvred windows on the tower sides
  for (const side of [-1, 1]) {
    const sf = f.child(side * (tw / 2), top + 3.6, tz, side * E);
    sf.cyl("solid", trim, 0, 0, 0.04, 1.2, 0.12, 16, 1, [Math.PI / 2, 0, 0]);
    sf.quad("glassDark", null, 0, 0, 0.11, 0.8, 0.8);
  }
  const faceY = cs + 1.85;
  const faces = [];
  for (const fz of [1, -1]) {
    const ff = f.child(0, faceY, tz + fz * ((tw + 0.3) / 2), fz > 0 ? 0 : Math.PI);
    ff.cyl("solid", "#d4a017", 0, 0, 0.05, 2.9, 0.12, 24, 1, [Math.PI / 2, 0, 0]);
    // clock face as an atlas-textured disc
    const uvc = ctx.atlas.clockFace();
    const pts = [];
    const uvs = [];
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * TAU;
      pts.push([Math.sin(a) * 1.3, Math.cos(a) * 1.3, 0.12]);
      uvs.push([uvc[0] + (uvc[2] - uvc[0]) * (0.5 - Math.sin(a) * 0.5), uvc[1] + (uvc[3] - uvc[1]) * (0.5 + Math.cos(a) * 0.5)]);
    }
    ff.poly("sign", null, pts, [0, 0, 1], uvs);
    faces.push({ pos: ff.pt(0, 0, 0.16), yaw: ff.yaw });
  }
  ctx.clockFaces.push(...faces);
  // belfry: open arches with a golden bell
  const bf = cs + 3.7;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) f.boxB("solid", trim, sx * 2.1, bf, tz + sz * 2.1, 0.6, 2.8, 0.6);
  f.boxB("solid", "#e9dcc0", 0, bf, tz, 3.4, 0.3, 3.4);
  f.cylB("solid", COL.gold, 0, bf + 1.2, tz, 1.2, 1.1, 14, 0.5);
  f.sphere("solid", COL.gold, 0, bf + 2.3, tz, 0.6, 0.5, 0.6, 6);
  f.box("solid", trim, 0, bf + 2.95, tz, tw + 0.6, 0.35, tw + 0.6);
  f.frustum("solid", roof, 0, bf + 3.1, tz, tw + 0.3, tw + 0.3, 0, 0, 5.2);
  f.cylB("solid", COL.gold, 0, bf + 8.2, tz, 0.08, 1.4, 6);
  f.sphere("solid", COL.gold, 0, bf + 8.35, tz, 0.4, 0.4, 0.4, 6);
  f.poly("cloth", "#e05d5d", [[0, bf + 9.5, tz], [0, bf + 9.05, tz], [0.95, bf + 9.28, tz]], [0, 0, 1]);
  // ---- forecourt: flagpoles and flower beds
  for (const s of [-1, 1]) {
    const fx = s * 7.5;
    const fz = 6.6;
    f.cylB("solid", "#d9d0c0", fx, 0, fz, 0.8, 0.3, 10);
    f.cylB("solid", COL.metalLight, fx, 0.3, fz, 0.12, 8.5, 8);
    f.sphere("solid", COL.gold, fx, 8.9, fz, 0.25, 0.25, 0.25, 6);
    const flag = s > 0 ? ["#4d96ff", "#ffd93d"] : ["#e05d5d", "#ffffff"];
    f.box("cloth", flag[0], fx + s * 0.95, 7.9, fz, 1.8, 0.55, 0.03);
    f.box("cloth", flag[1], fx + s * 0.95, 7.35, fz, 1.8, 0.55, 0.03);
    c && f.colCyl(c, fx, fz, 0.4, 0, 8.8, "prop");
    flowerBed(ctx, f, s * 12.5, 0, 4.2, 1.7, s > 0 ? 2 : 4);
  }
  c && f.colBox(c, -w / 2 - 0.3, 0, -d - 0.3, w / 2 + 0.3, top + 4, 0, "building");
  c && f.colBox(c, -tw / 2, top, tz - tw / 2, tw / 2, bf + 9, tz + tw / 2, "building");
  return bf + 9.5;
}

// ---------------------------------------------------------------- build --
/**
 * Build every building and its front garden. Pushes map features,
 * landmarks and footprints into ctx; returns nothing.
 */
export function buildBuildings(ctx) {
  const { root, colliders, map, landmarks, footprints, rng } = ctx;
  for (const L of LOTS) {
    const f = root.child(L.x, CURB_H, L.z, L.f);
    let height;
    if (L.type === "hall") height = townHall(ctx, f, L);
    else if (L.type === "shop") height = shop(ctx, f, L);
    else if (L.type === "townhouse") height = townhouse(ctx, f, L);
    else height = cottage(ctx, f, L);

    if (L.type !== "hall") f.colBox(colliders, -L.w / 2 - 0.12, -CURB_H, -L.d - 0.12, L.w / 2 + 0.12, height, 0.12, "building");

    // world footprint for minimap and yard filling
    const a = f.pt(-L.w / 2, 0, -L.d);
    const b = f.pt(L.w / 2, 0, 0);
    const x0 = Math.min(a[0], b[0]);
    const x1 = Math.max(a[0], b[0]);
    const z0 = Math.min(a[2], b[2]);
    const z1 = Math.max(a[2], b[2]);
    const label = L.type === "hall" ? "Town Hall" : L.landmark;
    map.push({ kind: "building", x: (x0 + x1) / 2, z: (z0 + z1) / 2, w: x1 - x0, d: z1 - z0, color: L.type === "hall" ? "#fdf0d5" : L.wall, ...(label ? { label } : {}) });
    const yard = L.yard ?? 1;
    const ya = f.pt(-L.w / 2 - 1.5, 0, yard);
    const yb = f.pt(L.w / 2 + 1.5, 0, -L.d - 1.2);
    footprints.push({
      x0: Math.min(ya[0], yb[0]),
      x1: Math.max(ya[0], yb[0]),
      z0: Math.min(ya[2], yb[2]),
      z1: Math.max(ya[2], yb[2]),
    });
    if (label) {
      const door = f.pt(0, 0, 2);
      landmarks.push({ name: label, x: door[0], z: door[2], icon: L.icon ?? (L.type === "hall" ? "🏛️" : undefined) });
    }

    // front gardens for homes: picket fence with a gate, path, mailbox, shrubs
    if ((L.type === "cottage" || L.type === "townhouse") && yard >= 2) {
      const fz = yard - 0.25;
      // fence spans the lot but never steps onto a sidewalk
      let left = -(L.w / 2 + 1.2);
      let right = L.w / 2 + 1.2;
      while (left < -L.w / 2 && onSidewalk(f.pt(left, 0, fz))) left += 0.25;
      while (right > L.w / 2 && onSidewalk(f.pt(right, 0, fz))) right -= 0.25;
      const gate = L.type === "cottage" && (L.ridge ?? "x") === "z" ? 0 : L.type === "cottage" ? -L.w * 0.22 : L.w >= 8 ? 0 : -L.w * 0.24;
      const fenceCol = rng() > 0.3 ? COL.white : "#fff1d6";
      picketFence(ctx, f, left, fz, gate - 0.8, fz, 0, fenceCol);
      picketFence(ctx, f, gate + 0.8, fz, right, fz, 0, fenceCol);
      // garden path
      f.flat("flat", "#e2d6c0", gate, 0.004, (yard + 0.4) / 2, 1.2, yard - 0.4);
      mailbox(ctx, f, gate + 1.25, 0, fz - 0.35, 0, DOORS[Math.floor(rng() * DOORS.length)]);
      // shrubs along the facade
      for (const s of [-1, 1]) {
        const sx = gate + s * (L.w * 0.32);
        if (Math.abs(sx) < L.w / 2 - 0.6) tree(ctx, f, sx, 0, 0.75, "bush", 0.55, Math.floor(L.x * 7 + s));
      }
    }
  }
}

// Roads (asphalt, dashed centre lines, zebra crossings, dead-end barriers),
// raised blocks with sidewalk rings, curbs and paving joints.
import { PALETTE } from "../palette.js";
import { ROADS, BLOCKS, PARK_WALKS, SIDEWALK, CURB_H, ROAD_Y, PLAZA_R, onRoad } from "./layout.js";
import { shade } from "./geo.js";

const LAWN = "#8fd16a";
const JOINT = shade(PALETTE.sidewalk, 0.86);
const CURB_TOP = "#ece6da";
const MAP_CLIP = 92;

function clipRect(r) {
  const x0 = Math.max(r.x0, -MAP_CLIP);
  const x1 = Math.min(r.x1, MAP_CLIP);
  const z0 = Math.max(r.z0, -MAP_CLIP);
  const z1 = Math.min(r.z1, MAP_CLIP);
  return x1 > x0 && z1 > z0 ? { x: (x0 + x1) / 2, z: (z0 + z1) / 2, w: x1 - x0, d: z1 - z0 } : null;
}

/** Sidewalk strip with joints and a light curb-stone edge on the road side. */
function sidewalkStrip(ctx, x0, z0, x1, z1, roadSide) {
  const { root, map } = ctx;
  const y = CURB_H + 0.005;
  root.flat("flat", PALETTE.sidewalk, (x0 + x1) / 2, y, (z0 + z1) / 2, x1 - x0, z1 - z0);
  const alongX = x1 - x0 > z1 - z0;
  const len = alongX ? x1 - x0 : z1 - z0;
  const n = Math.floor(len / 2.4);
  for (let i = 1; i < n; i++) {
    const t = (alongX ? x0 : z0) + (i * len) / n;
    if (alongX) root.flat("flat", JOINT, t, y + 0.004, (z0 + z1) / 2, 0.06, z1 - z0);
    else root.flat("flat", JOINT, (x0 + x1) / 2, y + 0.004, t, x1 - x0, 0.06);
  }
  // centre seam
  if (alongX) root.flat("flat", JOINT, (x0 + x1) / 2, y + 0.004, (z0 + z1) / 2, x1 - x0, 0.05);
  else root.flat("flat", JOINT, (x0 + x1) / 2, y + 0.004, (z0 + z1) / 2, 0.05, z1 - z0);
  // curb stone on the road side
  const c = 0.32;
  if (roadSide === "s") root.flat("flat", CURB_TOP, (x0 + x1) / 2, y + 0.007, z0 + c / 2, x1 - x0, c);
  if (roadSide === "n") root.flat("flat", CURB_TOP, (x0 + x1) / 2, y + 0.007, z1 - c / 2, x1 - x0, c);
  if (roadSide === "w") root.flat("flat", CURB_TOP, x0 + c / 2, y + 0.007, (z0 + z1) / 2, c, z1 - z0);
  if (roadSide === "e") root.flat("flat", CURB_TOP, x1 - c / 2, y + 0.007, (z0 + z1) / 2, c, z1 - z0);
  map.push({ kind: "sidewalk", x: (x0 + x1) / 2, z: (z0 + z1) / 2, w: x1 - x0, d: z1 - z0, color: PALETTE.sidewalk });
}

/** Market square: tile grid + a warmer central aisle. */
function marketPaving(ctx, b) {
  const { root } = ctx;
  const y = CURB_H + 0.004;
  const x0 = b.x0 + SIDEWALK;
  const x1 = b.x1 - SIDEWALK;
  const z0 = b.z0 + SIDEWALK;
  const z1 = b.z1 - SIDEWALK;
  root.flat("flat", "#e6d3ad", (x0 + x1) / 2, y, -20, x1 - x0, 8.6);
  const line = shade(PALETTE.plazaAccent, 0.95);
  for (let x = x0 + 2; x < x1 - 0.5; x += 2) root.flat("flat", line, x, y + 0.003, (z0 + z1) / 2, 0.06, z1 - z0);
  for (let z = z0 + 2; z < z1 - 0.5; z += 2) root.flat("flat", line, (x0 + x1) / 2, y + 0.003, z, x1 - x0, 0.06);
  for (const z of [-24.3, -15.7]) root.flat("flat", PALETTE.plazaAccent, (x0 + x1) / 2, y + 0.005, z, x1 - x0, 0.25);
}

function buildBlocks(ctx) {
  const { root, colliders, map } = ctx;
  for (const b of BLOCKS) {
    const top = b.kind === "market" ? PALETTE.plaza : LAWN;
    root.boxB("flat", PALETTE.curb, (b.x0 + b.x1) / 2, -0.06, (b.z0 + b.z1) / 2, b.x1 - b.x0, CURB_H + 0.06, b.z1 - b.z0, null, { top });
    colliders.addBox(b.x0, 0, b.z0, b.x1, CURB_H, b.z1, "platform");
    if (b.kind === "market") marketPaving(ctx, b);
    if (b.kind === "market") map.push({ kind: "plaza", x: (b.x0 + b.x1) / 2, z: (b.z0 + b.z1) / 2, w: b.x1 - b.x0, d: b.z1 - b.z0, color: PALETTE.plaza });
    else map.push({ kind: "park", x: (b.x0 + b.x1) / 2, z: (b.z0 + b.z1) / 2, w: b.x1 - b.x0, d: b.z1 - b.z0, color: LAWN });
    const S = SIDEWALK;
    if (b.walk.includes("s")) sidewalkStrip(ctx, b.x0, b.z0, b.x1, b.z0 + S, "s");
    if (b.walk.includes("n")) sidewalkStrip(ctx, b.x0, b.z1 - S, b.x1, b.z1, "n");
    if (b.walk.includes("w")) sidewalkStrip(ctx, b.x0, b.z0, b.x0 + S, b.z1, "w");
    if (b.walk.includes("e")) sidewalkStrip(ctx, b.x1 - S, b.z0, b.x1, b.z1, "e");
    // shop blocks: paved forecourt band between sidewalk and shop fronts
    if (b.kind === "shops") {
      const y = CURB_H + 0.004;
      const P = PALETTE.plazaAccent;
      const inner = 1.4;
      root.flat("flat", P, (b.x0 + b.x1) / 2, y, b.z0 + S + inner / 2, b.x1 - b.x0 - 2 * S, inner);
      if (b.x0 > 0) root.flat("flat", P, b.x0 + S + inner / 2, y, (b.z0 + b.z1) / 2, inner, b.z1 - b.z0 - 2 * S);
      else root.flat("flat", P, b.x1 - S - inner / 2, y, (b.z0 + b.z1) / 2, inner, b.z1 - b.z0 - 2 * S);
    }
  }
  // Maple Park sidewalks along the avenues
  for (const w of PARK_WALKS) {
    root.boxB("flat", PALETTE.curb, (w.x0 + w.x1) / 2, -0.06, (w.z0 + w.z1) / 2, w.x1 - w.x0, CURB_H + 0.06, w.z1 - w.z0, null, { top: PALETTE.sidewalk });
    colliders.addBox(w.x0, 0, w.z0, w.x1, CURB_H, w.z1, "platform");
    const vertical = w.z1 - w.z0 > w.x1 - w.x0;
    sidewalkStrip(ctx, w.x0, w.z0, w.x1, w.z1, vertical ? "e" : "n");
  }
}

function buildRoads(ctx) {
  const { root, map } = ctx;
  const y = ROAD_Y;
  for (const r of ROADS) {
    root.boxB("flat", shade(PALETTE.road, 0.85), (r.x0 + r.x1) / 2, -0.12, (r.z0 + r.z1) / 2, r.x1 - r.x0, 0.12 + y, r.z1 - r.z0, null, { top: PALETTE.road });
    const c = clipRect(r);
    if (c) map.push({ kind: "road", ...c, color: PALETTE.road, label: r.name });
  }

  // dashed yellow centre lines, skipping junctions and the square
  const ly = y + 0.012;
  for (const r of ROADS) {
    const alongZ = r.axis === "z";
    const c = alongZ ? (r.x0 + r.x1) / 2 : (r.z0 + r.z1) / 2;
    const a0 = Math.max(alongZ ? r.z0 : r.x0, -300);
    const a1 = Math.min(alongZ ? r.z1 : r.x1, 300);
    for (let t = a0 + 2; t < a1 - 1; t += 4.5) {
      const px = alongZ ? c : t;
      const pz = alongZ ? t : c;
      if (Math.hypot(px, pz) < PLAZA_R + 5) continue;
      let crossing = false;
      for (const q of ROADS) {
        if (q === r) continue;
        if (px >= q.x0 - 4 && px <= q.x1 + 4 && pz >= q.z0 - 4 && pz <= q.z1 + 4) crossing = true;
      }
      if (crossing) continue;
      if (alongZ) root.flat("flat", PALETTE.roadLine, px, ly, pz + 1, 0.18, 2.1);
      else root.flat("flat", PALETTE.roadLine, px + 1, ly, pz, 2.1, 0.18);
    }
  }

  // zebra crossings on every arm leaving a junction
  const zebra = (r, at, dir) => {
    // band from `at` (junction edge) 0.8..3.8 m outward along the road axis
    const alongZ = r.axis === "z";
    const w = alongZ ? r.x1 - r.x0 : r.z1 - r.z0;
    const lo = alongZ ? r.x0 : r.z0;
    const n = Math.floor(w / 1.0);
    for (let i = 0; i < n; i++) {
      const s = lo + 0.5 + i * (w / n) + (w / n - 0.55) / 2;
      const m = at + dir * 2.3;
      if (alongZ) root.flat("flat", PALETTE.crosswalk, s, ly, m, 0.55, 3.0);
      else root.flat("flat", PALETTE.crosswalk, m, ly, s, 3.0, 0.55);
    }
    // stop line
    const m2 = at + dir * 4.3;
    if (alongZ) root.flat("flat", PALETTE.crosswalk, (r.x0 + r.x1) / 2, ly, m2, w - 0.6, 0.3);
    else root.flat("flat", PALETTE.crosswalk, m2, ly, (r.z0 + r.z1) / 2, 0.3, w - 0.6);
  };
  for (const r of ROADS) {
    for (const q of ROADS) {
      if (q === r || q.axis === r.axis) continue;
      const ix0 = Math.max(r.x0, q.x0);
      const ix1 = Math.min(r.x1, q.x1);
      const iz0 = Math.max(r.z0, q.z0);
      const iz1 = Math.min(r.z1, q.z1);
      if (ix1 <= ix0 || iz1 <= iz0) continue;
      if (r.axis === "z") {
        if (r.z0 < iz0 - 6) zebra(r, iz0, -1);
        if (r.z1 > iz1 + 6) zebra(r, iz1, 1);
      } else {
        if (r.x0 < ix0 - 6) zebra(r, ix0, -1);
        if (r.x1 > ix1 + 6) zebra(r, ix1, 1);
      }
    }
  }
  // crossings where the avenues meet the square
  const p = PLAZA_R + 0.6;
  zebra(ROADS.find((r) => r.id === "mainN"), p, 1);
  zebra(ROADS.find((r) => r.id === "mainS"), -p, -1);
  zebra(ROADS.find((r) => r.id === "elmE"), p, 1);
  zebra(ROADS.find((r) => r.id === "elmW"), -p, -1);

  // manhole covers
  for (const [mx, mz] of [[1.8, 27], [-2, -30], [26, -1.6], [-24, 2], [40.5, 20], [-40, 60], [60, 40.2], [20, -40.6], [1.5, -62]]) {
    if (!onRoad(mx, mz)) continue;
    root.ring("flat", "#4a4e57", mx, ly, mz, 0, 0.42, 0, Math.PI * 2, 12);
    root.ring("flat", "#6a6e78", mx, ly + 0.002, mz, 0.3, 0.36, 0, Math.PI * 2, 12);
  }

  // dead ends at the town edge: striped barrier boards
  for (const r of ROADS) {
    if (r.outer) continue;
    for (const end of [-1, 1]) {
      const alongZ = r.axis === "z";
      const tip = alongZ ? (end > 0 ? r.z1 : r.z0) : end > 0 ? r.x1 : r.x0;
      if (Math.abs(tip) < 80) continue;
      const cx = alongZ ? (r.x0 + r.x1) / 2 : tip - end * 0.8;
      const cz = alongZ ? tip - end * 0.8 : (r.z0 + r.z1) / 2;
      const f = root.child(cx, 0, cz, alongZ ? 0 : Math.PI / 2);
      for (const s of [-2.6, 2.6]) f.boxB("solid", "#ffffff", s, 0, 0, 0.14, 1.2, 0.14);
      for (let i = 0; i < 8; i++) f.box("solid", i % 2 ? "#ffffff" : "#e23b3b", -2.6 + 0.325 + i * 0.65, 0.95, 0, 0.65, 0.3, 0.08);
    }
  }
}

/** Build every road, block slab, sidewalk and park walk. */
export function buildStreets(ctx) {
  buildRoads(ctx);
  buildBlocks(ctx);
}

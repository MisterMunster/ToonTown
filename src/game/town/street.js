// Street furniture: lamps, hydrants, bins and name signs along the curbs,
// parked cars, the bus stop, Market Row (stalls, crate staircase, barrels),
// trees/bushes in the back yards and hedges along the town edge.
import { PALETTE } from "../palette.js";
import { ROADS, BLOCKS, PARK_WALKS, SIDEWALK, CURB_H, ROAD_HALF, PLAZA_R, blockAt } from "./layout.js";
import { shade } from "./geo.js";
import { COL, lamp, hydrant, trashCan, streetSignPost, car, crate, barrel, bench, tree, hedge, flowerBed } from "./props.js";

const TAU = Math.PI * 2;

/** Points along every sidewalk curb (0.5 m in from the road edge). */
function curbSlots() {
  const slots = [];
  const add = (x0, z0, x1, z1, side) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.floor(len / 3);
    for (let i = 1; i < n; i++) {
      const t = i / n;
      slots.push({ x: x0 + (x1 - x0) * t, z: z0 + (z1 - z0) * t, side, used: false });
    }
  };
  const o = 0.5;
  for (const b of BLOCKS) {
    if (b.walk.includes("s")) add(b.x0 + 2, b.z0 + o, b.x1 - 2, b.z0 + o, "s");
    if (b.walk.includes("n")) add(b.x0 + 2, b.z1 - o, b.x1 - 2, b.z1 - o, "n");
    if (b.walk.includes("w")) add(b.x0 + o, b.z0 + 2, b.x0 + o, b.z1 - 2, "w");
    if (b.walk.includes("e")) add(b.x1 - o, b.z0 + 2, b.x1 - o, b.z1 - 2, "e");
  }
  for (const w of PARK_WALKS) {
    if (w.z1 - w.z0 > w.x1 - w.x0) add(w.x1 - o, w.z0 + 2, w.x1 - o, w.z1 - 2, "e");
    else add(w.x0 + 2, w.z1 - o, w.x1 - 2, w.z1 - o, "n");
  }
  // keep the square, junction mouths and bus stop clear
  return slots.filter((s) => Math.hypot(s.x, s.z) > PLAZA_R + 3.5 && !(s.x > 3 && s.x < 8 && s.z > -31 && s.z < -23));
}

function streetLights(ctx) {
  const { root } = ctx;
  const slots = curbSlots();
  // a lamp every ~18 m along each curb, plus bins and hydrants in between
  let k = 0;
  for (const s of slots) {
    if (k % 6 === 0) {
      lamp(ctx, root, s.x, CURB_H, s.z);
      s.used = true;
    } else if (k % 17 === 3) {
      hydrant(ctx, root, s.x + (s.side === "w" ? -0.08 : s.side === "e" ? 0.08 : 0), CURB_H, s.z + (s.side === "s" ? -0.08 : s.side === "n" ? 0.08 : 0));
      s.used = true;
    } else if (k % 13 === 8) {
      // bins sit a touch closer to the road so the sidewalk stays clear
      trashCan(ctx, root, s.x + (s.side === "w" ? -0.12 : s.side === "e" ? 0.12 : 0), CURB_H, s.z + (s.side === "s" ? -0.12 : s.side === "n" ? 0.12 : 0));
      s.used = true;
    }
    k++;
  }
  ctx.curbSlots = slots;
}

function streetSigns(ctx) {
  const { root, atlas } = ctx;
  const uvCache = new Map();
  const uv = (name) => {
    if (!uvCache.has(name)) uvCache.set(name, atlas.streetSign(name.toUpperCase()));
    return uvCache.get(name);
  };
  const done = new Set();
  for (const r of ROADS) {
    for (const q of ROADS) {
      if (r.axis !== "z" || q.axis !== "x") continue;
      const ix0 = Math.max(r.x0, q.x0);
      const ix1 = Math.min(r.x1, q.x1);
      const iz0 = Math.max(r.z0, q.z0);
      const iz1 = Math.min(r.z1, q.z1);
      if (ix1 <= ix0 || iz1 <= iz0) continue;
      const key = `${ix0},${iz0}`;
      if (done.has(key)) continue;
      // first corner that sits on a sidewalk
      for (const [cx, cz] of [[ix1 + 0.55, iz1 + 0.55], [ix0 - 0.55, iz1 + 0.55], [ix1 + 0.55, iz0 - 0.55], [ix0 - 0.55, iz0 - 0.55]]) {
        const onWalk = blockAt(cx, cz) || PARK_WALKS.some((w) => cx >= w.x0 && cx <= w.x1 && cz >= w.z0 && cz <= w.z1);
        if (!onWalk || Math.hypot(cx, cz) < PLAZA_R + 2) continue;
        streetSignPost(ctx, root, cx, CURB_H, cz, uv(q.name), uv(r.name));
        done.add(key);
        break;
      }
    }
  }
  // signs at the square's four avenue mouths
  streetSignPost(ctx, root, 4.55, CURB_H, 20.5, uv("Town Square"), uv("Main St"));
  streetSignPost(ctx, root, -20.5, CURB_H, -4.55, uv("Elm St"), uv("Maple Park"));
}

function parkedCars(ctx) {
  const { root } = ctx;
  const off = ROAD_HALF - 1.2;
  const cars = [
    [off, 29, 0, "#ff5d5d"],
    [-off, -57, Math.PI, "#4d96ff"],
    [27, -off, Math.PI / 2, "#ffd93d"],
    [-62, off, -Math.PI / 2, "#6bcb77"],
    [22, 40 + off, -Math.PI / 2, "#c77dff"],
    [40 + off, 62, 0, "#ff8c42"],
    [62, -40 - off, Math.PI / 2, "#00b4d8"],
    [-40 - off, 22, Math.PI, "#ff6b9d"],
    [-24, 40 - off, Math.PI / 2, "#ffffff"],
  ];
  for (const [x, z, ry, c] of cars) car(ctx, root, x, ROAD_Y_CAR, z, ry, c);
  ctx.cars = cars.map(([x, z]) => ({ x, z, top: 1.62 }));
}
const ROAD_Y_CAR = 0.03;

function busStop(ctx) {
  const { root, colliders, atlas } = ctx;
  // shelter faces west onto Main Street, standing just behind the sidewalk
  const f = root.child(8.1, CURB_H, -28, -Math.PI / 2);
  const W = 4.2;
  const D = 1.8;
  const H = 2.45;
  const frame = "#4d96ff";
  // back wall (local -Z) with tinted glass
  f.boxB("solid", frame, 0, 0, -D / 2 + 0.05, W, 0.12, 0.1);
  f.boxB("solid", "#bfe6ff", 0, 0.12, -D / 2 + 0.05, W - 0.2, H - 0.25, 0.05);
  for (const s of [-1, 1]) {
    f.boxB("solid", frame, s * (W / 2 - 0.06), 0, -D / 2 + 0.05, 0.12, H, 0.12);
    f.boxB("solid", frame, s * (W / 2 - 0.06), 0, D / 2 - 0.15, 0.12, H, 0.12);
    f.boxB("solid", "#bfe6ff", s * (W / 2 - 0.06), 0.3, -0.1, 0.05, H - 0.6, D - 0.5);
  }
  // curved-ish roof: two slabs + rim
  f.rbox("solid", frame, 0, H + 0.08, 0, W + 0.5, 0.16, D + 0.5, 0.06);
  f.rbox("solid", "#ffd93d", 0, H + 0.2, 0, W + 0.2, 0.08, D + 0.2, 0.04);
  // advert panel on one side + route sign
  const uv = atlas.badge("bus", "#4d96ff");
  f.quad("sign", null, W / 2 - 0.06, H - 0.6, -D / 2 + 0.11, 0.7, 0.7, 0, uv);
  bench(ctx, f, 0, 0, -D / 2 + 0.45, 0, "#ffd93d");
  colliders && f.colBox(colliders, -W / 2, 0, -D / 2, W / 2, H - 0.05, -D / 2 + 0.18, "prop");
  for (const s of [-1, 1]) f.colBox(colliders, s * (W / 2) - 0.1, 0, -D / 2, s * (W / 2) + 0.1, H - 0.05, D / 2 - 0.1, "prop");
  f.colBox(colliders, -W / 2 - 0.25, H - 0.05, -D / 2 - 0.25, W / 2 + 0.25, H + 0.24, D / 2 + 0.25, "platform");
  // bus stop sign post at the curb
  const p = root.child(4.6, CURB_H, -25.2, 0);
  p.cylB("solid", COL.metal, 0, 0, 0, 0.1, 2.8, 8);
  p.cyl("solid", "#4d96ff", 0, 2.75, 0, 0.75, 0.06, 20, 1, [0, 0, Math.PI / 2]);
  p.poly("sign", null, ring20(0.035, 2.75, 0.34), [1, 0, 0], ringUV(uv, 1));
  p.poly("sign", null, ring20(-0.035, 2.75, 0.34), [-1, 0, 0], ringUV(uv, -1));
  colliders.addCylinder(4.6, -25.2, 0.12, CURB_H, CURB_H + 3, "prop");
  ctx.busStop = { x: 8.1, z: -28, top: CURB_H + H + 0.24 };
  ctx.landmarks.push({ name: "Bus Stop", x: 8.1, z: -28, icon: "🚌" });
}
function ring20(x, y, r) {
  const pts = [];
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * TAU;
    pts.push([x, y + Math.cos(a) * r, Math.sin(a) * r]);
  }
  return pts;
}
/** uvs for ring20 points; flip = +1 for a +X facing disc, -1 for -X. */
function ringUV(uv, flip) {
  const out = [];
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * TAU;
    out.push([uv[0] + (uv[2] - uv[0]) * (0.5 + flip * Math.sin(a) * 0.46), uv[1] + (uv[3] - uv[1]) * (0.5 + Math.cos(a) * 0.46)]);
  }
  return out;
}

// ------------------------------------------------------------- market --
const GOODS = [
  { name: "apples", cols: ["#ff4d4d", "#ff6b6b", "#e23b3b"], awning: "#e05d5d" },
  { name: "oranges", cols: ["#ff9f1c", "#ffb347", "#ff8c42"], awning: "#ff8c42" },
  { name: "lemons", cols: ["#ffe14d", "#ffd93d", "#fff176"], awning: "#f2b134" },
  { name: "melons", cols: ["#6bcb77", "#4caf50", "#81c784"], awning: "#3fa66b" },
  { name: "berries", cols: ["#c77dff", "#9b5de5", "#ff6b9d"], awning: "#9b5de5" },
  { name: "bread", cols: ["#d9a066", "#c98a4b", "#e8b06a"], awning: "#8b4f2a" },
  { name: "flowers", cols: PALETTE.flowers, awning: "#ff6b9d" },
  { name: "cheese", cols: ["#ffd166", "#f6c453", "#ffe08a"], awning: "#4d96ff" },
];

function stall(ctx, x, z, ry, goods) {
  const { root, colliders } = ctx;
  const f = root.child(x, CURB_H, z, ry);
  const w = 3.6;
  // counter
  f.rbox("solid", COL.wood, 0, 0.5, -0.55, w, 1.0, 1.0, 0.06, null, { grad: [CURB_H, CURB_H + 1, 0.8, 1] });
  f.box("solid", shade(goods.awning, 1.0), 0, 0.55, -0.04, w - 0.3, 0.5, 0.04);
  f.box("solid", COL.woodDark, 0, 1.03, -0.55, w + 0.1, 0.06, 1.1);
  // produce: little pyramids of fruit in trays
  for (let t = 0; t < 3; t++) {
    const tx = -w / 2 + 0.6 + t * ((w - 1.2) / 2);
    f.box("solid", COL.woodDark, tx, 1.1, -0.5, 0.95, 0.1, 0.75);
    for (let i = 0; i < 6; i++) {
      const lx = tx - 0.3 + (i % 3) * 0.3;
      const lz = -0.68 + Math.floor(i / 3) * 0.3;
      f.sphere("solid", goods.cols[(i + t) % goods.cols.length], lx, 1.28, lz, 0.3, 0.27, 0.3, 3);
    }
    for (let i = 0; i < 2; i++) f.sphere("solid", goods.cols[(i + t + 1) % goods.cols.length], tx - 0.15 + i * 0.3, 1.5, -0.53, 0.3, 0.27, 0.3, 3);
  }
  // posts
  for (const sx of [-w / 2 + 0.08, w / 2 - 0.08]) {
    f.boxB("solid", COL.white, sx, 0, -0.05, 0.1, 2.35, 0.1);
    f.boxB("solid", COL.white, sx, 0, -2.2, 0.1, 2.75, 0.1);
    colliders.addCylinder(...xz(f, sx, -0.05), 0.08, CURB_H, CURB_H + 2.3, "prop");
    colliders.addCylinder(...xz(f, sx, -2.2), 0.08, CURB_H, CURB_H + 2.7, "prop");
  }
  // striped sloping awning roof with scallops
  const n = 8;
  const sw = (w + 0.4) / n;
  const back = 2.8;
  const front = 2.3;
  const depth = 2.9;
  const slope = Math.atan2(back - front, depth);
  const len = Math.hypot(depth, back - front);
  for (let i = 0; i < n; i++) {
    const sx = -(w + 0.4) / 2 + sw * (i + 0.5);
    const col = i % 2 ? COL.cream : goods.awning;
    f.box("cloth", col, sx, (back + front) / 2, -2.3 + depth / 2, sw, 0.06, len, [slope, 0, 0]);
    f.cyl("cloth", col, sx, front - 0.05, 0.6, sw, 0.05, 10, 1, [Math.PI / 2, 0, 0]);
  }
  colliders && f.colBox(colliders, -w / 2, 0, -1.05, w / 2, 1.05, 0, "platform");
  colliders && f.colBox(colliders, -(w + 0.4) / 2, 2.25, -2.35, (w + 0.4) / 2, 2.62, 0.6, "platform");
  return f;
}
const xz = (f, x, z) => {
  const p = f.pt(x, 0, z);
  return [p[0], p[2]];
};

function market(ctx) {
  const { root, colliders, atlas } = ctx;
  const xs = [14, 19, 24, 29];
  const stalls = [];
  xs.forEach((x, i) => {
    stall(ctx, x, -15.0, Math.PI, GOODS[i]);
    stall(ctx, x, -25.0, 0, GOODS[i + 4]);
    stalls.push({ x, z: -13.9, top: CURB_H + 2.62 }, { x, z: -26.1, top: CURB_H + 2.62 });
  });
  ctx.stalls = stalls;
  // crate staircase (1, 2, 3 high) in the south-east corner
  const cy = CURB_H;
  const cz = -30.6;
  crate(ctx, root, 26.2, cy, cz, 1);
  crate(ctx, root, 27.3, cy, cz, 1, 0.05);
  crate(ctx, root, 27.3, cy + 1, cz, 1, -0.06);
  for (let i = 0; i < 3; i++) crate(ctx, root, 28.4, cy + i, cz, 1, i * 0.08, i === 2 ? "#c98a4b" : COL.wood);
  crate(ctx, root, 29.5, cy, cz, 1, 0.1);
  crate(ctx, root, 29.5, cy + 1, cz, 1, -0.04);
  ctx.crateTop = { x: 28.4, z: cz, top: cy + 3 };
  barrel(ctx, root, 31.2, cy, -31.2);
  barrel(ctx, root, 31.4, cy, -29.9, "#9a5b2e");
  barrel(ctx, root, 31.2, cy + 0.95, -31.2, "#c07a40");
  ctx.barrelTop = { x: 31.2, z: -31.2, top: cy + 1.9 };
  // a few loose crates and barrels near the north row
  crate(ctx, root, 32.0, cy, -10.6, 0.8, 0.3, "#b97a45");
  barrel(ctx, root, 9.6, cy, -10.2);
  // MARKET ROW arch over the aisle, facing Main Street
  const f = root.child(8.6, CURB_H, -20, -Math.PI / 2);
  const uv = atlas.banner("MARKET ROW", { bg: "#ff8c42", fg: "#ffffff", h: 190, icon: "basket" });
  for (const s of [-1, 1]) {
    f.cylB("solid", COL.white, s * 3.2, 0, 0, 0.26, 3.7, 10);
    f.sphere("solid", "#ffd93d", s * 3.2, 3.85, 0, 0.42, 0.42, 0.42, 6);
    const p = f.pt(s * 3.2, 0, 0);
    colliders.addCylinder(p[0], p[2], 0.2, CURB_H, CURB_H + 4, "prop");
  }
  f.rbox("solid", "#ff8c42", 0, 3.35, 0, 6.6, 0.95, 0.14, 0.05);
  f.quad("sign", null, 0, 3.35, 0.075, 5.0, 0.94, 0, uv);
  f.quad("sign", null, 0, 3.35, -0.075, 5.0, 0.94, Math.PI, uv);
  // string of pennants along the arch
  for (let i = 0; i < 12; i++) {
    const px = -3.0 + i * 0.55;
    f.poly("cloth", PALETTE.flowers[i % 6], [[px - 0.2, 2.85, 0], [px + 0.2, 2.85, 0], [px, 2.45, 0]], [0, 0, 1]);
  }
  ctx.landmarks.push({ name: "Market Row", x: 20, z: -20, icon: "🧺" });
}

// ----------------------------------------------------------- yards etc. --
function yards(ctx) {
  const { root, rng, footprints, map } = ctx;
  const styles = ["round", "round", "blossom", "pine", "poplar", "maple", "round", "bush"];
  for (const b of BLOCKS) {
    if (b.kind === "market") continue;
    const inset = (side) => (b.walk.includes(side) ? SIDEWALK + 1.6 : 2.2);
    const x0 = b.x0 + inset("w");
    const x1 = b.x1 - inset("e");
    const z0 = b.z0 + inset("s");
    const z1 = b.z1 - inset("n");
    const placed = [];
    const want = Math.round(((x1 - x0) * (z1 - z0)) / 58);
    for (let tries = 0; tries < 400 && placed.length < want; tries++) {
      const x = x0 + rng() * (x1 - x0);
      const z = z0 + rng() * (z1 - z0);
      if (Math.hypot(x, z) < 24) continue;
      if (footprints.some((f) => x > f.x0 - 1 && x < f.x1 + 1 && z > f.z0 - 1 && z < f.z1 + 1)) continue;
      if (b.kind === "hall" && Math.abs(x) < 16 && z < 76) continue;
      if (placed.some((p) => Math.hypot(p.x - x, p.z - z) < 5.2)) continue;
      const style = styles[Math.floor(rng() * styles.length)];
      const s = 0.85 + rng() * 0.35;
      tree(ctx, root, x, CURB_H, z, style, s, Math.floor(x * 13 + z * 7));
      placed.push({ x, z });
      map.push({ kind: "tree", x, z, w: 3 * s, d: 3 * s, color: style === "blossom" ? "#ffb7d5" : style === "maple" ? "#e8743b" : "#4caf50" });
    }
    // a garden shed in residential yards
    if (b.kind === "homes") {
      for (let tries = 0; tries < 80; tries++) {
        const x = x0 + 2 + rng() * (x1 - x0 - 4);
        const z = z0 + 2 + rng() * (z1 - z0 - 4);
        if (footprints.some((f) => x > f.x0 - 2 && x < f.x1 + 2 && z > f.z0 - 2 && z < f.z1 + 2)) continue;
        if (placed.some((p) => Math.hypot(p.x - x, p.z - z) < 4)) continue;
        shed(ctx, root, x, z, Math.floor(rng() * 4) * (Math.PI / 2));
        placed.push({ x, z });
        break;
      }
    }
    // a flower bed in bigger yards
    for (let tries = 0; tries < 60; tries++) {
      const x = x0 + 2 + rng() * (x1 - x0 - 4);
      const z = z0 + 2 + rng() * (z1 - z0 - 4);
      if (Math.hypot(x, z) < 24) continue;
      if (footprints.some((f) => x > f.x0 - 1.5 && x < f.x1 + 1.5 && z > f.z0 - 1.5 && z < f.z1 + 1.5)) continue;
      if (placed.some((p) => Math.hypot(p.x - x, p.z - z) < 3.6)) continue;
      if (b.kind === "hall" && Math.abs(x) < 16 && z < 76) continue;
      flowerBed(ctx, root, x, CURB_H, z, 1.2, Math.floor(x));
      break;
    }
    // hedges on edges facing the countryside
    const e = 0.7;
    if (!b.walk.includes("n") && b.z1 >= 80) hedge(ctx, root, b.x0 + 0.6, b.z1 - e, b.x1 - 0.6, b.z1 - e, CURB_H);
    if (!b.walk.includes("s") && b.z0 <= -80) hedge(ctx, root, b.x0 + 0.6, b.z0 + e, b.x1 - 0.6, b.z0 + e, CURB_H);
    if (!b.walk.includes("e") && b.x1 >= 80) hedge(ctx, root, b.x1 - e, b.z0 + 0.6, b.x1 - e, b.z1 - 0.6, CURB_H);
    if (!b.walk.includes("w") && b.x0 <= -80) hedge(ctx, root, b.x0 + e, b.z0 + 0.6, b.x0 + e, b.z1 - 0.6, CURB_H);
  }
  // Town Hall back garden: a pair of blossom trees and a bench
  tree(ctx, root, -8, CURB_H, 76, "blossom", 1.1, 5);
  tree(ctx, root, 8, CURB_H, 76, "blossom", 1.1, 9);
  bench(ctx, root, 0, CURB_H, 77.5, Math.PI);
}

const SHED_COLS = ["#e05d5d", "#4d96ff", "#6bcb77", "#f2b134", "#9b5de5"];
/** Little garden shed (platform roof is a fun hop). */
function shed(ctx, root, x, z, ry) {
  const f = root.child(x, CURB_H, z, ry);
  const col = SHED_COLS[Math.floor(Math.abs(x * 7 + z * 3)) % SHED_COLS.length];
  f.boxB("solid", "#c9a27a", 0, 0, 0, 2.4, 1.9, 2.0, null, { grad: [CURB_H, CURB_H + 1.9, 0.8, 1] });
  for (let i = -2; i <= 2; i++) f.box("solid", "#b08a62", i * 0.48, 0.95, 1.01, 0.05, 1.9, 0.02);
  f.gable("solid", col, "#c9a27a", COL.white, 0, 1.9, 0, 2.4, 2.0, { ridge: "x", pitch: 0.55, overhang: 0.2, thick: 0.12 });
  f.rbox("solid", shade(col, 0.85), 0, 0.85, 1.03, 0.8, 1.6, 0.06, 0.02);
  f.gem("solid", COL.gold, 0.25, 0.85, 1.08, 0.08);
  ctx.colliders.addBox(...aabb(f, -1.25, -1.05, 1.25, 1.05), "prop");
}
function aabb(f, x0, z0, x1, z1) {
  const a = f.pt(x0, 0, z0);
  const b = f.pt(x1, 0, z1);
  return [Math.min(a[0], b[0]), 0, Math.min(a[2], b[2]), Math.max(a[0], b[0]), CURB_H + 2.6, Math.max(a[2], b[2])];
}

/** Everything along the streets. */
export function buildStreetLife(ctx) {
  busStop(ctx);
  market(ctx);
  streetLights(ctx);
  streetSigns(ctx);
  parkedCars(ctx);
  yards(ctx);
}

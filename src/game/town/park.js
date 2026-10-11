// Maple Park (south-west quadrant): winding dirt paths, a duck pond with an
// arched wooden bridge and stepping stones, a playground whose pieces are
// jumpable platforms, a bandstand, picnic tables, flower beds and lots of
// trees in several styles.
import { TransformNode } from "@babylonjs/core";
import { PALETTE } from "../palette.js";
import { PARK, POND, PLAYGROUND, distToPath } from "./layout.js";
import { splineLoop, soloMesh, shade, T } from "./geo.js";
import { COL, tree, bench, lamp, picnicTable, flowerBed, hedge, trashCan } from "./props.js";

const TAU = Math.PI * 2;
const DIRT = PALETTE.dirt;

// The main loop around the pond (also an NPC path).
const LOOP_CTRL = [
  { x: -17, z: -17 },
  { x: -31, z: -13.5 },
  { x: -50, z: -15 },
  { x: -68, z: -18 },
  { x: -75.5, z: -35 },
  { x: -74, z: -57 },
  { x: -64, z: -74 },
  { x: -44, z: -76.5 },
  { x: -22, z: -77 },
  { x: -10.2, z: -66 },
  { x: -10.4, z: -42 },
  { x: -13, z: -27 },
];

const SPURS = [
  [{ x: -4.5, z: -45 }, { x: -11.5, z: -45 }],
  [{ x: -45, z: -4.5 }, { x: -45, z: -15.5 }],
  [{ x: -41, z: -16 }, { x: -41, z: -24 }, { x: -41, z: -31 }],
  [{ x: -41, z: -49 }, { x: -40.5, z: -60 }, { x: -41.5, z: -76 }],
  [{ x: -10, z: -10 }, { x: -17.5, z: -17.5 }],
];

const BRIDGE = { x: -41, z0: -49.5, z1: -30.5, w: 2.4, rise: 0.95 };

function ribbon(f, pts, width, color, y, closed) {
  const n = pts.length;
  const side = [];
  for (let i = 0; i < n; i++) {
    const a = pts[closed ? (i - 1 + n) % n : Math.max(0, i - 1)];
    const b = pts[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
    let tx = b.x - a.x;
    let tz = b.z - a.z;
    const l = Math.hypot(tx, tz) || 1;
    tx /= l;
    tz /= l;
    side.push([-tz * (width / 2), tx * (width / 2)]);
  }
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const j = (i + 1) % n;
    const p = pts[i];
    const q = pts[j];
    const sp = side[i];
    const sq = side[j];
    f.poly("flat", color, [
      [p.x - sp[0], y, p.z - sp[1]],
      [p.x + sp[0], y, p.z + sp[1]],
      [q.x + sq[0], y, q.z + sq[1]],
      [q.x - sq[0], y, q.z - sq[1]],
    ], [0, 1, 0]);
  }
  // round caps at the ends of open paths
  if (!closed) for (const p of [pts[0], pts[n - 1]]) f.ring("flat", color, p.x, y, p.z, 0, width / 2, 0, TAU, 10);
}

function pondShape(k = 1, pad = 0, segs = 40) {
  const pts = [];
  for (let i = 0; i < segs; i++) {
    const a = (i / segs) * TAU;
    const wob = 1 + 0.06 * Math.sin(a * 3 + 0.7) + 0.04 * Math.sin(a * 5 + 2.1);
    pts.push([POND.x + Math.sin(a) * (POND.rx * k * wob + pad), POND.z + Math.cos(a) * (POND.rz * k * wob + pad)]);
  }
  return pts;
}

/** Inside the (wobbly) pond ellipse grown by `pad` metres? */
export function inPond(x, z, pad = 0) {
  const dx = (x - POND.x) / (POND.rx + pad);
  const dz = (z - POND.z) / (POND.rz + pad);
  return dx * dx + dz * dz < 1.08;
}

function pond(ctx) {
  const { root: f, scene, map, colliders } = ctx;
  const ring = (k, pad, y, color, bucket = "flat") => {
    const pts = pondShape(k, pad).map(([x, z]) => [x, y, z]);
    // fan from centre
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      f.poly(bucket, color, [[POND.x, y, POND.z], a, b], [0, 1, 0], bucket === "water" ? [[POND.x / 3, POND.z / 3], [a[0] / 3, a[2] / 3], [b[0] / 3, b[2] / 3]] : null);
    }
  };
  ring(1, 1.6, 0.012, "#e9d9a6"); // sandy shore
  ring(1, 0.5, 0.016, "#cdb98a");
  ring(1, 0, 0.02, "#2f8fb5"); // pond bed
  ring(1, 0, 0.1, null, "water");
  // pebbles
  pondShape(1, 0.55, 64).forEach(([x, z], i) => {
    if (Math.abs(x - BRIDGE.x) < 2.2) return;
    f.gem("solid", i % 3 ? "#c9c3b8" : "#a8a29a", x, 0.08, z, 0.35 + (i % 4) * 0.08, 3, [i, i * 2, 0]);
  });
  // lily pads
  for (let i = 0; i < 9; i++) {
    const a = i * 2.3 + 0.5;
    const r = 0.45 + ((i * 37) % 10) / 22;
    const x = POND.x + Math.sin(a) * POND.rx * r;
    const z = POND.z + Math.cos(a) * POND.rz * r;
    if (Math.abs(x - BRIDGE.x) < 2.2 || Math.abs(x + 52) < 1.6) continue;
    f.ring("solid", "#4caf50", x, 0.115, z, 0, 0.55, a, a + TAU * 0.88, 10);
    if (i % 3 === 0) {
      f.gem("solid", "#ff9ecb", x, 0.22, z, 0.3, 1);
      f.gem("solid", "#ffd93d", x, 0.3, z, 0.12, 1);
    }
  }
  // reeds / cattails
  for (const [a, n] of [[0.9, 5], [2.3, 4], [4.1, 6], [5.4, 4]]) {
    const cx = POND.x + Math.sin(a) * (POND.rx + 0.2);
    const cz = POND.z + Math.cos(a) * (POND.rz + 0.2);
    for (let i = 0; i < n; i++) {
      const x = cx + Math.sin(i * 2.1) * 0.6;
      const z = cz + Math.cos(i * 1.7) * 0.6;
      const h = 1.1 + (i % 3) * 0.25;
      f.cylB("solid", "#5a9a3c", x, 0, z, 0.06, h, 4);
      f.cyl("solid", "#7a4a28", x, h - 0.05, z, 0.14, 0.38, 6);
    }
  }
  colliders.addCylinder(POND.x, POND.z, Math.min(POND.rx, POND.rz) * 0.9, -0.5, 0, "water");
  map.push({ kind: "water", x: POND.x, z: POND.z, w: POND.rx * 2, d: POND.rz * 2, color: PALETTE.water, shape: "circle", label: "Duck Pond" });
  ctx.landmarks.push({ name: "Duck Pond", x: POND.x - 5, z: POND.z, icon: "🦆" });

  // three bobbing ducks paddling in a slow circle
  const ducks = soloMesh(scene, "town_ducks", ctx.mats.solid, (d) => {
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * TAU;
      const df = d.child(Math.sin(a) * 4.2, 0, Math.cos(a) * 2.4, a + Math.PI / 2);
      const s = i === 0 ? 1 : 0.62;
      df.sphere("m", i === 0 ? "#ffffff" : "#ffe38a", 0, 0.18 * s, 0, 0.62 * s, 0.4 * s, 0.85 * s, 6);
      df.sphere("m", i === 0 ? "#ffffff" : "#ffe38a", 0, 0.48 * s, 0.3 * s, 0.38 * s, 0.38 * s, 0.38 * s, 6);
      df.sphere("m", "#ff9a3c", 0, 0.45 * s, 0.52 * s, 0.2 * s, 0.09 * s, 0.22 * s, 4);
      for (const e of [-1, 1]) df.sphere("m", "#1d2b3a", e * 0.13 * s, 0.56 * s, 0.42 * s, 0.07 * s, 0.07 * s, 0.05 * s, 3);
      df.sphere("m", i === 0 ? "#f2f2f2" : "#ffd25e", 0, 0.28 * s, -0.36 * s, 0.32 * s, 0.24 * s, 0.3 * s, 4, [-0.6, 0, 0]);
    }
  });
  const pivot = new TransformNode("town_duckPivot", scene);
  pivot.position.set(POND.x - 2.5, 0.1, POND.z);
  ducks.parent = pivot;
  ctx.anim.push((dt, t) => {
    pivot.rotation.y = -t * 0.12;
    ducks.position.y = Math.sin(t * 2.2) * 0.025;
  });
}

function bridge(ctx) {
  const { root: f, colliders } = ctx;
  const { x, z0, z1, w, rise } = BRIDGE;
  const L = z1 - z0;
  const yAt = (z) => 0.12 + rise * Math.sin(Math.PI * Math.min(1, Math.max(0, (z - z0) / L)));
  const plank = COL.wood;
  const n = Math.round(L / 0.32);
  for (let i = 0; i < n; i++) {
    const z = z0 + ((i + 0.5) * L) / n;
    const zA = z - 0.15;
    const zB = z + 0.15;
    const slope = Math.atan2(yAt(zB) - yAt(zA), 0.3);
    f.box("solid", i % 3 ? plank : shade(plank, 0.9), x, yAt(z), z, w, 0.09, 0.29, [-slope, 0, 0]);
  }
  // stringers, posts and handrails
  for (const s of [-1, 1]) {
    const rail = [];
    const beam = [];
    for (let i = 0; i <= 24; i++) {
      const z = z0 + (i / 24) * L;
      rail.push([x + s * (w / 2 - 0.05), yAt(z) + 0.95, z]);
      beam.push([x + s * (w / 2 - 0.05), yAt(z) - 0.12, z]);
    }
    f.tube("solid", COL.woodDark, rail, 0.06, 6);
    f.tube("solid", COL.woodDark, beam, 0.1, 6);
    for (let i = 0; i <= 10; i++) {
      const z = z0 + (i / 10) * L;
      f.boxB("solid", COL.woodDark, x + s * (w / 2 - 0.05), yAt(z) - 0.1, z, 0.12, 1.1, 0.12);
    }
  }
  // stepped deck colliders (each step <= 0.25 m so you can walk over)
  const segs = 16;
  for (let i = 0; i < segs; i++) {
    const za = z0 + (i * L) / segs;
    const zb = z0 + ((i + 1) * L) / segs;
    const top = yAt((za + zb) / 2) + 0.05;
    colliders.addBox(x - w / 2, 0, za, x + w / 2, top, zb, "platform");
    for (const s of [-1, 1]) colliders.addBox(x + s * (w / 2) - 0.08, top, za, x + s * (w / 2) + 0.08, top + 1.0, zb, "prop");
  }
  ctx.bridgeTop = yAt((z0 + z1) / 2) + 0.05;
}

function steppingStones(ctx) {
  const { root: f, colliders } = ctx;
  const stones = [
    [-52.2, -32.8],
    [-51.4, -34.6],
    [-52.6, -36.4],
    [-51.6, -38.3],
    [-52.8, -40.2],
    [-51.7, -42.1],
    [-52.5, -44.0],
    [-51.9, -45.9],
    [-52.4, -47.6],
  ];
  stones.forEach(([x, z], i) => {
    const r = 0.62 + (i % 3) * 0.06;
    const top = 0.38;
    f.shape("solid", T.cyl(9, 0.86), "#b9b4ab", x, top / 2 - 0.05, z, r * 2, top + 0.1, r * 2 * 0.92, [0, i * 0.7, 0], { top: "#d3cfc6" });
    colliders.addCylinder(x, z, r, 0, top, "platform");
  });
  ctx.stones = stones.map(([x, z]) => ({ x, z, top: 0.38 }));
}

function playground(ctx) {
  const { root: f, colliders, scene, mats } = ctx;
  const P = PLAYGROUND;
  const cx = (P.x0 + P.x1) / 2;
  const cz = (P.z0 + P.z1) / 2;
  // soft rubber floor with a border
  f.flat("flat", "#f6b26b", cx, 0.022, cz, P.x1 - P.x0 + 0.6, P.z1 - P.z0 + 0.6);
  f.flat("flat", "#f08a5d", cx, 0.024, cz, P.x1 - P.x0 - 0.4, P.z1 - P.z0 - 0.4);
  f.flat("flat", "#f6b26b", cx, 0.026, cz, P.x1 - P.x0 - 1.2, P.z1 - P.z0 - 1.2);
  // low colourful fence with an opening toward the path (east)
  const posts = ["#ff5d5d", "#ffd93d", "#4d96ff", "#6bcb77"];
  const fence = (ax, az, bx, bz) => {
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.round(len / 0.5);
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      f.boxB("solid", posts[i % 4], ax + (bx - ax) * t, 0, az + (bz - az) * t, 0.12, 0.75, 0.12);
    }
    const ry = Math.atan2(bx - ax, bz - az);
    f.box("solid", COL.white, (ax + bx) / 2, 0.68, (az + bz) / 2, 0.08, 0.08, len, [0, ry, 0]);
    const minX = Math.min(ax, bx) - 0.1;
    const maxX = Math.max(ax, bx) + 0.1;
    const minZ = Math.min(az, bz) - 0.1;
    const maxZ = Math.max(az, bz) + 0.1;
    colliders.addBox(minX, 0, minZ, maxX, 0.8, maxZ, "prop");
  };
  fence(P.x0, P.z0, P.x0, P.z1);
  fence(P.x0, P.z1, P.x1, P.z1);
  fence(P.x0, P.z0, P.x1, P.z0);
  fence(P.x1, P.z1, P.x1, cz + 2);
  fence(P.x1, cz - 2, P.x1, P.z0);

  // ---- slide tower: step block -> deck (2.0) -> slide stairs down
  const tx = -28;
  const tz = -57.5;
  const deck = 2.0;
  for (const sx of [-0.95, 0.95]) for (const sz of [-0.95, 0.95]) f.cylB("solid", "#4d96ff", tx + sx, 0, tz + sz, 0.16, 3.6, 8);
  f.rbox("solid", "#ffd93d", tx, deck - 0.08, tz, 2.2, 0.16, 2.2, 0.05);
  f.frustum("solid", "#e05d5d", tx, 3.6, tz, 2.7, 2.7, 0, 0, 1.2);
  for (const s of [-1, 1]) f.box("solid", "#6bcb77", tx, deck + 0.45, tz + s * 1.0, 2.0, 0.1, 0.08);
  f.box("solid", "#6bcb77", tx - 1.0, deck + 0.45, tz, 0.08, 0.1, 2.0);
  colliders.addBox(tx - 1.1, 0, tz - 1.1, tx + 1.1, deck, tz + 1.1, "platform");
  // step block (1.0) next to the ladder side
  f.rbox("solid", "#c77dff", tx - 1.9, 0.5, tz + 0.2, 1.1, 1.0, 1.1, 0.1);
  colliders.addBox(tx - 2.45, 0, tz - 0.35, tx - 1.35, 1.0, tz + 0.75, "platform");
  // ladder rungs
  for (let i = 1; i <= 5; i++) f.box("solid", COL.white, tx - 1.1, i * 0.36, tz - 0.6, 0.06, 0.06, 0.9);
  // slide chute down to +X
  const sl = 4.0;
  const ang = Math.atan2(deck - 0.25, sl);
  const len = Math.hypot(sl, deck - 0.25);
  f.box("solid", "#ff8c42", tx + 1.1 + sl / 2, (deck + 0.25) / 2, tz, 1.0, 0.08, len, [0, Math.PI / 2, -ang]);
  for (const s of [-1, 1]) f.box("solid", "#ffd93d", tx + 1.1 + sl / 2, (deck + 0.25) / 2 + 0.18, tz + s * 0.5, len, 0.3, 0.06, [0, 0, -ang]);
  f.box("solid", "#ff8c42", tx + 1.1 + sl + 0.4, 0.22, tz, 0.9, 0.08, 1.0);
  for (let i = 0; i < 5; i++) {
    const x0 = tx + 1.1 + (i * sl) / 5;
    const top = deck - ((i + 0.5) / 5) * (deck - 0.25);
    colliders.addBox(x0, 0, tz - 0.5, x0 + sl / 5, top, tz + 0.5, "platform");
  }
  // ---- climbing frame (top 1.5)
  const gx = -18.5;
  const gz = -56.5;
  const gs = 2.4;
  const gh = 1.5;
  const bar = "#00b4d8";
  for (let i = 0; i <= 3; i++) {
    for (let j = 0; j <= 3; j++) {
      const x = gx - gs / 2 + (i * gs) / 3;
      const z = gz - gs / 2 + (j * gs) / 3;
      if (i === 0 || i === 3 || j === 0 || j === 3) f.cylB("solid", bar, x, 0, z, 0.08, gh, 6);
    }
  }
  for (let k = 1; k <= 3; k++) {
    const y = (k * gh) / 3;
    for (let i = 0; i <= 3; i++) {
      const o = -gs / 2 + (i * gs) / 3;
      const col = k === 3 ? "#ffd93d" : bar;
      if (k === 3 || i === 0 || i === 3) {
        f.cyl("solid", col, gx + o, y, gz, 0.07, gs, 6, 1, [Math.PI / 2, 0, 0]);
        f.cyl("solid", col, gx, y, gz + o, 0.07, gs, 6, 1, [0, 0, Math.PI / 2]);
      }
    }
  }
  colliders.addBox(gx - gs / 2, 0, gz - gs / 2, gx + gs / 2, gh, gz + gs / 2, "platform");
  // ---- swings with two animated seats
  const swx = -22;
  const swz = -66.5;
  const swH = 2.7;
  for (const s of [-1, 1]) {
    const x = swx + s * 2.2;
    f.cyl("solid", "#e05d5d", x, swH / 2, swz - 0.65, 0.14, swH * 1.07, 8, 1, [0.25, 0, 0]);
    f.cyl("solid", "#e05d5d", x, swH / 2, swz + 0.65, 0.14, swH * 1.07, 8, 1, [-0.25, 0, 0]);
    colliders.addCylinder(x, swz - 0.65, 0.12, 0, swH, "prop");
    colliders.addCylinder(x, swz + 0.65, 0.12, 0, swH, "prop");
  }
  f.cyl("solid", "#ffd93d", swx, swH, swz, 0.14, 4.6, 8, 1, [0, 0, Math.PI / 2]);
  const seatCols = ["#4d96ff", "#6bcb77"];
  [-1, 1].forEach((s, i) => {
    const pivot = new TransformNode(`town_swingPivot${i}`, scene);
    pivot.position.set(swx + s * 1.0, swH, swz);
    const seat = soloMesh(scene, `town_swing${i}`, mats.solid, (m) => {
      for (const e of [-0.28, 0.28]) m.cyl("m", "#9aa3b0", e, -1.05, 0, 0.03, 2.1, 4);
      m.rbox("m", seatCols[i], 0, -2.12, 0, 0.7, 0.07, 0.36, 0.03);
    });
    seat.parent = pivot;
    ctx.env?.addShadowCaster?.(seat, false);
    ctx.anim.push((dt, t) => {
      pivot.rotation.x = 0.32 * Math.sin(t * 1.9 + i * 1.4);
    });
  });
  // ---- seesaw (static, tilted)
  const ssx = -28.5;
  const ssz = -66;
  f.frustum("solid", "#9aa3b0", ssx, 0, ssz, 0.6, 0.5, 0.2, 0.5, 0.5, null, false);
  f.rbox("solid", "#ff5d5d", ssx, 0.55, ssz, 4.2, 0.1, 0.4, 0.04, [0, 0, 0.17]);
  for (const s of [-1, 1]) f.cyl("solid", "#ffd93d", ssx + s * 1.8, 0.55 - s * 0.31 + 0.25, ssz, 0.07, 0.6, 6, 1, [Math.PI / 2, 0, 0]);
  colliders.addBox(ssx - 2.1, 0, ssz - 0.25, ssx + 2.1, 0.55, ssz + 0.25, "platform");
  // ---- sandbox with bucket
  const sbx = -16.5;
  const sbz = -66.5;
  for (const [ox, oz, w, d] of [[0, -1.6, 3.4, 0.25], [0, 1.6, 3.4, 0.25], [-1.6, 0, 0.25, 3.4], [1.6, 0, 0.25, 3.4]]) {
    f.boxB("solid", COL.wood, sbx + ox, 0, sbz + oz, w, 0.32, d);
  }
  f.flat("flat", PALETTE.sand, sbx, 0.2, sbz, 3.0, 3.0);
  f.cylB("solid", "#ff5d5d", sbx + 0.6, 0.2, sbz - 0.4, 0.4, 0.35, 8, 1.25);
  f.sphere("solid", "#f3dfa2", sbx - 0.5, 0.25, sbz + 0.3, 0.9, 0.5, 0.9, 5);
  colliders.addBox(sbx - 1.7, 0, sbz - 1.7, sbx + 1.7, 0.3, sbz + 1.7, "platform");

  ctx.playground = { slide: { x: tx, z: tz, top: deck }, frame: { x: gx, z: gz, top: gh }, block: { x: tx - 1.9, z: tz + 0.2, top: 1.0 } };
  ctx.landmarks.push({ name: "Playground", x: cx, z: cz, icon: "🛝" });
  ctx.map.push({ kind: "plaza", x: cx, z: cz, w: P.x1 - P.x0, d: P.z1 - P.z0, color: "#f08a5d", label: "Playground" });
}

function bandstand(ctx) {
  const { root: f, colliders } = ctx;
  const x = -61;
  const z = -59;
  const R = 3.6;
  const floor = 0.6;
  f.shape("solid", T.cyl(8, 1), "#e9e2d4", x, floor / 2, z, R * 2, floor, R * 2, [0, Math.PI / 8, 0], { top: "#c9a27a" });
  colliders.addCylinder(x, z, R, 0, floor, "platform");
  // two steps on the east side toward the path
  for (let i = 0; i < 2; i++) {
    const h = floor * ((2 - i) / 2);
    f.boxB("solid", "#ddd5c7", x + R - 0.2 + i * 0.45 + 0.22, 0, z, 0.45, h, 1.8);
    colliders.addBox(x + R - 0.2 + i * 0.45, 0, z - 0.9, x + R + 0.25 + i * 0.45, h, z + 0.9, "platform");
  }
  const roofY = floor + 2.8;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU + Math.PI / 8;
    const px = x + Math.sin(a) * (R - 0.3);
    const pz = z + Math.cos(a) * (R - 0.3);
    f.cylB("solid", COL.white, px, floor, pz, 0.2, 2.8, 8);
    colliders.addCylinder(px, pz, 0.14, floor, roofY, "prop");
    // railing between posts (open on the east side)
    const b = ((i + 1) / 8) * TAU + Math.PI / 8;
    const mid = (a + b) / 2;
    if (Math.abs(Math.sin(mid) - 1) < 0.1) continue;
    const qx = x + Math.sin(b) * (R - 0.3);
    const qz = z + Math.cos(b) * (R - 0.3);
    const ry = Math.atan2(qx - px, qz - pz);
    const seg = Math.hypot(qx - px, qz - pz);
    f.box("solid", COL.white, (px + qx) / 2, floor + 0.85, (pz + qz) / 2, 0.08, 0.08, seg, [0, ry, 0]);
    for (let k = 1; k < 5; k++) {
      const t = k / 5;
      f.boxB("solid", COL.white, px + (qx - px) * t, floor, pz + (qz - pz) * t, 0.05, 0.85, 0.05);
    }
    for (const t of [0.3, 0.7]) colliders.addCylinder(px + (qx - px) * t, pz + (qz - pz) * t, 0.3, floor, floor + 0.9, "prop");
  }
  f.shape("solid", T.cyl(8, 1), COL.white, x, roofY + 0.1, z, R * 2 + 0.3, 0.2, R * 2 + 0.3, [0, Math.PI / 8, 0]);
  f.shape("solid", T.cyl(8, 0), "#e05d5d", x, roofY + 1.0, z, R * 2 + 0.8, 1.6, R * 2 + 0.8, [0, Math.PI / 8, 0]);
  // scalloped trim under the roof edge
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * TAU;
    f.sphere("solid", i % 2 ? "#ffffff" : "#ffd93d", x + Math.sin(a) * (R + 0.2), roofY + 0.05, z + Math.cos(a) * (R + 0.2), 0.42, 0.3, 0.42, 4);
  }
  f.cylB("solid", COL.gold, x, roofY + 1.8, z, 0.08, 0.7, 6);
  f.sphere("solid", COL.gold, x, roofY + 2.55, z, 0.3, 0.3, 0.3, 6);
  ctx.bandstand = { x, z, floor };
  ctx.landmarks.push({ name: "Bandstand", x, z, icon: "🎵" });
}

function parkArch(ctx) {
  const { root, colliders, atlas } = ctx;
  const f = root.child(-15.2, 0, -15.2, Math.PI / 4 + Math.PI);
  const uv = atlas.banner("MAPLE PARK", { bg: "#3fa66b", fg: "#fffaf0", h: 190, icon: "leaf" });
  for (const s of [-1, 1]) {
    f.boxB("solid", "#d9cdb8", s * 2.1, 0, 0, 0.6, 0.4, 0.6);
    f.cylB("solid", COL.woodDark, s * 2.1, 0.4, 0, 0.32, 3.4, 8);
    f.sphere("solid", "#e8743b", s * 2.1, 3.95, 0, 0.5, 0.5, 0.5, 5);
    const p = f.pt(s * 2.1, 0, 0);
    colliders.addCylinder(p[0], p[2], 0.3, 0, 3.9, "prop");
  }
  f.rbox("solid", COL.woodDark, 0, 3.35, 0, 4.6, 0.95, 0.16, 0.05);
  f.quad("sign", null, 0, 3.35, 0.085, 4.3, 0.8, 0, uv);
  f.quad("sign", null, 0, 3.35, -0.085, 4.3, 0.8, Math.PI, uv);
  // vines of autumn leaves along the top
  for (let i = 0; i < 9; i++) f.gem("solid", COL.maple[i % 4], -2.1 + i * 0.52, 3.9, 0, 0.3, 1, [0, i, 0]);
}

/** Build Maple Park. Returns the main loop (for NPC paths). */
export function buildPark(ctx) {
  const { root: f, rng, map, colliders } = ctx;
  const loop = splineLoop(LOOP_CTRL, 2.0, true);
  ribbon(f, loop, 3.0, shade(DIRT, 0.92), 0.018, true);
  ribbon(f, loop, 2.5, DIRT, 0.022, true);
  for (const s of SPURS) {
    const pts = splineLoop(s, 1.5, false);
    ribbon(f, pts, 2.6, shade(DIRT, 0.92), 0.019, false);
    ribbon(f, pts, 2.1, DIRT, 0.023, false);
  }
  map.push({ kind: "park", x: (PARK.x0 + PARK.x1) / 2, z: (PARK.z0 + PARK.z1) / 2, w: PARK.x1 - PARK.x0, d: PARK.z1 - PARK.z0, color: PALETTE.grass, label: "Maple Park" });
  ctx.landmarks.push({ name: "Maple Park", x: -36, z: -24, icon: "🍁" });

  pond(ctx);
  bridge(ctx);
  steppingStones(ctx);
  playground(ctx);
  bandstand(ctx);
  parkArch(ctx);

  // hedges along the park edges with gaps for the entrances
  const hy = 0;
  hedge(ctx, f, -7.9, -81, -7.9, -47.2, hy);
  hedge(ctx, f, -7.9, -42.8, -7.9, -19, hy);
  hedge(ctx, f, -81, -7.9, -47.2, -7.9, hy);
  hedge(ctx, f, -42.8, -7.9, -19, -7.9, hy);
  hedge(ctx, f, -81.4, -81, -81.4, -9, hy);
  hedge(ctx, f, -80.5, -81.4, -9, -81.4, hy);

  // picnic tables, flower beds, benches, lamps, bins
  const picnic = [[-31, -26, 0.25], [-63, -28, -0.4], [-25, -39, 1.25], [-58, -68, 0.6]];
  for (const [x, z, ry] of picnic) picnicTable(ctx, f, x, 0, z, ry);
  ctx.picnic = picnic.map(([x, z]) => ({ x, z, top: 0.8 }));
  const beds = [[-23, -21, 2.0], [-34, -50, 1.6], [-66, -42, 1.8], [-52, -63, 1.5], [-60, -15.2 + 6, 1.4]];
  beds.forEach(([x, z, r], i) => flowerBed(ctx, f, x, 0, z, r, i * 2 + 1));

  // benches & lamps placed beside the main loop, facing it
  const along = (i, off) => {
    const p = loop[i % loop.length];
    const q = loop[(i + 1) % loop.length];
    const tx = q.x - p.x;
    const tz = q.z - p.z;
    const l = Math.hypot(tx, tz) || 1;
    const nx = -tz / l;
    const nz = tx / l;
    return { x: p.x + nx * off, z: p.z + nz * off, face: Math.atan2(-nx * Math.sign(off), -nz * Math.sign(off)) };
  };
  const N = loop.length;
  const benchAt = [0.08, 0.24, 0.37, 0.52, 0.66, 0.83];
  benchAt.forEach((t, i) => {
    const s = along(Math.floor(t * N), i % 2 ? 2.6 : -2.6);
    if (!inPond(s.x, s.z, 2) && s.x < -9.5 && s.z < -9.5) bench(ctx, f, s.x, 0, s.z, s.face, i % 3 === 0 ? "#e05d5d" : COL.wood);
  });
  const lampAt = [0.0, 0.16, 0.3, 0.45, 0.6, 0.75, 0.9];
  lampAt.forEach((t, i) => {
    const s = along(Math.floor(t * N) + 2, i % 2 ? -2.2 : 2.2);
    if (s.x < -9.5 && s.z < -9.5) lamp(ctx, f, s.x, 0, s.z, { poolR: 3.6 });
  });
  for (const t of [0.12, 0.58]) {
    const s = along(Math.floor(t * N) + 1, 2.1);
    if (s.x < -9.5 && s.z < -9.5) trashCan(ctx, f, s.x, 0, s.z);
  }

  // trees: rejection-sampled away from paths, pond, playground and props
  const avoid = (x, z, r) => {
    if (distToPath(x, z, loop) < 3.4 + r) return true;
    for (const s of SPURS) if (distToPath(x, z, s, false) < 3.0 + r) return true;
    if (inPond(x, z, 3 + r)) return true;
    const P = PLAYGROUND;
    if (x > P.x0 - 3 && x < P.x1 + 3 && z > P.z0 - 3 && z < P.z1 + 3) return true;
    if (Math.hypot(x - ctx.bandstand.x, z - ctx.bandstand.z) < 7) return true;
    if (Math.hypot(x, z) < 22) return true;
    for (const [px, pz] of picnic) if (Math.hypot(x - px, z - pz) < 3.5) return true;
    for (const [bx, bz, br] of beds) if (Math.hypot(x - bx, z - bz) < br + 2.5) return true;
    if (Math.hypot(x + 15.2, z + 15.2) < 5) return true;
    return false;
  };
  const placed = [];
  const styles = ["round", "maple", "maple", "blossom", "round", "pine", "poplar", "round", "blossom", "bush"];
  const target = ctx.quality === "low" ? 42 : 62;
  for (let tries = 0; tries < 3000 && placed.length < target; tries++) {
    const x = PARK.x0 + 2.5 + rng() * (PARK.x1 - PARK.x0 - 4);
    const z = PARK.z0 + 2.5 + rng() * (PARK.z1 - PARK.z0 - 4);
    if (x > -9.5 || z > -9.5) continue;
    if (avoid(x, z, 0.6)) continue;
    if (placed.some((p) => Math.hypot(p.x - x, p.z - z) < 4.6)) continue;
    const style = styles[Math.floor(rng() * styles.length)];
    const s = 0.85 + rng() * 0.4;
    tree(ctx, f, x, 0, z, style, s, placed.length * 7 + 3);
    placed.push({ x, z });
    map.push({ kind: "tree", x, z, w: 3 * s, d: 3 * s, color: style === "maple" ? "#e8743b" : style === "blossom" ? "#ffb7d5" : "#4caf50" });
  }
  ctx.parkLoop = loop;
  return loop;
}

export { LOOP_CTRL, BRIDGE };

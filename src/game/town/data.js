// Gameplay data derived from the town plan: named zones, NPC walking loops
// and coin positions. Platform coins read the heights the builders recorded
// in ctx, so moving a prop keeps its coin on top of it.
import { PLAZA_Y, CURB_H, ROAD_Y, PLAYGROUND, POND, roundedRect, circleLoop } from "./layout.js";
import { FOUNTAIN } from "./square.js";

/** Zones, small/specific first (first match wins). */
export function makeZones() {
  const P = PLAYGROUND;
  return [
    { name: "Playground", minX: P.x0 - 1, maxX: P.x1 + 1, minZ: P.z0 - 1, maxZ: P.z1 + 1 },
    { name: "Duck Pond", minX: POND.x - POND.rx - 2, maxX: POND.x + POND.rx + 2, minZ: POND.z - POND.rz - 2, maxZ: POND.z + POND.rz + 2 },
    { name: "Town Square", minX: -16.5, maxX: 16.5, minZ: -16.5, maxZ: 16.5 },
    { name: "Town Hall", minX: -14, maxX: 14, minZ: 44, maxZ: 74 },
    { name: "Market Row", minX: 4, maxX: 36, minZ: -36, maxZ: -4 },
    { name: "Maple Park", minX: -82, maxX: -4, minZ: -82, maxZ: -4 },
    { name: "Elm Street", minX: -82, maxX: 82, minZ: -7, maxZ: 7 },
    { name: "Main Street", minX: -36, maxX: 36, minZ: 4, maxZ: 36 },
    { name: "Main Street", minX: -7, maxX: 7, minZ: -82, maxZ: -16 },
    { name: "Maple Avenue", minX: -82, maxX: 82, minZ: 33, maxZ: 47 },
    { name: "Residential Lane", minX: -82, maxX: -33, minZ: 4, maxZ: 82 },
    { name: "Cherry Hill", minX: 33, maxX: 82, minZ: -36, maxZ: 82 },
    { name: "Oak Street", minX: 4, maxX: 82, minZ: -82, maxZ: -33 },
    { name: "Town Hall", minX: -36, maxX: 36, minZ: 44, maxZ: 82 },
    { name: "Outskirts", minX: -200, maxX: 200, minZ: -200, maxZ: 200 },
  ];
}

/** Sidewalk loop around a shop block that cuts across the plaza corner court. */
function cornerLoop(sx) {
  const pts = [];
  const line = (ax, az, bx, bz, step = 2.5) => {
    const n = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az) / step));
    for (let i = 0; i < n; i++) pts.push({ x: ax + ((bx - ax) * i) / n, z: az + ((bz - az) * i) / n });
  };
  const arc = (cx, cz, r, a0, a1, step = 2) => {
    const n = Math.max(3, Math.ceil((Math.abs(a1 - a0) * r) / step));
    for (let i = 0; i < n; i++) {
      const a = a0 + ((a1 - a0) * i) / n;
      pts.push({ x: cx + Math.sin(a) * r, z: cz + Math.cos(a) * r });
    }
  };
  const W = 5.5;
  const F = 34.5;
  const R = 3;
  const A = Math.hypot(W, 17.6);
  line(W, 17.6, W, F - R);
  arc(W + R, F - R, R, -Math.PI / 2, 0);
  line(W + R, F, F - R, F);
  arc(F - R, F - R, R, 0, Math.PI / 2);
  line(F, F - R, F, W + R);
  arc(F - R, W + R, R, Math.PI / 2, Math.PI);
  line(F - R, W, 17.6, W);
  arc(0, 0, A, Math.atan2(17.6, W), Math.atan2(W, 17.6));
  return pts.map((p) => ({ x: p.x * sx, z: p.z }));
}

/** 8 closed NPC loops on sidewalks, the square and the park path. */
export function makeNpcPaths(ctx) {
  const paths = [
    circleLoop(0, 0, 10, 2.2),
    cornerLoop(1),
    cornerLoop(-1),
    roundedRect(10.5, -22.6, 30.5, -17.4, 2, 2.2),
    // tight corners: these loops cross the road right at the corner
    roundedRect(-30, 34.5, 30, 45.5, 0.9, 2.5),
    roundedRect(34.5, -30, 45.5, 30, 0.9, 2.5),
    roundedRect(-45.5, 11, -34.5, 72.5, 0.9, 2.5),
  ];
  if (ctx.parkLoop) {
    // resample the park loop to ~2.5 m spacing
    const out = [];
    let acc = 0;
    const L = ctx.parkLoop;
    for (let i = 0; i < L.length; i++) {
      const a = L[i];
      const b = L[(i + 1) % L.length];
      if (acc <= 0) {
        out.push({ x: +a.x.toFixed(2), z: +a.z.toFixed(2) });
        acc = 2.5;
      }
      acc -= Math.hypot(b.x - a.x, b.z - a.z);
    }
    paths.push(out);
  }
  return paths.map((p) => p.map((q) => ({ x: +q.x.toFixed(2), z: +q.z.toFixed(2) })));
}

/** 30-40 coin spots: ~1/3 on platforms, the rest spread through every district. */
export function makeCoins(ctx) {
  const F = FOUNTAIN;
  const c = [];
  const on = (x, top, z) => c.push({ x, y: +(top + 1.0).toFixed(2), z });
  // --- platform coins (reward jumping)
  on(0, F.rim, -5.15);
  on(0, F.tier2, -1.75);
  on(0, F.top, 0.7);
  const benchA = (210 * Math.PI) / 180;
  on(+(Math.sin(benchA) * 13.2).toFixed(2), PLAZA_Y + 0.5, +(Math.cos(benchA) * 13.2).toFixed(2));
  if (ctx.busStop) on(ctx.busStop.x, ctx.busStop.top, ctx.busStop.z);
  if (ctx.crateTop) on(ctx.crateTop.x, ctx.crateTop.top, ctx.crateTop.z);
  if (ctx.barrelTop) on(ctx.barrelTop.x, ctx.barrelTop.top, ctx.barrelTop.z);
  if (ctx.stalls) on(ctx.stalls[2].x, ctx.stalls[2].top, ctx.stalls[2].z - 0.6);
  if (ctx.playground) {
    on(ctx.playground.slide.x, ctx.playground.slide.top, ctx.playground.slide.z);
    on(ctx.playground.frame.x, ctx.playground.frame.top, ctx.playground.frame.z);
  }
  if (ctx.stones) on(ctx.stones[4].x, ctx.stones[4].top, ctx.stones[4].z);
  if (ctx.bridgeTop) on(-41, ctx.bridgeTop, -40);
  if (ctx.bandstand) on(ctx.bandstand.x, ctx.bandstand.floor, ctx.bandstand.z);
  if (ctx.cars) on(ctx.cars[8].x, ctx.cars[8].top + ROAD_Y, ctx.cars[8].z - 0.3);
  // --- ground coins
  const S = CURB_H;
  const ground = [
    // square
    [-8.5, PLAZA_Y, 7.5],
    [8.5, PLAZA_Y, 7.5],
    // Main Street / shops
    [0, ROAD_Y, 27],
    [5.5, S, 30],
    [-5.5, S, 12 + 8],
    // Town Hall
    [0, S + 0.8, 53.2],
    [-22, S, 45.5],
    // Maple Avenue & residential
    [66, ROAD_Y, 40],
    [-60, S, 45.5],
    [-45.5, S, 62],
    [-58, S, 34.5],
    // Elm Street
    [-28, ROAD_Y, 0],
    [56, ROAD_Y, 0],
    // Cherry Hill / east
    [45.5, S, 22],
    [70, S, -5.5],
    [45.5, S, -24],
    // Oak Street / south-east
    [20, S, -45.5],
    [5.5, S, -62],
    [64, ROAD_Y, -40],
    // market aisle
    [17, S, -20],
    // Maple Park
    [-31, 0, -13.6],
    [-75.2, 0, -40],
    [-44, 0, -76.5],
    [-10.8, 0, -53],
  ];
  for (const [x, y, z] of ground) on(x, y, z);
  return c;
}

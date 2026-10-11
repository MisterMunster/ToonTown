// Town plan: every road, block and district rectangle lives here so the
// visual builders, colliders, minimap data and NPC paths all agree.
//
// Coordinates: +X east, +Z north, metres. Roads are 8 m wide, sidewalks 3 m
// with a 0.15 m curb. Blocks are raised 0.15 m slabs (sidewalk ring + yard).

export const ROAD_HALF = 4;
export const SIDEWALK = 3;
export const CURB_H = 0.15;
export const PLAZA_R = 16;
export const PLAZA_Y = 0.17;
export const ROAD_Y = 0.03;
export const BOUNDS = { minX: -80, maxX: 80, minZ: -80, maxZ: 80 };
export const TOWN_EDGE = 82; // outer edge of the outermost blocks

/** Chunking for merged static meshes: 3x3 cells of 56 m in town, 150 m outside. */
export function chunkOf(x, z) {
  if (Math.abs(x) <= 92 && Math.abs(z) <= 92) {
    const cx = Math.max(-1, Math.min(1, Math.floor((x + 28) / 56)));
    const cz = Math.max(-1, Math.min(1, Math.floor((z + 28) / 56)));
    return `c${cx}_${cz}`;
  }
  return `o${Math.floor(x / 150)}_${Math.floor(z / 150)}`;
}

/**
 * Road rectangles. axis = direction of travel. `name` is the street name
 * shown on signs; `outer` roads leave town and run into the countryside.
 */
export const ROADS = [
  { id: "mainN", name: "Main St", axis: "z", x0: -4, x1: 4, z0: 10, z1: 44 },
  { id: "mainS", name: "Main St", axis: "z", x0: -4, x1: 4, z0: -420, z1: -10, outer: true },
  { id: "elmE", name: "Elm St", axis: "x", x0: 10, x1: 420, z0: -4, z1: 4, outer: true },
  { id: "elmW", name: "Elm St", axis: "x", x0: -420, x1: -10, z0: -4, z1: 4, outer: true },
  { id: "maple", name: "Maple Ave", axis: "x", x0: -84, x1: 84, z0: 36, z1: 44 },
  { id: "cherry", name: "Cherry Ln", axis: "z", x0: 36, x1: 44, z0: -84, z1: 84 },
  { id: "birch", name: "Birch Ln", axis: "z", x0: -44, x1: -36, z0: -4, z1: 84 },
  { id: "oak", name: "Oak St", axis: "x", x0: -4, x1: 84, z0: -44, z1: -36 },
];

/**
 * Raised blocks. `walk` lists sides that get a sidewalk (they face a road).
 * kind: shops | market | hall | homes.
 */
export const BLOCKS = [
  { id: "NE", kind: "shops", x0: 4, x1: 36, z0: 4, z1: 36, walk: "nsew" },
  { id: "NW", kind: "shops", x0: -36, x1: -4, z0: 4, z1: 36, walk: "nsew" },
  { id: "SE", kind: "market", x0: 4, x1: 36, z0: -36, z1: -4, walk: "nsew" },
  { id: "N", kind: "hall", x0: -36, x1: 36, z0: 44, z1: 82, walk: "sew" },
  { id: "NW2", kind: "homes", x0: -82, x1: -44, z0: 44, z1: 82, walk: "se" },
  { id: "NE2", kind: "homes", x0: 44, x1: 82, z0: 44, z1: 82, walk: "sw" },
  { id: "W", kind: "homes", x0: -82, x1: -44, z0: 4, z1: 36, walk: "nse" },
  { id: "E", kind: "homes", x0: 44, x1: 82, z0: 4, z1: 36, walk: "nsw" },
  { id: "E2", kind: "homes", x0: 44, x1: 82, z0: -36, z1: -4, walk: "nsw" },
  { id: "SE2", kind: "homes", x0: 4, x1: 36, z0: -82, z1: -44, walk: "new" },
  { id: "SE3", kind: "homes", x0: 44, x1: 82, z0: -82, z1: -44, walk: "nw" },
];

/** Maple Park (ground level) and its raised sidewalk strips along the avenues. */
export const PARK = { x0: -82, x1: -7, z0: -82, z1: -7 };
export const PARK_WALKS = [
  { x0: -7, x1: -4, z0: -82, z1: -4 },
  { x0: -82, x1: -7, z0: -7, z1: -4 },
];

export const POND = { x: -47, z: -40, rx: 11.5, rz: 7 };
export const PLAYGROUND = { x0: -34, x1: -14, z0: -70, z1: -52 };

/** True when (x, z) lies on any road rectangle (optionally grown by pad). */
export function onRoad(x, z, pad = 0) {
  for (const r of ROADS) {
    if (x >= r.x0 - pad && x <= r.x1 + pad && z >= r.z0 - pad && z <= r.z1 + pad) return true;
  }
  return false;
}

/** Block containing (x, z), or null. */
export function blockAt(x, z) {
  for (const b of BLOCKS) if (x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1) return b;
  return null;
}

// --------------------------------------------------------------- terrain --
// Flat inside the town, gentle rolling hills outside, with valleys where the
// avenues leave town so the roads run out naturally into the countryside.
function n2(x, z) {
  return (
    Math.sin(x * 0.021 + 1.3) * Math.cos(z * 0.018 - 0.4) +
    0.55 * Math.sin(x * 0.043 + z * 0.031 + 2.1) +
    0.3 * Math.cos(x * 0.077 - z * 0.069 + 0.7) +
    0.18 * Math.sin(x * 0.13 + z * 0.11 - 1.9)
  );
}

const sstep = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Ground height at (x, z). 0 everywhere in town. */
export function terrainHeight(x, z) {
  const d = Math.max(Math.abs(x), Math.abs(z));
  if (d < 90) return 0;
  const ring = sstep(90, 135, d);
  // valleys along the three avenues that leave town
  let corridor = 1;
  if (z < -80) corridor = Math.min(corridor, sstep(9, 30, Math.abs(x)));
  if (Math.abs(x) > 80) corridor = Math.min(corridor, sstep(9, 30, Math.abs(z)));
  const base = 7 + 14 * sstep(115, 250, d);
  const h = base + 7 * n2(x, z) + 3.5 * n2(z * 1.7 + 40, x * 1.7 - 13);
  return Math.max(0, h * ring * corridor);
}

/** Ground colour noise 0..1 for grass patches. */
export function grassNoise(x, z) {
  return 0.5 + 0.5 * (0.6 * Math.sin(x * 0.11 + Math.cos(z * 0.07) * 2.0) * Math.cos(z * 0.09 - 0.5) + 0.4 * n2(x * 2.3, z * 2.3) / 2);
}

// ----------------------------------------------------------- path helpers --
/** Closed loop around a rectangle with rounded corners, points every ~step m. */
export function roundedRect(x0, z0, x1, z1, r, step = 2.5) {
  const pts = [];
  const arc = (cx, cz, a0) => {
    const n = Math.max(3, Math.ceil((Math.PI / 2) * r / step));
    for (let i = 0; i <= n; i++) {
      const a = a0 + (i / n) * (Math.PI / 2);
      pts.push({ x: cx + Math.sin(a) * r, z: cz + Math.cos(a) * r });
    }
  };
  const line = (ax, az, bx, bz) => {
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.round(len / step));
    for (let i = 1; i < n; i++) pts.push({ x: ax + ((bx - ax) * i) / n, z: az + ((bz - az) * i) / n });
  };
  // clockwise seen from above starting at the north-west corner
  arc(x0 + r, z1 - r, -Math.PI / 2); // NW corner: from west side to north side
  line(x0 + r, z1, x1 - r, z1);
  arc(x1 - r, z1 - r, 0); // NE
  line(x1, z1 - r, x1, z0 + r);
  arc(x1 - r, z0 + r, Math.PI / 2); // SE
  line(x1 - r, z0, x0 + r, z0);
  arc(x0 + r, z0 + r, Math.PI); // SW
  line(x0, z0 + r, x0, z1 - r);
  return pts;
}

/** Closed circle loop. */
export function circleLoop(cx, cz, r, step = 2.5) {
  const n = Math.max(8, Math.round((Math.PI * 2 * r) / step));
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push({ x: cx + Math.sin(a) * r, z: cz + Math.cos(a) * r });
  }
  return pts;
}

/** Distance from point to a polyline (closed when `closed`). */
export function distToPath(x, z, pts, closed = true) {
  let best = Infinity;
  const n = pts.length;
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const l2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / l2));
    const d = Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t));
    if (d < best) best = d;
  }
  return best;
}

// The world around the town: a 1.4 km vertex-coloured ground with rolling
// hills and patchwork fields, a ring of forest, distant landmarks (windmill
// with turning sails, water tower, drifting hot-air balloon), a welcome sign,
// and grass tufts / meadow flowers as thin instances.
import { Mesh, VertexData, Matrix, Vector3, Quaternion, TransformNode, CreateSphereVertexData } from "@babylonjs/core";
import { PALETTE } from "../palette.js";
import { terrainHeight, grassNoise, onRoad, blockAt, SIDEWALK, CURB_H, PARK, PLAYGROUND, distToPath } from "./layout.js";
import { mix, rgb, soloMesh, T } from "./geo.js";
import { COL, tree, flowerBed } from "./props.js";
import { inPond } from "./park.js";

const TAU = Math.PI * 2;

function gridLines() {
  const inner = [];
  for (let v = -140; v <= 140; v += 4) inner.push(v);
  const outer = [148, 158, 170, 184, 200, 220, 244, 272, 306, 348, 400, 470, 560, 700];
  return [...outer.map((v) => -v).reverse(), ...inner, ...outer];
}

const FIELD_COLS = ["#9ccc65", "#c5e17a", "#7cb342", "#e6d28a", "#8bc34a", "#b5d96b"];

function groundColor(x, z, h) {
  const d = Math.max(Math.abs(x), Math.abs(z));
  const n = grassNoise(x, z);
  let c = mix(PALETTE.grass, PALETTE.grassDark, Math.min(1, Math.max(0, (n - 0.35) * 1.4)));
  if (d > 90) {
    // sunlit hill tops, darker hollows
    c = mix(c, "#a9db6c", Math.min(1, h / 22) * 0.6);
  }
  if (d > 165) {
    const fx = Math.floor((x + 1000) / 46);
    const fz = Math.floor((z + 1000) / 38);
    const hash = Math.abs(Math.sin(fx * 12.9898 + fz * 78.233) * 43758.5453) % 1;
    const field = FIELD_COLS[Math.floor(hash * FIELD_COLS.length)];
    c = mix(c, field, Math.min(1, (d - 165) / 60) * 0.75);
  }
  return c;
}

function ground(ctx) {
  const { scene, mats } = ctx;
  const G = gridLines();
  const n = G.length;
  const positions = new Float32Array(n * n * 3);
  const colors = new Float32Array(n * n * 4);
  const indices = new Uint32Array((n - 1) * (n - 1) * 6);
  let p = 0;
  let c = 0;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = G[i];
      const z = G[j];
      const h = terrainHeight(x, z);
      positions[p++] = x;
      positions[p++] = h;
      positions[p++] = z;
      const col = groundColor(x, z, h);
      colors[c++] = col[0];
      colors[c++] = col[1];
      colors[c++] = col[2];
      colors[c++] = 1;
    }
  }
  let k = 0;
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const a = j * n + i;
      const b = a + 1;
      const d = a + n;
      const e = d + 1;
      // Babylon front faces: (b - a) x (c - a) points down for an up-facing quad
      indices[k++] = a;
      indices[k++] = b;
      indices[k++] = d;
      indices[k++] = b;
      indices[k++] = e;
      indices[k++] = d;
    }
  }
  const normals = new Float32Array(positions.length);
  VertexData.ComputeNormals(positions, indices, normals);
  const vd = new VertexData();
  vd.positions = positions;
  vd.normals = normals;
  vd.colors = colors;
  vd.indices = indices;
  const mesh = new Mesh("town_ground", scene);
  vd.applyToMesh(mesh, false);
  mesh.material = mats.solid;
  mesh.receiveShadows = true;
  mesh.isPickable = false;
  mesh.freezeWorldMatrix();
  ctx.groundMesh = mesh;
}

/** Cheap far-away tree: trunk + one or two canopy shapes. */
function farTree(f, x, y, z, kind, s, col) {
  f.cylB("solid", COL.trunk, x, y - 0.3, z, 0.5 * s, 1.6 * s, 5, 0.7);
  if (kind === "pine") {
    f.shape("solid", T.cyl(7, 0), col, x, y + 2.6 * s, z, 3.4 * s, 3.4 * s, 3.4 * s, null, { grad: [y + 1, y + 4.5 * s, 0.75, 1.05] });
    f.shape("solid", T.cyl(7, 0), col, x, y + 4.4 * s, z, 2.4 * s, 2.6 * s, 2.4 * s, null, { grad: [y + 3, y + 6 * s, 0.85, 1.1] });
  } else {
    f.sphere("solid", col, x, y + 3.0 * s, z, 3.4 * s, 3.1 * s, 3.4 * s, 4, null, { grad: [y + 1.5 * s, y + 4.5 * s, 0.72, 1.08] });
    if (s < 1.35) f.sphere("solid", col, x + 0.9 * s, y + 3.6 * s, z + 0.4 * s, 2.0 * s, 1.8 * s, 2.0 * s, 3, null, { grad: [y + 2.5 * s, y + 4.6 * s, 0.8, 1.1] });
  }
}

function forest(ctx) {
  const { root: f, rng, quality } = ctx;
  const step = quality === "low" ? 14 : 10.5;
  const foliage = ["#2e7d32", "#3f8f45", "#4caf50", "#5a9e3d", "#66bb6a"];
  let count = 0;
  for (let gx = -270; gx <= 270; gx += step) {
    for (let gz = -270; gz <= 270; gz += step) {
      const x = gx + (rng() - 0.5) * step * 0.9;
      const z = gz + (rng() - 0.5) * step * 0.9;
      const d = Math.max(Math.abs(x), Math.abs(z));
      if (d < 87 || Math.hypot(x, z) > 300) continue;
      // keep the road valleys open
      if (z < -80 && Math.abs(x) < 16) continue;
      if (Math.abs(x) > 80 && Math.abs(z) < 16) continue;
      if (onRoad(x, z, 4)) continue;
      // groves: denser close to town, patchy further out
      const grove = 0.5 + 0.5 * Math.sin(x * 0.031 + 1.7) * Math.cos(z * 0.027 - 0.6);
      const near = d < 112 ? 0.85 : d > 190 ? 0.15 + grove * 0.45 : 0.25 + grove * 0.6;
      if (rng() > near) continue;
      const y = terrainHeight(x, z);
      const pine = rng() < (d > 150 ? 0.55 : 0.4);
      const s = 1.0 + rng() * 0.55 + (d > 150 ? 0.25 : 0);
      if (d < 98 && quality !== "low") {
        const styles = ["round", "pine", "round", "poplar", "maple", "pine", "round"];
        tree({ ...ctx, colliders: null }, f, x, y, z, styles[Math.floor(rng() * styles.length)], s, count);
      } else {
        farTree(f, x, y, z, pine ? "pine" : "round", s, foliage[Math.floor(rng() * foliage.length)]);
      }
      count++;
    }
  }
  ctx.forestCount = count;
}

function windmill(ctx) {
  const { root, scene, mats } = ctx;
  const x = 128;
  const z = 168;
  const y = terrainHeight(x, z) - 0.6;
  const face = Math.atan2(-x, -z); // look at the town
  const f = root.child(x, y, z, face);
  f.cylB("solid", "#d9cdb8", 0, 0, 0, 7.2, 1.2, 12);
  f.cylB("solid", "#fdf0d5", 0, 1.2, 0, 6.2, 12.5, 12, 0.68, { grad: [y + 1, y + 13, 0.85, 1.02] });
  f.cylB("solid", COL.white, 0, 6.5, 0, 5.7, 0.35, 12);
  f.cylB("solid", "#c0504d", 0, 13.6, 0, 4.6, 0.4, 12);
  f.shape("solid", T.cyl(12, 0), "#e05d5d", 0, 15.4, 0, 4.8, 3.2, 4.8);
  f.gem("solid", COL.gold, 0, 17.2, 0, 0.5);
  f.boxB("solid", "#8a5a3b", 0, 1.2, 2.45, 1.5, 2.6, 0.4);
  for (const [wy, wx] of [[4.4, 0], [8.6, 0.0], [11.2, 0]]) {
    f.box("solid", COL.white, wx, wy, 2.1 - (wy - 4) * 0.07, 1.0, 1.3, 0.3);
    f.quad("glassDark", null, wx, wy, 2.27 - (wy - 4) * 0.07, 0.7, 1.0);
  }
  // sails (turning)
  const hubPos = f.pt(0, 13.4, 2.9);
  const hub = new TransformNode("town_windmillHub", scene);
  hub.position.set(hubPos[0], hubPos[1], hubPos[2]);
  hub.rotation.y = face;
  const blades = soloMesh(scene, "town_windmillSails", mats.solid, (m) => {
    m.cyl("m", "#7a4a28", 0, 0, -0.3, 1.0, 1.2, 10, 1, [Math.PI / 2, 0, 0]);
    m.sphere("m", "#7a4a28", 0, 0, 0.35, 0.8, 0.8, 0.6, 6);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU;
      const arm = m.child(0, 0, 0.2, 0);
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      // spar
      arm.box("m", "#7a4a28", sa * 5.2, ca * 5.2, 0, 0.3, 10.4, 0.25, [0, 0, -a]);
      // sail cloth panel + lattice
      const px = sa * 6.2 + ca * 0.95;
      const py = ca * 6.2 - sa * 0.95;
      arm.box("m", "#fff8ea", px, py, 0.05, 1.55, 7.2, 0.06, [0, 0, -a]);
      for (let k = 0; k < 5; k++) {
        const t = 3 + k * 1.6;
        arm.box("m", "#a0673a", sa * t + ca * 0.95, ca * t - sa * 0.95, 0.1, 1.7, 0.08, 0.06, [0, 0, -a]);
      }
    }
  });
  blades.parent = hub;
  ctx.anim.push((dt, t) => {
    blades.rotation.z = -t * 0.45;
  });
}

function waterTower(ctx) {
  const { root, atlas } = ctx;
  const x = -150;
  const z = 72;
  const y = terrainHeight(x, z) - 0.5;
  const face = Math.atan2(-x, -z);
  const f = root.child(x, y, z, face);
  const legs = 4.2;
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i / 4) * TAU;
    f.cyl("solid", "#9aa3b0", Math.sin(a) * legs * 0.85, 7, Math.cos(a) * legs * 0.85, 0.5, 14.2, 8, 1, [Math.cos(a) * 0.08, 0, -Math.sin(a) * 0.08]);
  }
  for (const h of [4.5, 9.5]) {
    for (let i = 0; i < 4; i++) {
      const a0 = Math.PI / 4 + (i / 4) * TAU;
      const a1 = a0 + TAU / 4;
      const r = legs * 0.85 - h * 0.02;
      f.tube("solid", "#8d8d99", [[Math.sin(a0) * r, h, Math.cos(a0) * r], [Math.sin(a1) * r, h, Math.cos(a1) * r]], 0.1, 5);
    }
  }
  f.cylB("solid", "#8ecae6", 0, 14, 0, 9.2, 6.2, 20, 1, { grad: [y + 14, y + 20, 0.85, 1.05] });
  f.cylB("solid", "#ffffff", 0, 14, 0, 9.4, 0.35, 20);
  f.cylB("solid", "#ffffff", 0, 19.9, 0, 9.4, 0.35, 20);
  f.shape("solid", T.cyl(20, 0), "#e05d5d", 0, 21.6, 0, 10, 3.2, 10);
  f.gem("solid", COL.gold, 0, 23.4, 0, 0.6);
  const uv = atlas.banner("TOON TOWN", { bg: "#e05d5d", fg: "#ffffff", h: 230, icon: "star" });
  // banner wrapped on the front as a gently curved strip of quads
  const segs = 6;
  for (let i = 0; i < segs; i++) {
    const a0 = -0.55 + (i / segs) * 1.1;
    const a1 = -0.55 + ((i + 1) / segs) * 1.1;
    const r = 4.68;
    const u0 = uv[0] + (uv[2] - uv[0]) * (i / segs);
    const u1 = uv[0] + (uv[2] - uv[0]) * ((i + 1) / segs);
    // viewer-left = +X locally, so u grows toward -X
    const p0 = [Math.sin(-a0) * r, 15.6, Math.cos(a0) * r];
    const p1 = [Math.sin(-a1) * r, 15.6, Math.cos(a1) * r];
    f.poly("sign", null, [p0, p1, [p1[0], 18.4, p1[2]], [p0[0], 18.4, p0[2]]], [Math.sin(-(a0 + a1) / 2), 0, Math.cos((a0 + a1) / 2)], [[u0, uv[1]], [u1, uv[1]], [u1, uv[3]], [u0, uv[3]]]);
  }
}

function balloon(ctx) {
  const { scene, mats } = ctx;
  const stripes = ["#ff5d5d", "#ffd93d", "#4d96ff", "#ffffff", "#6bcb77", "#ff8c42", "#c77dff", "#ffffff"];
  const gore = CreateSphereVertexData({ diameter: 1, segments: 10, arc: 1 / 8 });
  const mesh = soloMesh(scene, "town_balloon", mats.solid, (m, geo) => {
    // eight coloured gores: scale the 1/8 sphere slice, then turn it into place
    const S = Matrix.Scaling(9, 10.5, 9);
    for (let i = 0; i < 8; i++) {
      geo.get("m").add(gore, S.multiply(Matrix.RotationY((i / 8) * TAU)), stripes[i], { grad: [-5, 5, 0.85, 1.05] });
    }
    m.shape("m", T.cyl(16, 1.9), "#ff5d5d", 0, -5.2, 0, 2.6, 1.6, 2.6, [Math.PI, 0, 0]);
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + (i / 4) * TAU;
      m.tube("m", "#7a4a28", [[Math.sin(a) * 2.2, -5.8, Math.cos(a) * 2.2], [Math.sin(a) * 0.75, -8.6, Math.cos(a) * 0.75]], 0.05, 4);
    }
    m.rbox("m", "#a0673a", 0, -9.1, 0, 1.6, 1.1, 1.6, 0.12);
    m.box("m", "#7a4a28", 0, -8.55, 0, 1.7, 0.12, 1.7);
  });
  const node = new TransformNode("town_balloonNode", scene);
  mesh.parent = node;
  ctx.anim.push((dt, t) => {
    const a = t * 0.012 + 0.8;
    node.position.set(Math.sin(a) * 135, 58 + Math.sin(t * 0.25) * 3, Math.cos(a) * 135);
    node.rotation.y = t * 0.05;
    node.rotation.z = Math.sin(t * 0.4) * 0.03;
  });
  ctx.anim[ctx.anim.length - 1](0, 0);
}

function welcomeSign(ctx) {
  const { root, atlas } = ctx;
  const f = root.child(10.5, 0, -88, 0);
  const uv = atlas.banner("TOON TOWN", { bg: "#e05d5d", fg: "#ffffff", h: 230, icon: "star" });
  for (const s of [-1, 1]) f.cylB("solid", COL.woodDark, s * 2.6, 0, 0, 0.3, 3.6, 8);
  f.rbox("solid", COL.woodDark, 0, 2.6, 0, 6.0, 1.7, 0.2, 0.06);
  f.quad("sign", null, 0, 2.6, 0.105, 5.6, 1.4, 0, uv);
  f.quad("sign", null, 0, 2.6, -0.105, 5.6, 1.4, Math.PI, uv);
  flowerBed({ ...ctx, colliders: null }, f, -1.3, 0, 0.9, 1.0, 3);
  flowerBed({ ...ctx, colliders: null }, f, 1.3, 0, 0.9, 1.0, 5);
}

// -------------------------------------------------- grass tufts / flowers --
function groundDetail(ctx) {
  const { scene, mats, rng, quality, footprints } = ctx;
  if (quality === "low") return;
  const loop = ctx.parkLoop ?? [];
  const blocked = (x, z) => {
    if (onRoad(x, z, 0.3)) return true;
    if (Math.hypot(x, z) < 23) return true;
    if (inPond(x, z, 1.8)) return true;
    const P = PLAYGROUND;
    if (x > P.x0 - 1 && x < P.x1 + 1 && z > P.z0 - 1 && z < P.z1 + 1) return true;
    if (footprints.some((f) => x > f.x0 + 1 && x < f.x1 - 1 && z > f.z0 + 1 && z < f.z1 - 1)) return true;
    return false;
  };
  const surface = (x, z) => {
    const b = blockAt(x, z);
    if (b) {
      if (b.kind === "market") return null;
      const s = SIDEWALK + 0.4;
      if ((b.walk.includes("w") && x < b.x0 + s) || (b.walk.includes("e") && x > b.x1 - s)) return null;
      if ((b.walk.includes("s") && z < b.z0 + s) || (b.walk.includes("n") && z > b.z1 - s)) return null;
      if (b.kind === "shops" && ((b.x0 > 0 && x < b.x0 + s + 1.5) || (b.x1 < 0 && x > b.x1 - s - 1.5) || z < b.z0 + s + 1.5)) return null;
      return CURB_H;
    }
    if (x > PARK.x0 && x < PARK.x1 && z > PARK.z0 && z < PARK.z1) {
      if (x > -9 || z > -9) return null;
      if (loop.length && distToPath(x, z, loop) < 1.9) return null;
      return 0;
    }
    if (Math.abs(x) < 82 && Math.abs(z) < 82) return null;
    return terrainHeight(x, z);
  };
  const tufts = soloMesh(scene, "town_grassTufts", mats.foliage, (m) => {
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU + 0.3;
      m.shape("m", T.cyl(3, 0, 0), "#ffffff", Math.sin(a) * 0.06, 0.16, Math.cos(a) * 0.06, 0.07, 0.34, 0.07, [Math.cos(a) * 0.35, 0, -Math.sin(a) * 0.35], { grad: [0, 0.3, 0.6, 1.1] });
    }
  });
  // ~19 triangles per bloom: cupped flat petals, a centre and a stem
  const blooms = soloMesh(scene, "town_meadowFlowers", mats.foliage, (m) => {
    const y = 0.2;
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU;
      const p = (r, da, h) => [Math.sin(a + da) * r, y + h, Math.cos(a + da) * r];
      m.poly("m", "#ffffff", [p(0.02, 0, 0), p(0.07, -0.45, 0.015), p(0.12, 0, 0.035), p(0.07, 0.45, 0.015)], [0, 1, 0]);
    }
    const c = [];
    for (let i = 0; i < 5; i++) c.push([Math.sin((i / 5) * TAU) * 0.035, y + 0.012, Math.cos((i / 5) * TAU) * 0.035]);
    m.poly("m", "#ffe08a", c, [0, 1, 0]);
    m.shape("m", T.cyl(3, 1, 0), "#5a9a3c", 0, y / 2, 0, 0.018, y, 0.018);
  });
  const nT = quality === "medium" ? 2200 : 3200;
  const nF = quality === "medium" ? 800 : 1200;
  const grassCols = ["#6fbf4f", "#7fd35d", "#5fae45", "#8fdc66"].map(rgb);
  const flowerCols = PALETTE.flowers.map(rgb);
  const scatter = (mesh, count, cols, scaleMin, scaleMax) => {
    const mats16 = new Float32Array(count * 16);
    const colors = new Float32Array(count * 4);
    const m = new Matrix();
    const sc = new Vector3();
    const pos = new Vector3();
    const q = new Quaternion();
    let n = 0;
    for (let tries = 0; tries < count * 8 && n < count; tries++) {
      // bias samples toward the town & park, a share out on the hills
      const far = rng() < 0.3;
      const x = far ? (rng() - 0.5) * 260 : (rng() - 0.5) * 168;
      const z = far ? (rng() - 0.5) * 260 : (rng() - 0.5) * 168;
      if (blocked(x, z)) continue;
      const y = surface(x, z);
      if (y === null) continue;
      const s = scaleMin + rng() * (scaleMax - scaleMin);
      sc.set(s, s * (0.8 + rng() * 0.5), s);
      pos.set(x, y + 0.01, z);
      Quaternion.RotationYawPitchRollToRef(rng() * TAU, 0, 0, q);
      Matrix.ComposeToRef(sc, q, pos, m);
      m.copyToArray(mats16, n * 16);
      const c = cols[Math.floor(rng() * cols.length)];
      colors.set([c[0], c[1], c[2], 1], n * 4);
      n++;
    }
    mesh.thinInstanceSetBuffer("matrix", mats16.subarray(0, n * 16), 16, true);
    mesh.thinInstanceSetBuffer("color", colors.subarray(0, n * 4), 4, true);
    return n;
  };
  tufts.receiveShadows = true;
  blooms.receiveShadows = true;
  ctx.tuftCount = scatter(tufts, nT, grassCols, 0.9, 1.6);
  ctx.flowerCount = scatter(blooms, nF, flowerCols, 0.9, 1.4);
}

/** Build everything outside the town proper. */
export function buildOutskirts(ctx) {
  ground(ctx);
  forest(ctx);
  windmill(ctx);
  waterTower(ctx);
  balloon(ctx);
  welcomeSign(ctx);
  groundDetail(ctx);
}

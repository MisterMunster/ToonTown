// Collectibles: chunky spinning gold coins placed at town.coinSpots.
//
// All coins are ONE mesh drawn with thin instances (1 draw call), and their soft
// blob shadows are a second thin-instanced mesh (1 more draw call). Each frame we
// rewrite the per-instance matrices (spin, bob, magnet pull, pickup pop), which
// is ~40 x 16 floats — trivially cheap and allocation-free.
import {
  Mesh,
  VertexData,
  MeshBuilder,
  StandardMaterial,
  DynamicTexture,
  FresnelParameters,
  Color3,
  Vector3,
  Matrix,
} from "@babylonjs/core";
import { PALETTE } from "./palette.js";

const COIN_SCALE = 0.9; // overall coin size (base geometry is ~0.82 m across)
const SPIN_SPEED = 2.5; // rad/s
const BOB_AMP = 0.12; // m
const BOB_SPEED = 2.3; // rad/s
const CHEST_HEIGHT = 0.9; // pickup target above the player's feet
const PICKUP_RADIUS = 1.15;
const MAGNET_RADIUS = 2.2;
const MAGNET_PULL = 0.35; // max fraction of the gap a coin closes while magnetized
const POP_TIME = 0.3; // s
const SHADOW_DROP = 1.0 - 0.02; // blob sits at coin.y - 1.0 + 0.02

const ACTIVE = 0;
const POPPING = 1;
const GONE = 2;

/**
 * @param {import("@babylonjs/core").Scene} scene
 * @param {object} env   environment (only `nightFactor` is read, if present)
 * @param {{ coinSpots?: Array<{x:number,y:number,z:number}> }} town
 * @param {{ events: { emit(name: string, payload?: any): void } }} opts
 * @returns {{ update(dt: number, playerPos: Vector3): void, positions: Array<{x:number,z:number}>, collected: number, total: number }}
 */
export function createCollectibles(scene, env, town, { events } = {}) {
  const spots = Array.isArray(town?.coinSpots) ? town.coinSpots.filter(isFinitePoint) : [];
  const count = spots.length;

  // ---- meshes ---------------------------------------------------------------
  const coinMesh = new Mesh("coins", scene);
  buildCoinVertexData().applyToMesh(coinMesh);
  coinMesh.material = makeCoinMaterial(scene);
  coinMesh.isPickable = false;
  coinMesh.alwaysSelectAsActiveMesh = true; // instances move; skip bounds bookkeeping

  const blobMesh = MeshBuilder.CreateDisc("coinShadows", { radius: 0.42, tessellation: 24 }, scene);
  blobMesh.bakeTransformIntoVertices(Matrix.RotationX(Math.PI / 2)); // face up
  blobMesh.material = makeBlobMaterial(scene);
  blobMesh.isPickable = false;
  blobMesh.alwaysSelectAsActiveMesh = true;

  const coinBuf = new Float32Array(Math.max(1, count) * 16);
  const blobBuf = new Float32Array(Math.max(1, count) * 16);

  // ---- per-coin state ---------------------------------------------------------
  const positions = []; // live minimap list of remaining coins
  const coins = spots.map((s, i) => {
    const mapRef = { x: s.x, z: s.z };
    positions.push(mapRef);
    return {
      hx: s.x, hy: s.y, hz: s.z, // home (coin center)
      x: s.x, y: s.y, z: s.z, // current center
      phase: i * 2.399, // golden-angle offsets so neighbours never bob in sync
      rot: i * 1.7,
      pull: 0, // smoothed magnet weight 0..1 (spin boost)
      ox: 0, oy: 0, oz: 0, // smoothed magnet offset from home
      state: ACTIVE,
      popT: 0,
      popY: 0,
      mapRef,
    };
  });

  for (let i = 0; i < count; i++) writeMatrices(i, coins[i], 1, coins[i].hy - SHADOW_DROP, 1);
  if (count > 0) {
    coinMesh.thinInstanceSetBuffer("matrix", coinBuf, 16, false);
    blobMesh.thinInstanceSetBuffer("matrix", blobBuf, 16, false);
  } else {
    coinMesh.setEnabled(false);
    blobMesh.setEnabled(false);
  }

  const api = {
    positions,
    collected: 0,
    total: count,
    update,
  };

  let time = 0;
  let lastNight = -1;
  // Coins spin during the title-screen intro but can't be collected until play starts.
  let armed = typeof events?.on !== "function";
  events?.on?.("game:start", () => (armed = true));

  /** Writes the coin + blob instance matrices for coin i (rotation about Y, uniform scale). */
  function writeMatrices(i, c, scale, blobY, blobScale) {
    const o = i * 16;
    const s = scale * COIN_SCALE;
    const cs = Math.cos(c.rot) * s;
    const sn = Math.sin(c.rot) * s;
    // Babylon row-vector convention: Matrix.RotationY = [c,0,-s,0, 0,1,0,0, s,0,c,0, tx,ty,tz,1]
    coinBuf[o] = cs; coinBuf[o + 1] = 0; coinBuf[o + 2] = -sn; coinBuf[o + 3] = 0;
    coinBuf[o + 4] = 0; coinBuf[o + 5] = s; coinBuf[o + 6] = 0; coinBuf[o + 7] = 0;
    coinBuf[o + 8] = sn; coinBuf[o + 9] = 0; coinBuf[o + 10] = cs; coinBuf[o + 11] = 0;
    coinBuf[o + 12] = c.x; coinBuf[o + 13] = c.y; coinBuf[o + 14] = c.z; coinBuf[o + 15] = 1;

    const b = blobScale;
    blobBuf[o] = b; blobBuf[o + 1] = 0; blobBuf[o + 2] = 0; blobBuf[o + 3] = 0;
    blobBuf[o + 4] = 0; blobBuf[o + 5] = 1; blobBuf[o + 6] = 0; blobBuf[o + 7] = 0;
    blobBuf[o + 8] = 0; blobBuf[o + 9] = 0; blobBuf[o + 10] = b; blobBuf[o + 11] = 0;
    blobBuf[o + 12] = c.x; blobBuf[o + 13] = blobY; blobBuf[o + 14] = c.z; blobBuf[o + 15] = 1;
  }

  function hide(i) {
    coinBuf.fill(0, i * 16, i * 16 + 16);
    blobBuf.fill(0, i * 16, i * 16 + 16);
  }

  function collect(c) {
    c.state = POPPING;
    c.popT = 0;
    c.popY = c.y;
    const idx = positions.indexOf(c.mapRef);
    if (idx >= 0) positions.splice(idx, 1);
    api.collected++;
    events?.emit("coin:collected", {
      collected: api.collected,
      total: api.total,
      position: new Vector3(c.x, c.y, c.z),
    });
    if (api.collected === api.total) events?.emit("coin:all");
  }

  /**
   * @param {number} dt seconds
   * @param {Vector3} playerPos feet position
   */
  function update(dt, playerPos) {
    if (count === 0) return;
    dt = Number.isFinite(dt) ? Math.min(Math.max(dt, 0), 0.1) : 0;
    time += dt;
    updateNightLook();

    const havePlayer =
      armed && playerPos && Number.isFinite(playerPos.x) && Number.isFinite(playerPos.y) && Number.isFinite(playerPos.z);
    const px = havePlayer ? playerPos.x : 0;
    const py = havePlayer ? playerPos.y + CHEST_HEIGHT : -1e6;
    const pz = havePlayer ? playerPos.z : 0;
    const pullBlend = 1 - Math.exp(-10 * dt);
    let dirty = false;

    for (let i = 0; i < count; i++) {
      const c = coins[i];
      if (c.state === GONE) continue;
      dirty = true;

      if (c.state === ACTIVE) {
        const bob = Math.sin(time * BOB_SPEED + c.phase) * BOB_AMP;
        const hy = c.hy + bob;
        const dx = px - c.hx;
        const dy = py - hy;
        const dz = pz - c.hz;
        const d = havePlayer ? Math.sqrt(dx * dx + dy * dy + dz * dz) : Infinity;

        // Gentle magnet: weight rises from 0 at MAGNET_RADIUS to 1 at PICKUP_RADIUS.
        // The offset itself is smoothed, so coins always ease home (even after a teleport).
        const w = d < MAGNET_RADIUS ? smoothstep01((MAGNET_RADIUS - d) / (MAGNET_RADIUS - PICKUP_RADIUS)) : 0;
        const k = w * MAGNET_PULL;
        c.ox += (dx * k - c.ox) * pullBlend;
        c.oy += (dy * k * 0.5 - c.oy) * pullBlend; // weaker vertically so high coins still need a jump
        c.oz += (dz * k - c.oz) * pullBlend;
        c.pull += (w - c.pull) * pullBlend;
        c.x = c.hx + c.ox;
        c.y = hy + c.oy;
        c.z = c.hz + c.oz;
        c.rot += (SPIN_SPEED + c.pull * 7) * dt;

        const ex = px - c.x;
        const ey = py - c.y;
        const ez = pz - c.z;
        if (havePlayer && ex * ex + ey * ey + ez * ez < PICKUP_RADIUS * PICKUP_RADIUS) {
          collect(c);
        } else {
          // Blob shadow shrinks a touch as the coin bobs up.
          writeMatrices(i, c, 1, c.hy - SHADOW_DROP, 1 - bob * 0.9);
          continue;
        }
      }

      // POPPING: scale up, spin fast, rise, then shrink away.
      c.popT += dt;
      const u = Math.min(c.popT / POP_TIME, 1);
      if (u >= 1) {
        c.state = GONE;
        hide(i);
        continue;
      }
      const scale = u < 0.3 ? 1 + 0.5 * easeOutQuad(u / 0.3) : 1.5 * (1 - easeInQuad((u - 0.3) / 0.7));
      c.y = c.popY + 0.75 * easeOutCubic(u);
      c.rot += (SPIN_SPEED + 24 * (1 - u)) * dt;
      writeMatrices(i, c, scale, c.hy - SHADOW_DROP, Math.max(0, 1 - u * 1.4));
    }

    if (dirty) {
      coinMesh.thinInstanceBufferUpdated("matrix");
      blobMesh.thinInstanceBufferUpdated("matrix");
    }
  }

  /** Coins glow a little more at night so they stay readable; blob shadows fade. */
  function updateNightLook() {
    const n = Number(env?.nightFactor);
    const night = Number.isFinite(n) ? Math.min(Math.max(n, 0), 1) : 0;
    if (Math.abs(night - lastNight) < 0.01) return;
    lastNight = night;
    const e = 0.24 + 0.3 * night;
    coinMesh.material.emissiveColor.set(e, e, e);
    blobMesh.material.alpha = 1 - 0.45 * night;
  }

  return api;
}

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------

function makeCoinMaterial(scene) {
  const mat = new StandardMaterial("coinMat", scene);
  // Vertex colors carry the gold shades; the material only adds light response.
  mat.diffuseColor = new Color3(1, 1, 1);
  mat.specularColor = new Color3(1, 0.95, 0.8);
  mat.specularPower = 26;
  mat.emissiveColor = new Color3(0.24, 0.24, 0.24);
  // Rim light: edges glow up to full gold, faces facing the camera stay shaded.
  const fresnel = new FresnelParameters();
  fresnel.leftColor = new Color3(0.5, 0.5, 0.5); // facing the viewer
  fresnel.rightColor = new Color3(2.8, 2.8, 2.8); // grazing edges
  fresnel.bias = 0.05;
  fresnel.power = 2.4;
  mat.emissiveFresnelParameters = fresnel;
  return mat;
}

function makeBlobMaterial(scene) {
  const size = 64;
  const tex = new DynamicTexture("coinShadowTex", { width: size, height: size }, scene, false);
  const ctx = tex.getContext();
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(40,30,20,0.42)");
  g.addColorStop(0.55, "rgba(40,30,20,0.28)");
  g.addColorStop(1, "rgba(40,30,20,0)");
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  tex.hasAlpha = true;
  tex.update();

  const mat = new StandardMaterial("coinShadowMat", scene);
  mat.diffuseColor = new Color3(0, 0, 0);
  mat.specularColor = new Color3(0, 0, 0);
  mat.disableLighting = true;
  mat.opacityTexture = tex;
  mat.disableDepthWrite = true;
  mat.zOffset = -2;
  return mat;
}

// ---------------------------------------------------------------------------
// Coin geometry: a lathed body with a rounded raised rim, recessed faces and an
// embossed bevelled star on each side. Axis = local Z (upright coin, spins on Y).
// ---------------------------------------------------------------------------

function buildCoinVertexData() {
  const gold = Color3.FromHexString(PALETTE.coin); // rim
  const face = Color3.FromHexString("#f2a81d"); // recessed face: deeper, warmer gold
  const star = Color3.FromHexString("#ffe27a"); // embossed star: pale bright gold
  const P = [];
  const N = [];
  const C = [];
  const I = [];

  const vert = (x, y, z, nx, ny, nz, col) => {
    P.push(x, y, z);
    N.push(nx, ny, nz);
    C.push(col.r, col.g, col.b, 1);
    return P.length / 3 - 1;
  };
  // Add a triangle, flipping winding if needed so it faces along `n`.
  const tri = (a, b, c, nx, ny, nz) => {
    const ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2];
    const e1x = P[b * 3] - ax, e1y = P[b * 3 + 1] - ay, e1z = P[b * 3 + 2] - az;
    const e2x = P[c * 3] - ax, e2y = P[c * 3 + 1] - ay, e2z = P[c * 3 + 2] - az;
    const cx = e1y * e2z - e1z * e2y;
    const cy = e1z * e2x - e1x * e2z;
    const cz = e1x * e2y - e1y * e2x;
    // Babylon (left-handed) front faces satisfy cross(b-a, c-a) . n < 0.
    if (cx * nx + cy * ny + cz * nz > 0) I.push(a, c, b);
    else I.push(a, b, c);
  };

  const SEG = 40;
  // Rim profile (r, z) from the face crease, over the rounded lip, down to the equator.
  const half = [
    [0.3, 0.046], [0.31, 0.066], [0.326, 0.08], [0.348, 0.087], [0.372, 0.085],
    [0.391, 0.074], [0.403, 0.054], [0.409, 0.028], [0.41, 0],
  ];
  const profile = half.concat(half.slice(0, -1).reverse().map(([r, z]) => [r, -z]));
  const profNormals = profile.map((p, j) => {
    const a = profile[Math.max(j - 1, 0)];
    const b = profile[Math.min(j + 1, profile.length - 1)];
    const tr = b[0] - a[0];
    const tz = b[1] - a[1];
    const len = Math.hypot(tr, tz) || 1;
    return [-tz / len, tr / len]; // rotate tangent +90deg -> outward
  });
  const ring0 = P.length / 3;
  for (let j = 0; j < profile.length; j++) {
    const [r, z] = profile[j];
    const [nr, nz] = profNormals[j];
    for (let s = 0; s <= SEG; s++) {
      const a = (s / SEG) * Math.PI * 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      vert(r * ca, r * sa, z, nr * ca, nr * sa, nz, gold);
    }
  }
  for (let j = 0; j < profile.length - 1; j++) {
    const [nr0, nz0] = profNormals[j];
    for (let s = 0; s < SEG; s++) {
      const a0 = ring0 + j * (SEG + 1) + s;
      const a1 = a0 + 1;
      const b0 = a0 + SEG + 1;
      const b1 = b0 + 1;
      const ang = ((s + 0.5) / SEG) * Math.PI * 2;
      const nx = nr0 * Math.cos(ang), ny = nr0 * Math.sin(ang);
      tri(a0, b0, a1, nx, ny, nz0);
      tri(a1, b0, b1, nx, ny, nz0);
    }
  }

  // Recessed faces (front +Z, back -Z).
  for (const side of [1, -1]) {
    const z = 0.046 * side;
    const center = vert(0, 0, z, 0, 0, side, face);
    const first = P.length / 3;
    for (let s = 0; s <= SEG; s++) {
      const a = (s / SEG) * Math.PI * 2;
      vert(0.3 * Math.cos(a), 0.3 * Math.sin(a), z, 0, 0, side, face);
    }
    for (let s = 0; s < SEG; s++) tri(center, first + s, first + s + 1, 0, 0, side);
  }

  // Embossed, bevelled five-point star on both faces (flat-shaded facets).
  const R_OUT = 0.205;
  const R_IN = 0.088;
  const pts = [];
  for (let k = 0; k < 10; k++) {
    const a = Math.PI / 2 + (k * Math.PI) / 5;
    const r = k % 2 === 0 ? R_OUT : R_IN;
    pts.push([r * Math.cos(a), r * Math.sin(a)]);
  }
  for (const side of [1, -1]) {
    const zBase = 0.046 * side;
    const zEdge = 0.068 * side;
    const zPeak = 0.088 * side;
    for (let k = 0; k < 10; k++) {
      const [x0, y0] = pts[k];
      const [x1, y1] = pts[(k + 1) % 10];
      // Top facet: center peak -> edge k -> edge k+1, with its own flat normal.
      const n = faceNormal([0, 0, zPeak], [x0, y0, zEdge], [x1, y1, zEdge], side);
      const a = vert(0, 0, zPeak, n[0], n[1], n[2], star);
      const b = vert(x0, y0, zEdge, n[0], n[1], n[2], star);
      const c = vert(x1, y1, zEdge, n[0], n[1], n[2], star);
      tri(a, b, c, n[0], n[1], n[2]);
      // Side wall down to the face.
      let wx = y1 - y0;
      let wy = -(x1 - x0);
      const wl = Math.hypot(wx, wy) || 1;
      wx /= wl;
      wy /= wl;
      if (wx * (x0 + x1) + wy * (y0 + y1) < 0) { wx = -wx; wy = -wy; } // point outward
      const sc = star.scale(0.92);
      const w0 = vert(x0, y0, zEdge, wx, wy, 0, sc);
      const w1 = vert(x1, y1, zEdge, wx, wy, 0, sc);
      const w2 = vert(x0, y0, zBase, wx, wy, 0, sc);
      const w3 = vert(x1, y1, zBase, wx, wy, 0, sc);
      tri(w0, w2, w1, wx, wy, 0);
      tri(w1, w2, w3, wx, wy, 0);
    }
  }

  const vd = new VertexData();
  vd.positions = P;
  vd.normals = N;
  vd.colors = C;
  vd.indices = I;
  return vd;
}

/** Unit normal of triangle (a, b, c), oriented so its z component has the sign of `side`. */
function faceNormal(a, b, c, side) {
  const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  let n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
  const l = Math.hypot(n[0], n[1], n[2]) || 1;
  n = n.map((v) => v / l);
  if (n[2] * side < 0) n = n.map((v) => -v);
  return n;
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function isFinitePoint(p) {
  return p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);
}
function smoothstep01(x) {
  const t = Math.min(Math.max(x, 0), 1);
  return t * t * (3 - 2 * t);
}
const easeOutQuad = (t) => 1 - (1 - t) * (1 - t);
const easeInQuad = (t) => t * t;
const easeOutCubic = (t) => 1 - (1 - t) ** 3;

// Static-geometry batching for the town.
//
// Everything static is modelled through `Frame` helpers that append
// vertex-coloured primitives into named `Bucket`s. A bucket maps to one
// material; at the end each bucket becomes one mesh per spatial chunk, so the
// whole town costs a few dozen draw calls while staying frustum/shadow-cullable.
// Frames are rigid (translation + yaw only) so colliders can be registered in
// the same local coordinates as the visuals.
import {
  Matrix,
  Quaternion,
  Vector3,
  Mesh,
  VertexData,
  CreateBoxVertexData,
  CreateCylinderVertexData,
  CreateSphereVertexData,
  CreatePolyhedronVertexData,
} from "@babylonjs/core";

// ---------------------------------------------------------------- colours --
const colorCache = new Map();

/** Hex string (or [r,g,b]) -> [r,g,b] in 0..1. */
export function rgb(c) {
  if (Array.isArray(c)) return c;
  let v = colorCache.get(c);
  if (!v) {
    const n = parseInt(c.slice(1), 16);
    v = [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
    colorCache.set(c, v);
  }
  return v;
}

/** Multiply a colour's brightness. */
export function shade(c, k) {
  const [r, g, b] = rgb(c);
  return [Math.min(1, r * k), Math.min(1, g * k), Math.min(1, b * k)];
}

/** Linear blend between two colours. */
export function mix(a, b, t) {
  const A = rgb(a);
  const B = rgb(b);
  return [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t];
}

export const smooth = (e0, e1, x) => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

// -------------------------------------------------------------- templates --
const templates = new Map();
function template(key, make) {
  let v = templates.get(key);
  if (!v) templates.set(key, (v = make()));
  return v;
}

/** Unit-sized primitive vertex data, shared and never mutated. */
export const T = {
  box: () => template("box", () => CreateBoxVertexData({ size: 1 })),
  cyl: (tess = 12, top = 1, cap = 3) =>
    template(`cyl${tess}_${top}_${cap}`, () =>
      CreateCylinderVertexData({ height: 1, diameterBottom: 1, diameterTop: top, tessellation: tess, cap }),
    ),
  sphere: (seg = 6) => template(`sph${seg}`, () => CreateSphereVertexData({ diameter: 1, segments: seg })),
  /** type 1 = octahedron, 3 = icosahedron (flat, low-poly "gem" blobs). */
  poly: (type = 1) => template(`poly${type}`, () => CreatePolyhedronVertexData({ type, size: 0.5 })),
};

// ----------------------------------------------------------------- bucket --
const TMP_INV = new Matrix();
const TMP_NM = new Matrix();
const NO_OPTS = {};

class Part {
  constructor() {
    this.pos = [];
    this.nrm = [];
    this.uv = [];
    this.col = [];
    this.idx = [];
    this.count = 0;
  }
}

/**
 * A growable vertex soup for one material, split into spatial chunks.
 * opts: { uvs, colors, chunk: (x, z) => key|null, material, cast, receive }
 */
export class Bucket {
  constructor(name, opts) {
    this.name = name;
    this.opts = { uvs: false, colors: true, chunk: null, cast: false, receive: true, ...opts };
    this.parts = new Map();
  }

  _part(x, z) {
    const key = this.opts.chunk ? this.opts.chunk(x, z) : "all";
    let p = this.parts.get(key);
    if (!p) this.parts.set(key, (p = new Part()));
    return p;
  }

  _color(c, top, wy, ny, o) {
    let col = top && ny > 0.5 ? top : c;
    if (o.grad) {
      const [y0, y1, k0, k1 = 1] = o.grad;
      const k = k0 + (k1 - k0) * smooth(y0, y1, wy);
      return [col[0] * k, col[1] * k, col[2] * k];
    }
    return col;
  }

  /**
   * Append vertex data transformed by `m` (any affine matrix).
   * o: { top: colour for upward faces, grad: [y0, y1, k0, k1] brightness ramp
   *      by world height, uv: [u0, v0, u1, v1] remap of 0..1 uvs, at: [x, z] chunk hint }
   */
  add(vd, m, color, o) {
    o = o || NO_OPTS;
    const mm = m.m;
    m.invertToRef(TMP_INV);
    Matrix.TransposeToRef(TMP_INV, TMP_NM);
    const nm = TMP_NM.m;
    const part = this._part(o.at ? o.at[0] : mm[12], o.at ? o.at[1] : mm[14]);
    const P = vd.positions;
    const N = vd.normals;
    const U = vd.uvs;
    const n = P.length / 3;
    const base = part.count;
    const c = rgb(color ?? "#ffffff");
    const top = o.top ? rgb(o.top) : null;
    const { uvs, colors } = this.opts;
    for (let i = 0; i < n; i++) {
      const x = P[i * 3];
      const y = P[i * 3 + 1];
      const z = P[i * 3 + 2];
      const wy = x * mm[1] + y * mm[5] + z * mm[9] + mm[13];
      part.pos.push(x * mm[0] + y * mm[4] + z * mm[8] + mm[12], wy, x * mm[2] + y * mm[6] + z * mm[10] + mm[14]);
      const a = N[i * 3];
      const b = N[i * 3 + 1];
      const d = N[i * 3 + 2];
      let nx = a * nm[0] + b * nm[4] + d * nm[8];
      let ny = a * nm[1] + b * nm[5] + d * nm[9];
      let nz = a * nm[2] + b * nm[6] + d * nm[10];
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l;
      ny /= l;
      nz /= l;
      part.nrm.push(nx, ny, nz);
      if (uvs) {
        let u = U ? U[i * 2] : 0;
        let v = U ? U[i * 2 + 1] : 0;
        if (o.uv) {
          u = o.uv[0] + (o.uv[2] - o.uv[0]) * u;
          v = o.uv[1] + (o.uv[3] - o.uv[1]) * v;
        }
        part.uv.push(u, v);
      }
      if (colors) {
        const k = this._color(c, top, wy, ny, o);
        part.col.push(k[0], k[1], k[2], 1);
      }
    }
    const I = vd.indices;
    for (let i = 0; i < I.length; i++) part.idx.push(base + I[i]);
    part.count += n;
  }

  /**
   * Append a flat convex polygon given in WORLD space. The winding is fixed up
   * from the desired outward normal `n`. uvs: optional [[u,v],...].
   */
  addPoly(pts, n, color, uvs = null, o) {
    o = o || NO_OPTS;
    const part = this._part(o.at ? o.at[0] : pts[0][0], o.at ? o.at[1] : pts[0][2]);
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    const nx = n[0] / l;
    const ny = n[1] / l;
    const nz = n[2] / l;
    const base = part.count;
    const c = rgb(color ?? "#ffffff");
    const top = o.top ? rgb(o.top) : null;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      part.pos.push(p[0], p[1], p[2]);
      part.nrm.push(nx, ny, nz);
      if (this.opts.uvs) part.uv.push(uvs ? uvs[i][0] : 0, uvs ? uvs[i][1] : 0);
      if (this.opts.colors) {
        const k = this._color(c, top, p[1], ny, o);
        part.col.push(k[0], k[1], k[2], 1);
      }
    }
    // Babylon front faces satisfy (b - a) x (c - a) . n < 0.
    const [p0, p1, p2] = pts;
    const ax = p1[0] - p0[0], ay = p1[1] - p0[1], az = p1[2] - p0[2];
    const bx = p2[0] - p0[0], by = p2[1] - p0[1], bz = p2[2] - p0[2];
    const cx = ay * bz - az * by;
    const cy = az * bx - ax * bz;
    const cz = ax * by - ay * bx;
    const flip = cx * nx + cy * ny + cz * nz > 0;
    for (let k = 1; k < pts.length - 1; k++) {
      if (flip) part.idx.push(base, base + k + 1, base + k);
      else part.idx.push(base, base + k, base + k + 1);
    }
    part.count += pts.length;
  }

  get vertexCount() {
    let n = 0;
    for (const p of this.parts.values()) n += p.count;
    return n;
  }
}

// -------------------------------------------------------------------- geo --
/** Registry of buckets; `build()` turns them into meshes. */
export class Geo {
  constructor(scene) {
    this.scene = scene;
    this.buckets = new Map();
  }

  define(name, opts) {
    const b = new Bucket(name, opts);
    this.buckets.set(name, b);
    return b;
  }

  get(name) {
    const b = this.buckets.get(name);
    if (!b) throw new Error(`[town] unknown bucket "${name}"`);
    return b;
  }

  /** Root frame (world space). */
  root() {
    return new Frame(this, Matrix.Identity());
  }

  /** Bake every bucket. Returns [{ mesh, bucket, chunk }]. */
  build(prefix = "town") {
    const out = [];
    for (const b of this.buckets.values()) {
      for (const [chunk, p] of b.parts) {
        if (!p.count) continue;
        const mesh = partToMesh(`${prefix}_${b.name}_${chunk}`, this.scene, p, b.opts);
        mesh.material = b.opts.material ?? null;
        mesh.receiveShadows = !!b.opts.receive;
        mesh.isPickable = false;
        mesh.freezeWorldMatrix();
        mesh.doNotSyncBoundingInfo = true;
        out.push({ mesh, bucket: b.name, chunk, cast: !!b.opts.cast });
      }
      b.parts.clear();
    }
    return out;
  }
}

function partToMesh(name, scene, p, opts) {
  const vd = new VertexData();
  vd.positions = new Float32Array(p.pos);
  vd.normals = new Float32Array(p.nrm);
  if (opts.uvs) vd.uvs = new Float32Array(p.uv);
  if (opts.colors) vd.colors = new Float32Array(p.col);
  vd.indices = p.count > 65535 ? new Uint32Array(p.idx) : new Uint16Array(p.idx);
  const mesh = new Mesh(name, scene);
  vd.applyToMesh(mesh, false);
  return mesh;
}

/**
 * Build one standalone (movable) mesh from frame-based modelling code.
 * `fn(frame)` models around the local origin into bucket "m".
 */
export function soloMesh(scene, name, material, fn, { uvs = false, colors = true } = {}) {
  const geo = new Geo(scene);
  geo.define("m", { uvs, colors, material });
  fn(geo.root(), geo);
  const b = geo.get("m");
  const p = b.parts.get("all");
  const mesh = partToMesh(name, scene, p ?? new Part(), b.opts);
  mesh.material = material;
  mesh.isPickable = false;
  return mesh;
}

// ------------------------------------------------------------------ frame --
const V_S = new Vector3();
const V_T = new Vector3();
const Q_R = new Quaternion();
const M_L = new Matrix();
const M_W = new Matrix();
const rboxCache = new Map();

/**
 * A rigid local coordinate frame (yaw + translation). All modelling helpers
 * take local coordinates; shapes are centred on (x, y, z) unless stated.
 * `rot` = [rx, ry, rz] Euler angles applied to the shape itself.
 */
export class Frame {
  constructor(geo, m) {
    this.geo = geo;
    this.m = m;
  }

  /** Child frame at (x, y, z) turned by yaw `ry` (local +Z -> (sin ry, 0, cos ry)). */
  child(x, y, z, ry = 0) {
    const l = Matrix.RotationY(ry);
    l.setTranslationFromFloats(x, y, z);
    return new Frame(this.geo, l.multiply(this.m));
  }

  /** World position of a local point. */
  pt(x, y, z) {
    const m = this.m.m;
    return [x * m[0] + y * m[4] + z * m[8] + m[12], x * m[1] + y * m[5] + z * m[9] + m[13], x * m[2] + y * m[6] + z * m[10] + m[14]];
  }

  /** World direction of a local vector. */
  dir(x, y, z) {
    const m = this.m.m;
    return [x * m[0] + y * m[4] + z * m[8], x * m[1] + y * m[5] + z * m[9], x * m[2] + y * m[6] + z * m[10]];
  }

  get yaw() {
    const m = this.m.m;
    return Math.atan2(m[8], m[10]);
  }

  _matrix(x, y, z, sx, sy, sz, rot) {
    V_S.set(sx, sy, sz);
    V_T.set(x, y, z);
    if (rot) Quaternion.RotationYawPitchRollToRef(rot[1] || 0, rot[0] || 0, rot[2] || 0, Q_R);
    else Q_R.set(0, 0, 0, 1);
    Matrix.ComposeToRef(V_S, Q_R, V_T, M_L);
    M_L.multiplyToRef(this.m, M_W);
    return M_W;
  }

  /** Any template shape scaled to (sx, sy, sz). */
  shape(bucket, vd, color, x, y, z, sx, sy, sz, rot, o) {
    this.geo.get(bucket).add(vd, this._matrix(x, y, z, sx, sy, sz, rot), color, o);
  }

  box(bucket, color, x, y, z, w, h, d, rot, o) {
    this.shape(bucket, T.box(), color, x, y, z, w, h, d, rot, o);
  }

  /** Box resting on y (bottom at y). */
  boxB(bucket, color, x, y, z, w, h, d, rot, o) {
    this.shape(bucket, T.box(), color, x, y + h / 2, z, w, h, d, rot, o);
  }

  /** Cylinder / cone centred on (x, y, z); `top` = top diameter ratio. */
  cyl(bucket, color, x, y, z, dia, h, tess = 12, top = 1, rot, o) {
    this.shape(bucket, T.cyl(tess, top), color, x, y, z, dia, h, dia, rot, o);
  }

  /** Cylinder resting on y. */
  cylB(bucket, color, x, y, z, dia, h, tess = 12, top = 1, o) {
    this.shape(bucket, T.cyl(tess, top), color, x, y + h / 2, z, dia, h, dia, null, o);
  }

  sphere(bucket, color, x, y, z, dx, dy = dx, dz = dx, seg = 6, rot, o) {
    this.shape(bucket, T.sphere(seg), color, x, y, z, dx, dy, dz, rot, o);
  }

  /** Low-poly gem blob (octahedron by default). */
  gem(bucket, color, x, y, z, s, type = 1, rot, o) {
    this.shape(bucket, T.poly(type), color, x, y, z, s, s, s, rot, o);
  }

  /** Chamfered ("soft toy") box centred on (x, y, z). */
  rbox(bucket, color, x, y, z, w, h, d, bevel = 0.08, rot, o) {
    const key = `${w.toFixed(3)}|${h.toFixed(3)}|${d.toFixed(3)}|${bevel.toFixed(3)}`;
    let vd = rboxCache.get(key);
    if (!vd) rboxCache.set(key, (vd = makeRBox(w, h, d, Math.min(bevel, w / 2.01, h / 2.01, d / 2.01))));
    this.shape(bucket, vd, color, x, y, z, 1, 1, 1, rot, o);
  }

  /** Flat convex polygon from local points; `n` = local outward normal. */
  poly(bucket, color, pts, n, uvs, o) {
    const wp = pts.map((p) => this.pt(p[0], p[1], p[2]));
    this.geo.get(bucket).addPoly(wp, this.dir(n[0], n[1], n[2]), color, uvs, o);
  }

  /**
   * Vertical rectangle centred on (x, y) at depth z, facing local +Z (or the
   * direction given by yaw `ry`). uvRect [u0, v0, u1, v1] is mapped so text
   * reads correctly for a viewer in front.
   */
  quad(bucket, color, x, y, z, w, h, ry = 0, uvRect = [0, 0, 1, 1], o) {
    const c = Math.cos(ry);
    const s = Math.sin(ry);
    // local right-to-viewer = -X rotated by ry
    const rx = -c * (w / 2);
    const rz = s * (w / 2);
    const pts = [
      [x - rx, y - h / 2, z - rz],
      [x + rx, y - h / 2, z + rz],
      [x + rx, y + h / 2, z + rz],
      [x - rx, y + h / 2, z - rz],
    ];
    const [u0, v0, u1, v1] = uvRect;
    this.poly(bucket, color, pts, [s, 0, c], [[u0, v0], [u1, v0], [u1, v1], [u0, v1]], o);
  }

  /** Horizontal rectangle (top-facing) centred on (x, y, z), turned by ry. */
  flat(bucket, color, x, y, z, w, d, ry = 0, o, uvs) {
    const c = Math.cos(ry);
    const s = Math.sin(ry);
    const hw = w / 2;
    const hd = d / 2;
    const corner = (a, b) => [x + a * c + b * s, y, z - a * s + b * c];
    this.poly(bucket, color, [corner(-hw, -hd), corner(hw, -hd), corner(hw, hd), corner(-hw, hd)], [0, 1, 0], uvs, o);
  }

  /** Top-facing annulus sector (r0..r1, angles a0..a1 measured from +Z toward +X). */
  ring(bucket, color, x, y, z, r0, r1, a0 = 0, a1 = Math.PI * 2, segs = 48, o) {
    for (let i = 0; i < segs; i++) {
      const t0 = a0 + ((a1 - a0) * i) / segs;
      const t1 = a0 + ((a1 - a0) * (i + 1)) / segs;
      const p = (r, t) => [x + Math.sin(t) * r, y, z + Math.cos(t) * r];
      const pts = r0 > 0.001 ? [p(r0, t0), p(r1, t0), p(r1, t1), p(r0, t1)] : [[x, y, z], p(r1, t0), p(r1, t1)];
      this.poly(bucket, color, pts, [0, 1, 0], null, o);
    }
  }

  /** Top-facing filled disc with planar uvs (u = x / uvScale). */
  disc(bucket, color, x, y, z, r, segs = 32, uvScale = 0, o) {
    const wp = [];
    for (let i = 0; i < segs; i++) {
      const t = (i / segs) * Math.PI * 2;
      wp.push([x + Math.sin(t) * r, y, z + Math.cos(t) * r]);
    }
    const uvs = uvScale ? wp.map((p) => [p[0] / uvScale, p[2] / uvScale]) : null;
    this.poly(bucket, color, wp, [0, 1, 0], uvs, o);
  }

  /**
   * Flat-shaded frustum: bottom rect w0 x d0 at y, top rect w1 x d1 at y + h,
   * centred on (x, z). w1 = d1 = 0 gives a pyramid; d1 = 0 gives a hip roof
   * ridge. Bottom face omitted (roofs sit on walls).
   */
  frustum(bucket, color, x, y, z, w0, d0, w1, d1, h, o, bottom = false) {
    const b = [
      [x - w0 / 2, y, z - d0 / 2],
      [x + w0 / 2, y, z - d0 / 2],
      [x + w0 / 2, y, z + d0 / 2],
      [x - w0 / 2, y, z + d0 / 2],
    ];
    const t = [
      [x - w1 / 2, y + h, z - d1 / 2],
      [x + w1 / 2, y + h, z - d1 / 2],
      [x + w1 / 2, y + h, z + d1 / 2],
      [x - w1 / 2, y + h, z + d1 / 2],
    ];
    const cx = x;
    const cy = y + h * 0.4;
    const cz = z;
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      let pts = [b[i], b[j], t[j], t[i]];
      // drop duplicate apex points so the face normal is well defined
      if (Math.abs(t[i][0] - t[j][0]) < 1e-6 && Math.abs(t[i][2] - t[j][2]) < 1e-6) pts = [b[i], b[j], t[j]];
      const n = faceNormal(pts, [cx, cy, cz]);
      this.poly(bucket, color, pts, n, null, o);
    }
    if (w1 > 1e-4 && d1 > 1e-4) this.poly(bucket, color, t, [0, 1, 0], null, o);
    if (bottom) this.poly(bucket, color, b, [0, -1, 0], null, o);
  }

  /**
   * Gable roof over a w x d footprint centred at (x, z) with eaves at y.
   * ridge: "x" (ridge parallel to local X) or "z". Gable end triangles take
   * `wallColor`; slabs, barge boards and ridge cap are added.
   */
  gable(bucket, roofColor, wallColor, trimColor, x, y, z, w, d, { ridge = "x", pitch = 0.65, overhang = 0.35, thick = 0.18 } = {}) {
    const alongX = ridge === "x";
    const span = alongX ? d : w;
    const len = alongX ? w : d;
    const rise = (span / 2) * Math.tan(pitch);
    // gable-end triangles
    for (const s of [-1, 1]) {
      const e = (s * len) / 2;
      const tri = alongX
        ? [[x + e, y, z - span / 2], [x + e, y, z + span / 2], [x + e, y + rise, z]]
        : [[x - span / 2, y, z + e], [x + span / 2, y, z + e], [x, y + rise, z + e]];
      this.poly(bucket, wallColor, tri, alongX ? [s, 0, 0] : [0, 0, s]);
    }
    const ls = (span / 2 + overhang) / Math.cos(pitch);
    const c = Math.cos(pitch);
    const sn = Math.sin(pitch);
    for (const s of [-1, 1]) {
      // slab centre: from the ridge go down-slope by ls/2, then up the normal by thick/2
      const along = s * (c * ls) / 2 + s * sn * (thick / 2);
      const cy = y + rise - (sn * ls) / 2 + (c * thick) / 2;
      const L = len + overhang * 2;
      if (alongX) {
        this.box(bucket, roofColor, x, cy, z + along, L, thick, ls, [s * pitch, 0, 0]);
        for (const e of [-1, 1]) {
          this.box(bucket, trimColor, x + e * (L / 2 - 0.03), cy - 0.13, z + along, 0.08, 0.26, ls, [s * pitch, 0, 0]);
        }
      } else {
        this.box(bucket, roofColor, x + along, cy, z, ls, thick, L, [0, 0, -s * pitch]);
        for (const e of [-1, 1]) {
          this.box(bucket, trimColor, x + along, cy - 0.13, z + e * (L / 2 - 0.03), ls, 0.26, 0.08, [0, 0, -s * pitch]);
        }
      }
    }
    const capY = y + rise + thick / c - 0.02;
    if (alongX) this.box(bucket, shadeArr(roofColor, 0.8), x, capY, z, len + overhang * 2 + 0.06, 0.16, 0.3);
    else this.box(bucket, shadeArr(roofColor, 0.8), x, capY, z, 0.3, 0.16, len + overhang * 2 + 0.06);
    return rise;
  }

  /** Tube along a local polyline (open ends). uv: u around, v along length / uvLen. */
  tube(bucket, color, path, radius, tess = 6, uvLen = 1, o) {
    const geo = makeTube(path, radius, tess, uvLen);
    this.shape(bucket, geo, color, 0, 0, 0, 1, 1, 1, null, o);
  }

  /** Axis-aligned world collider box from local min/max corners. */
  colBox(colliders, x0, y0, z0, x1, y1, z1, tag = "solid") {
    const a = this.pt(x0, y0, z0);
    const b = this.pt(x1, y1, z1);
    const c = this.pt(x0, y0, z1);
    const d = this.pt(x1, y0, z0);
    const xs = [a[0], b[0], c[0], d[0]];
    const zs = [a[2], b[2], c[2], d[2]];
    return colliders.addBox(Math.min(...xs), Math.min(a[1], b[1]), Math.min(...zs), Math.max(...xs), Math.max(a[1], b[1]), Math.max(...zs), tag);
  }

  /** Vertical collider cylinder at local (x, z) from y0 to y1. */
  colCyl(colliders, x, z, r, y0, y1, tag = "solid") {
    const p = this.pt(x, y0, z);
    return colliders.addCylinder(p[0], p[2], r, p[1], p[1] + (y1 - y0), tag);
  }
}

// --------------------------------------------------------- custom shapes --
function shadeArr(c, k) {
  const [r, g, b] = rgb(c);
  return [r * k, g * k, b * k];
}

/** Normal of a planar polygon, oriented away from `inside`. */
function faceNormal(pts, inside) {
  const [a, b, c] = pts;
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  let n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
  const mx = (a[0] + b[0] + c[0]) / 3 - inside[0];
  const my = (a[1] + b[1] + c[1]) / 3 - inside[1];
  const mz = (a[2] + b[2] + c[2]) / 3 - inside[2];
  if (n[0] * mx + n[1] * my + n[2] * mz < 0) n = [-n[0], -n[1], -n[2]];
  return n;
}

function makeRBox(w, h, d, b) {
  const H = [w / 2, h / 2, d / 2];
  const I = [H[0] - b, H[1] - b, H[2] - b];
  const positions = [];
  const normals = [];
  const indices = [];
  const poly = (pts, n) => {
    const l = Math.hypot(n[0], n[1], n[2]);
    const base = positions.length / 3;
    for (const p of pts) {
      positions.push(p[0], p[1], p[2]);
      normals.push(n[0] / l, n[1] / l, n[2] / l);
    }
    const [p0, p1, p2] = pts;
    const ax = p1[0] - p0[0], ay = p1[1] - p0[1], az = p1[2] - p0[2];
    const bx = p2[0] - p0[0], by = p2[1] - p0[1], bz = p2[2] - p0[2];
    const flip = (ay * bz - az * by) * n[0] + (az * bx - ax * bz) * n[1] + (ax * by - ay * bx) * n[2] > 0;
    for (let k = 1; k < pts.length - 1; k++) {
      if (flip) indices.push(base, base + k + 1, base + k);
      else indices.push(base, base + k, base + k + 1);
    }
  };
  const vec = (a, va, bAxis, vb, c, vc) => {
    const v = [0, 0, 0];
    v[a] = va;
    v[bAxis] = vb;
    v[c] = vc;
    return v;
  };
  // faces
  for (let a = 0; a < 3; a++) {
    const u = (a + 1) % 3;
    const v = (a + 2) % 3;
    for (const s of [-1, 1]) {
      const n = [0, 0, 0];
      n[a] = s;
      poly(
        [
          vec(a, s * H[a], u, -I[u], v, -I[v]),
          vec(a, s * H[a], u, I[u], v, -I[v]),
          vec(a, s * H[a], u, I[u], v, I[v]),
          vec(a, s * H[a], u, -I[u], v, I[v]),
        ],
        n,
      );
    }
  }
  if (b > 0.0005) {
    // edges
    for (let a = 0; a < 3; a++) {
      const bb = (a + 1) % 3;
      const c = (a + 2) % 3;
      for (const sa of [-1, 1]) {
        for (const sb of [-1, 1]) {
          const n = [0, 0, 0];
          n[a] = sa;
          n[bb] = sb;
          poly(
            [
              vec(a, sa * H[a], bb, sb * I[bb], c, -I[c]),
              vec(a, sa * H[a], bb, sb * I[bb], c, I[c]),
              vec(a, sa * I[a], bb, sb * H[bb], c, I[c]),
              vec(a, sa * I[a], bb, sb * H[bb], c, -I[c]),
            ],
            n,
          );
        }
      }
    }
    // corners
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        for (const sz of [-1, 1]) {
          poly(
            [
              [sx * H[0], sy * I[1], sz * I[2]],
              [sx * I[0], sy * H[1], sz * I[2]],
              [sx * I[0], sy * I[1], sz * H[2]],
            ],
            [sx, sy, sz],
          );
        }
      }
    }
  }
  return { positions, normals, indices, uvs: null };
}

function makeTube(path, radius, tess, uvLen) {
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  let along = 0;
  for (let i = 0; i < path.length; i++) {
    const p = path[i];
    const a = path[Math.max(0, i - 1)];
    const b = path[Math.min(path.length - 1, i + 1)];
    let t = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const tl = Math.hypot(t[0], t[1], t[2]) || 1;
    t = [t[0] / tl, t[1] / tl, t[2] / tl];
    const ref = Math.abs(t[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
    let n1 = [t[1] * ref[2] - t[2] * ref[1], t[2] * ref[0] - t[0] * ref[2], t[0] * ref[1] - t[1] * ref[0]];
    const nl = Math.hypot(n1[0], n1[1], n1[2]) || 1;
    n1 = [n1[0] / nl, n1[1] / nl, n1[2] / nl];
    const n2 = [t[1] * n1[2] - t[2] * n1[1], t[2] * n1[0] - t[0] * n1[2], t[0] * n1[1] - t[1] * n1[0]];
    if (i > 0) {
      const q = path[i - 1];
      along += Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
    }
    for (let k = 0; k <= tess; k++) {
      const ang = (k / tess) * Math.PI * 2;
      const cx = Math.cos(ang);
      const sx = Math.sin(ang);
      const nx = n1[0] * cx + n2[0] * sx;
      const ny = n1[1] * cx + n2[1] * sx;
      const nz = n1[2] * cx + n2[2] * sx;
      positions.push(p[0] + nx * radius, p[1] + ny * radius, p[2] + nz * radius);
      normals.push(nx, ny, nz);
      uvs.push(k / tess, along / uvLen);
    }
  }
  const ring = tess + 1;
  for (let i = 0; i < path.length - 1; i++) {
    for (let k = 0; k < tess; k++) {
      const a = i * ring + k;
      const b = a + ring;
      // winding chosen to face outward (verified against Babylon's convention)
      indices.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  // Ensure outward winding: test first triangle against its normal.
  if (indices.length >= 3) {
    const P = (i) => [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]];
    const [ia, ib, ic] = indices;
    const A = P(ia), B = P(ib), C = P(ic);
    const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2];
    const vx = C[0] - A[0], vy = C[1] - A[1], vz = C[2] - A[2];
    const cr = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
    const n = [normals[ia * 3], normals[ia * 3 + 1], normals[ia * 3 + 2]];
    if (cr[0] * n[0] + cr[1] * n[1] + cr[2] * n[2] > 0) {
      for (let i = 0; i < indices.length; i += 3) {
        const tmp = indices[i + 1];
        indices[i + 1] = indices[i + 2];
        indices[i + 2] = tmp;
      }
    }
  }
  return { positions, normals, uvs, indices };
}

/** Closed Catmull-Rom spline through 2D points, sampled every ~`step` metres. */
export function splineLoop(points, step = 1.5, closed = true) {
  const out = [];
  const n = points.length;
  const get = (i) => (closed ? points[(i + n) % n] : points[Math.max(0, Math.min(n - 1, i))]);
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const p0 = get(i - 1);
    const p1 = get(i);
    const p2 = get(i + 1);
    const p3 = get(i + 2);
    const len = Math.hypot(p2.x - p1.x, p2.z - p1.z);
    const steps = Math.max(2, Math.ceil(len / step));
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push({ x: f(p0.x, p1.x, p2.x, p3.x), z: f(p0.z, p1.z, p2.z, p3.z) });
    }
  }
  if (!closed) out.push({ ...points[n - 1] });
  return out;
}

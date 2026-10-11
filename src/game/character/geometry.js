// Procedural geometry toolkit for the cartoon characters.
//
// Everything is generated as plain arrays ({ p, n, i, c? } = positions,
// normals, indices, optional per-vertex rgb) in a part's local space, then
// appended to a PartBuffer with a bone index, a placement transform and a
// color. The buffer becomes ONE skinned, vertex-colored mesh per character
// (rigid skinning: every vertex follows exactly one bone), so a whole
// character costs a single draw call. Parts can also get an inverted-hull
// cartoon outline baked into the same mesh.

import { Mesh, VertexData, VertexBuffer, Color3 } from "@babylonjs/core";

export const TAU = Math.PI * 2;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export function smoothstep(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

// ---------------------------------------------------------------- colors --

/** "#rrggbb" | Color3 | [r,g,b] -> [r,g,b] (0..1). */
export function rgb(c) {
  if (Array.isArray(c)) return c;
  if (typeof c === "string") {
    const k = Color3.FromHexString(c);
    return [k.r, k.g, k.b];
  }
  return [c.r, c.g, c.b];
}
export function mix(a, b, t) {
  const x = rgb(a);
  const y = rgb(b);
  return [lerp(x[0], y[0], t), lerp(x[1], y[1], t), lerp(x[2], y[2], t)];
}
/** Multiply a color's brightness (f < 1 darker, f > 1 lighter, clamped). */
export function shade(c, f) {
  const x = rgb(c);
  return [clamp(x[0] * f, 0, 1), clamp(x[1] * f, 0, 1), clamp(x[2] * f, 0, 1)];
}

// --------------------------------------------------------------- vectors --

export const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul3 = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export function norm3(a) {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}

/**
 * Orthonormal frame whose "pole" (y) points along `dir`; x is the tangent
 * pointing to the character's right (+X) when possible, z points "up".
 * Used to place decals / patches on surfaces.
 */
export function frameAt(dir, up = [0, 1, 0]) {
  const y = norm3(dir);
  let x = cross3(up, y);
  if (Math.hypot(x[0], x[1], x[2]) < 1e-5) x = cross3([0, 0, 1], y);
  x = norm3(x);
  const z = cross3(y, x);
  return { x, y, z };
}
export const IDENTITY_FRAME = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };

/** Direction in a frame from polar angle th (from the pole) and azimuth ph. */
export function frameDir(f, th, ph) {
  const s = Math.sin(th);
  const a = s * Math.cos(ph);
  const b = Math.cos(th);
  const c = s * Math.sin(ph);
  return [f.x[0] * a + f.y[0] * b + f.z[0] * c, f.x[1] * a + f.y[1] * b + f.z[1] * c, f.x[2] * a + f.y[2] * b + f.z[2] * c];
}

/** Direction from a frame's tangent-plane angular offsets (s along x, t along z). */
export function tangentDir(f, s, t) {
  return norm3([f.y[0] + f.x[0] * s + f.z[0] * t, f.y[1] + f.x[1] * s + f.z[1] * t, f.y[2] + f.x[2] * s + f.z[2] * t]);
}

// -------------------------------------------------- affine transforms -----
// Column-vector convention: p' = M·p + t, M = Ry·Rx·Rz·S, which matches how
// Babylon applies Euler rotations (roll Z, then pitch X, then yaw Y).

/** @returns {{m:number[], t:number[]}} */
export function affine(pos = [0, 0, 0], rot = [0, 0, 0], scl = 1) {
  const s = typeof scl === "number" ? [scl, scl, scl] : scl;
  const [cx, sx] = [Math.cos(rot[0]), Math.sin(rot[0])];
  const [cy, sy] = [Math.cos(rot[1]), Math.sin(rot[1])];
  const [cz, sz] = [Math.cos(rot[2]), Math.sin(rot[2])];
  // R = Ry * Rx * Rz
  const r = [
    cy * cz + sy * sx * sz, -cy * sz + sy * sx * cz, sy * cx,
    cx * sz, cx * cz, -sx,
    -sy * cz + cy * sx * sz, sy * sz + cy * sx * cz, cy * cx,
  ];
  return {
    m: [r[0] * s[0], r[1] * s[1], r[2] * s[2], r[3] * s[0], r[4] * s[1], r[5] * s[2], r[6] * s[0], r[7] * s[1], r[8] * s[2]],
    t: [pos[0], pos[1], pos[2]],
  };
}

/** A ∘ B (B applied first). */
export function compose(A, B) {
  const a = A.m;
  const b = B.m;
  const m = new Array(9);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) m[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
  }
  const t = [
    a[0] * B.t[0] + a[1] * B.t[1] + a[2] * B.t[2] + A.t[0],
    a[3] * B.t[0] + a[4] * B.t[1] + a[5] * B.t[2] + A.t[1],
    a[6] * B.t[0] + a[7] * B.t[1] + a[8] * B.t[2] + A.t[2],
  ];
  return { m, t };
}

/** Babylon Matrix (row-vector convention) -> affine. */
export function fromMatrix(M) {
  const e = M.m;
  return { m: [e[0], e[4], e[8], e[1], e[5], e[9], e[2], e[6], e[10]], t: [e[12], e[13], e[14]] };
}

export function applyPoint(A, p) {
  const m = A.m;
  return [m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + A.t[0], m[3] * p[0] + m[4] * p[1] + m[5] * p[2] + A.t[1], m[6] * p[0] + m[7] * p[1] + m[8] * p[2] + A.t[2]];
}

function normalMatrix(m) {
  // inverse-transpose of a 3x3
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C || 1e-12;
  const D = -(b * i - c * h);
  const E = a * i - c * g;
  const F = -(a * h - b * g);
  const G = b * f - c * e;
  const H = -(a * f - c * d);
  const I = a * e - b * d;
  // inverse = adj^T / det; inverse-transpose = adj / det (cofactor matrix)
  return [A / det, B / det, C / det, D / det, E / det, F / det, G / det, H / det, I / det];
}

// ---------------------------------------------------------- generators ----

function grid(rows, cols, p, n, i, closedCols = false) {
  // rows x cols vertices already pushed; build quads
  const w = cols;
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const a = r * w + c;
      i.push(a, a + w, a + 1, a + 1, a + w, a + w + 1);
    }
    if (closedCols) {
      const a = r * w + cols - 1;
      const b = r * w;
      i.push(a, a + w, b, b, a + w, b + w);
    }
  }
}

const asFn = (v) => (typeof v === "function" ? v : () => v);

/**
 * Star-shaped surface around the local origin: every point is d·(R(d)+offset)
 * for a unit direction d. Parameterized by polar angle θ ∈ [thetaMin, thetaMax]
 * measured from the frame's pole and azimuth φ. Covers full blobs (θ up to π),
 * shells with a hairline edge (thetaMax(φ, d) < π) and conforming decals
 * (frame pole pointing at the decal center, thetaMax = outline radius).
 * @param {{R:(d:number[])=>number, segU?:number, segV?:number, frame?:object,
 *   thetaMin?:number|Function, thetaMax?:number|Function, offset?:number|Function,
 *   rim?:number, colorFn?:Function}} o
 *   thetaMin/thetaMax(φ, equatorDir); offset(d, θ, φ); rim = depth of an inward lip
 *   closing an open edge; colorFn(point, d, θ, φ) -> rgb.
 */
export function star(o) {
  const { R, segU = 24, segV = 16, rim = 0 } = o;
  const f = o.frame ?? IDENTITY_FRAME;
  const tMin = asFn(o.thetaMin ?? 0);
  const tMax = asFn(o.thetaMax ?? Math.PI);
  const off = asFn(o.offset ?? 0);
  const P = (th, ph) => {
    const d = frameDir(f, th, ph);
    return mul3(d, R(d) + off(d, th, ph));
  };
  const p = [];
  const n = [];
  const c = o.colorFn ? [] : null;
  const i = [];
  const h = 1e-3;
  const rows = segV + 1 + (rim > 0 ? 1 : 0);
  for (let v = 0; v <= segV; v++) {
    for (let u = 0; u <= segU; u++) {
      const ph = (u / segU) * TAU;
      const eq = frameDir(f, Math.PI / 2, ph);
      const a = tMin(ph, eq);
      const b = tMax(ph, eq);
      const th = lerp(a, b, v / segV);
      const pt = P(th, ph);
      const ths = clamp(th, 2 * h, Math.PI - 2 * h);
      const A = sub3(P(ths + h, ph), P(ths - h, ph));
      const B = sub3(P(ths, ph + h), P(ths, ph - h));
      let nn = norm3(cross3(A, B));
      const d = frameDir(f, th, ph);
      if (dot3(nn, d) < 0) nn = mul3(nn, -1);
      p.push(pt[0], pt[1], pt[2]);
      n.push(nn[0], nn[1], nn[2]);
      if (c) c.push(...o.colorFn(pt, d, th, ph));
    }
  }
  if (rim > 0) {
    // inward lip along the open edge: gives shells visible thickness
    for (let u = 0; u <= segU; u++) {
      const ph = (u / segU) * TAU;
      const eq = frameDir(f, Math.PI / 2, ph);
      const th = tMax(ph, eq);
      const d = frameDir(f, th, ph);
      const pt = mul3(d, R(d) + off(d, th, ph) - rim);
      const tg = norm3(sub3(P(th + h, ph), P(th - h, ph)));
      p.push(pt[0], pt[1], pt[2]);
      n.push(tg[0], tg[1], tg[2]);
      if (c) c.push(...o.colorFn(pt, d, th, ph));
    }
  }
  grid(rows, segU + 1, p, n, i);
  return { p, n, i, c };
}

/** Radius function of an axis-aligned ellipsoid / superellipsoid (exponents p horizontal, q vertical). */
export function superR(a, b, c, pe = 2, qe = 2) {
  if (pe === 2 && qe === 2) {
    return (d) => 1 / Math.sqrt((d[0] / a) ** 2 + (d[1] / b) ** 2 + (d[2] / c) ** 2);
  }
  return (d) => {
    const hz = (Math.abs(d[0] / a) ** pe + Math.abs(d[2] / c) ** pe) ** (qe / pe);
    return (hz + Math.abs(d[1] / b) ** qe) ** (-1 / qe);
  };
}

/**
 * Radius function from an implicit "inside" test F(x,y,z) <= 1 (solved by
 * bisection along d). Handy for tapered eggs, shoes, etc.
 */
export function implicitR(F, rMax = 1) {
  return (d) => {
    let lo = 0;
    let hi = rMax;
    for (let k = 0; k < 28; k++) {
      const m = (lo + hi) * 0.5;
      if (F(d[0] * m, d[1] * m, d[2] * m) <= 1) lo = m;
      else hi = m;
    }
    return (lo + hi) * 0.5;
  };
}

/** Closed (super)ellipsoid blob. */
export function blob(a, b, c, seg = 16, pe = 2, qe = 2, colorFn) {
  return star({ R: superR(a, b, c, pe, qe), segU: seg * 2, segV: seg, colorFn });
}

/**
 * Surface of revolution around Y. profile: [[y, r], ...] bottom -> top
 * (r = 0 at an end closes it). sx/sz squash the cross-section.
 */
export function lathe({ profile, segs = 16, sx = 1, sz = 1, colorFn }) {
  const p = [];
  const n = [];
  const i = [];
  const c = colorFn ? [] : null;
  const N = profile.length;
  for (let k = 0; k < N; k++) {
    const [y, r] = profile[k];
    const prev = profile[Math.max(0, k - 1)];
    const next = profile[Math.min(N - 1, k + 1)];
    let ny = -(next[1] - prev[1]);
    let nr = next[0] - prev[0];
    if (r < 1e-6 && (k === 0 || k === N - 1)) {
      nr = 0;
      ny = k === 0 ? -1 : 1;
    }
    const l = Math.hypot(nr, ny) || 1;
    nr /= l;
    ny /= l;
    for (let u = 0; u <= segs; u++) {
      const a = (u / segs) * TAU;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const pt = [r * ca * sx, y, r * sa * sz];
      p.push(pt[0], pt[1], pt[2]);
      const nn = norm3([(nr * ca) / sx, ny, (nr * sa) / sz]);
      n.push(nn[0], nn[1], nn[2]);
      if (c) c.push(...colorFn(pt, k, u / segs));
    }
  }
  grid(N, segs + 1, p, n, i);
  return { p, n, i, c };
}

/**
 * Tapered capsule along Y between sphere centers y0 (radius r0, bottom) and
 * y1 (radius r1, top).
 */
export function capsule({ y0, y1, r0, r1 = r0, segs = 16, rings = 5, sx = 1, sz = 1, colorFn }) {
  const prof = [];
  for (let k = 0; k <= rings; k++) {
    const a = -Math.PI / 2 + (Math.PI / 2) * (k / rings);
    prof.push([y0 + r0 * Math.sin(a), r0 * Math.cos(a)]);
  }
  for (let k = 0; k <= rings; k++) {
    const a = (Math.PI / 2) * (k / rings);
    prof.push([y1 + r1 * Math.sin(a), r1 * Math.cos(a)]);
  }
  prof[0][1] = 0;
  prof[prof.length - 1][1] = 0;
  return lathe({ profile: prof, segs, sx, sz, colorFn });
}

/** Catmull-Rom resample of a control polyline. */
export function spline(points, samples = 16, closed = false) {
  const out = [];
  const N = points.length;
  const get = (k) => (closed ? points[(k + N) % N] : points[clamp(k, 0, N - 1)]);
  const segCount = closed ? N : N - 1;
  for (let s = 0; s < samples; s++) {
    const t = closed ? (s / samples) * segCount : (s / (samples - 1)) * segCount;
    const k = Math.min(Math.floor(t), segCount - 1);
    const f = t - k;
    const p0 = get(k - 1);
    const p1 = get(k);
    const p2 = get(k + 1);
    const p3 = get(k + 2);
    const f2 = f * f;
    const f3 = f2 * f;
    const pt = [0, 0, 0];
    for (let j = 0; j < 3; j++) {
      pt[j] = 0.5 * (2 * p1[j] + (-p0[j] + p2[j]) * f + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * f2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * f3);
    }
    out.push(pt);
  }
  return out;
}

/**
 * Tube along a path. radius: number | (t, k) => r (t in 0..1). flat < 1
 * squashes the cross-section along the binormal (ribbons, brims, straps).
 * Tapering the radius to 0 closes an end; `caps` adds flat end caps.
 */
export function tube({ path, radius = 0.01, segs = 8, closed = false, flat = 1, up = [0, 1, 0], caps = false, colorFn }) {
  const N = path.length;
  const rf = asFn(radius);
  const p = [];
  const n = [];
  const i = [];
  const c = colorFn ? [] : null;
  const T = [];
  for (let k = 0; k < N; k++) {
    const a = closed ? path[(k - 1 + N) % N] : path[Math.max(0, k - 1)];
    const b = closed ? path[(k + 1) % N] : path[Math.min(N - 1, k + 1)];
    T.push(norm3(sub3(b, a)));
  }
  let Nv = sub3(up, mul3(T[0], dot3(up, T[0])));
  if (Math.hypot(...Nv) < 1e-4) Nv = sub3([1, 0, 0], mul3(T[0], T[0][0]));
  Nv = norm3(Nv);
  const radii = [];
  for (let k = 0; k < N; k++) radii.push(rf(closed ? k / N : k / (N - 1), k));
  for (let k = 0; k < N; k++) {
    if (k > 0) Nv = norm3(sub3(Nv, mul3(T[k], dot3(Nv, T[k]))));
    const B = cross3(T[k], Nv);
    const r = radii[k];
    const kp = closed ? (k - 1 + N) % N : Math.max(0, k - 1);
    const kn = closed ? (k + 1) % N : Math.min(N - 1, k + 1);
    const ds = Math.hypot(...sub3(path[kn], path[kp])) || 1;
    const slope = (radii[kn] - radii[kp]) / ds;
    for (let s = 0; s <= segs; s++) {
      const a = (s / segs) * TAU;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const off = add3(mul3(Nv, ca * r), mul3(B, sa * r * flat));
      const pt = add3(path[k], off);
      let nn = norm3(add3(mul3(Nv, ca), mul3(B, sa / flat)));
      nn = norm3(sub3(nn, mul3(T[k], slope)));
      p.push(pt[0], pt[1], pt[2]);
      n.push(nn[0], nn[1], nn[2]);
      if (c) c.push(...colorFn(pt, closed ? k / N : k / (N - 1), s / segs));
    }
  }
  const w = segs + 1;
  grid(N, w, p, n, i);
  if (closed) {
    const a0 = (N - 1) * w;
    for (let s = 0; s < segs; s++) i.push(a0 + s, s, a0 + s + 1, a0 + s + 1, s, s + 1);
  }
  if (caps && !closed) {
    for (const [k, sign] of [
      [0, -1],
      [N - 1, 1],
    ]) {
      const center = p.length / 3;
      const tn = mul3(T[k], sign);
      p.push(...path[k]);
      n.push(...tn);
      if (c) c.push(...c.slice(k * w * 3, k * w * 3 + 3));
      const start = p.length / 3;
      for (let s = 0; s <= segs; s++) {
        const src = (k * w + s) * 3;
        p.push(p[src], p[src + 1], p[src + 2]);
        n.push(...tn);
        if (c) c.push(c[src], c[src + 1], c[src + 2]);
      }
      for (let s = 0; s < segs; s++) i.push(center, start + s, start + s + 1);
    }
  }
  return { p, n, i, c };
}

/** Closed ring (torus-like tube) along an ellipse in the XZ plane at height y. */
export function ring({ rx, rz = rx, y = 0, radius = 0.01, segs = 8, samples = 32, flat = 1, colorFn }) {
  const path = [];
  for (let k = 0; k < samples; k++) {
    const a = (k / samples) * TAU;
    path.push([Math.cos(a) * rx, y, Math.sin(a) * rz]);
  }
  return tube({ path, radius, segs, closed: true, flat, up: [0, 1, 0], colorFn });
}

// ------------------------------------------------------------ buffer ------

/**
 * Accumulates parts into one vertex-colored, rigidly skinned mesh.
 */
export class PartBuffer {
  constructor() {
    this.p = [];
    this.n = [];
    this.c = [];
    this.i = [];
    this.b = [];
  }

  get vertexCount() {
    return this.p.length / 3;
  }

  /**
   * @param {{p:number[], n:number[], i:number[], c?:number[]}} g  geometry in part space
   * @param {{bone:number, bind:{m:number[],t:number[]}, place?:object, color?:any,
   *   outline?:number, outlineColor?:any}} o
   *   bind: bone rest transform (bone space -> mesh space); place: part -> bone space.
   */
  add(g, o) {
    const A = o.place ? compose(o.bind, o.place) : o.bind;
    const NM = normalMatrix(A.m);
    const base = this.vertexCount;
    const col = o.color != null ? rgb(o.color) : [1, 1, 1];
    const count = g.p.length / 3;
    const P = [];
    const Nn = [];
    for (let k = 0; k < count; k++) {
      const x = g.p[3 * k];
      const y = g.p[3 * k + 1];
      const z = g.p[3 * k + 2];
      const m = A.m;
      P.push(m[0] * x + m[1] * y + m[2] * z + A.t[0], m[3] * x + m[4] * y + m[5] * z + A.t[1], m[6] * x + m[7] * y + m[8] * z + A.t[2]);
      const nx = g.n[3 * k];
      const ny = g.n[3 * k + 1];
      const nz = g.n[3 * k + 2];
      const q = norm3([NM[0] * nx + NM[1] * ny + NM[2] * nz, NM[3] * nx + NM[4] * ny + NM[5] * nz, NM[6] * nx + NM[7] * ny + NM[8] * nz]);
      Nn.push(q[0], q[1], q[2]);
    }
    // Fix triangle winding so front faces agree with the normals (Babylon:
    // front when (p1-p2)x(p3-p2) points along the normal). Mirrored placements
    // and generator quirks are handled here once.
    const tris = [];
    for (let t = 0; t < g.i.length; t += 3) {
      let a = g.i[t];
      let b = g.i[t + 1];
      let cc = g.i[t + 2];
      const ax = P[3 * a], ay = P[3 * a + 1], az = P[3 * a + 2];
      const bx = P[3 * b], by = P[3 * b + 1], bz = P[3 * b + 2];
      const cx = P[3 * cc], cy = P[3 * cc + 1], cz = P[3 * cc + 2];
      const ux = ax - bx, uy = ay - by, uz = az - bz;
      const vx = cx - bx, vy = cy - by, vz = cz - bz;
      const fx = uy * vz - uz * vy;
      const fy = uz * vx - ux * vz;
      const fz = ux * vy - uy * vx;
      const area = Math.hypot(fx, fy, fz);
      if (area < 1e-12) continue; // degenerate (poles): drop
      const sx = Nn[3 * a] + Nn[3 * b] + Nn[3 * cc];
      const sy = Nn[3 * a + 1] + Nn[3 * b + 1] + Nn[3 * cc + 1];
      const sz = Nn[3 * a + 2] + Nn[3 * b + 2] + Nn[3 * cc + 2];
      if (fx * sx + fy * sy + fz * sz < 0) {
        const tmp = b;
        b = cc;
        cc = tmp;
      }
      tris.push(a, b, cc);
    }
    for (let k = 0; k < count; k++) {
      this.p.push(P[3 * k], P[3 * k + 1], P[3 * k + 2]);
      this.n.push(Nn[3 * k], Nn[3 * k + 1], Nn[3 * k + 2]);
      if (g.c) this.c.push(g.c[3 * k], g.c[3 * k + 1], g.c[3 * k + 2], 1);
      else this.c.push(col[0], col[1], col[2], 1);
      this.b.push(o.bone);
    }
    for (const t of tris) this.i.push(base + t);

    // Inverted hull outline: the surface pushed out along its normals with
    // flipped winding, so only the rim behind the silhouette shows.
    const w = o.outline || 0;
    if (w > 0) {
      const oc = rgb(o.outlineColor ?? "#1d2b3a");
      const hb = this.vertexCount;
      for (let k = 0; k < count; k++) {
        this.p.push(P[3 * k] + Nn[3 * k] * w, P[3 * k + 1] + Nn[3 * k + 1] * w, P[3 * k + 2] + Nn[3 * k + 2] * w);
        this.n.push(-Nn[3 * k], -Nn[3 * k + 1], -Nn[3 * k + 2]);
        this.c.push(oc[0], oc[1], oc[2], 1);
        this.b.push(o.bone);
      }
      for (let t = 0; t < tris.length; t += 3) this.i.push(hb + tris[t], hb + tris[t + 2], hb + tris[t + 1]);
    }
  }

  /** Build the skinned mesh. */
  toMesh(name, scene, material) {
    const mesh = new Mesh(name, scene);
    const vd = new VertexData();
    vd.positions = new Float32Array(this.p);
    vd.normals = new Float32Array(this.n);
    vd.indices = this.vertexCount > 65535 ? new Uint32Array(this.i) : new Uint16Array(this.i);
    vd.colors = new Float32Array(this.c);
    vd.applyToMesh(mesh, false);
    const count = this.vertexCount;
    const mi = new Float32Array(count * 4);
    const mw = new Float32Array(count * 4);
    for (let k = 0; k < count; k++) {
      mi[k * 4] = this.b[k];
      mw[k * 4] = 1;
    }
    mesh.setVerticesData(VertexBuffer.MatricesIndicesKind, mi, false, 4);
    mesh.setVerticesData(VertexBuffer.MatricesWeightsKind, mw, false, 4);
    mesh.material = material;
    mesh.isPickable = false;
    return mesh;
  }
}

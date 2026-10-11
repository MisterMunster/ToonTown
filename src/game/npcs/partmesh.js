// Tiny CPU "rigid skinning" for swarms of little low-poly animals (birds,
// butterflies). A template mesh is built from parts (body, left wing, ...).
// N copies of the template live in ONE mesh (one draw call); every frame the
// caller fills one affine 3x4 matrix per (instance, part) and
// `PartMesh.update()` rewrites the vertex positions and normals. A few
// thousand vertices in total: cheap.

import { Mesh, VertexData, VertexBuffer, Color3 } from "@babylonjs/core";

const rgbCache = new Map();
/** "#rrggbb" or [r, g, b] (0..1) -> [r, g, b]. */
function rgb(c) {
  if (Array.isArray(c)) return c;
  let v = rgbCache.get(c);
  if (!v) {
    const k = Color3.FromHexString(c);
    v = [k.r, k.g, k.b];
    rgbCache.set(c, v);
  }
  return v;
}

/** Collects indexed triangles with normals, vertex colours and part ids. */
export class PartBuilder {
  constructor() {
    this.pos = [];
    this.nrm = [];
    this.col = [];
    this.part = [];
    this.idx = [];
  }

  /** Add a vertex; returns its index. */
  vert(p, n, color, part) {
    const c = rgb(color);
    this.pos.push(p[0], p[1], p[2]);
    this.nrm.push(n[0], n[1], n[2]);
    this.col.push(c[0], c[1], c[2], 1);
    this.part.push(part);
    return this.part.length - 1;
  }

  /**
   * Add a face over existing vertices, wound so its geometric normal agrees
   * with the vertex normals (Babylon: n = (p1 - p2) x (p3 - p2)).
   */
  face(a, b, c) {
    const P = this.pos;
    const ux = P[a * 3] - P[b * 3];
    const uy = P[a * 3 + 1] - P[b * 3 + 1];
    const uz = P[a * 3 + 2] - P[b * 3 + 2];
    const vx = P[c * 3] - P[b * 3];
    const vy = P[c * 3 + 1] - P[b * 3 + 1];
    const vz = P[c * 3 + 2] - P[b * 3 + 2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    if (Math.abs(nx) + Math.abs(ny) + Math.abs(nz) < 1e-12) return; // degenerate (poles)
    const N = this.nrm;
    const d = nx * (N[a * 3] + N[b * 3] + N[c * 3]) + ny * (N[a * 3 + 1] + N[b * 3 + 1] + N[c * 3 + 1]) + nz * (N[a * 3 + 2] + N[b * 3 + 2] + N[c * 3 + 2]);
    if (d < 0) this.idx.push(a, c, b);
    else this.idx.push(a, b, c);
  }

  /**
   * Flat-shaded triangle. With `outFrom` ([x,y,z]) the face points away from
   * that point; otherwise it faces the side its winding gives (n = (a-b)x(c-b)).
   * `color`: one colour or an array of three (per vertex).
   */
  tri(a, b, c, color, part, outFrom = null) {
    const ux = a[0] - b[0];
    const uy = a[1] - b[1];
    const uz = a[2] - b[2];
    const vx = c[0] - b[0];
    const vy = c[1] - b[1];
    const vz = c[2] - b[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    if (outFrom) {
      const cx = (a[0] + b[0] + c[0]) / 3 - outFrom[0];
      const cy = (a[1] + b[1] + c[1]) / 3 - outFrom[1];
      const cz = (a[2] + b[2] + c[2]) / 3 - outFrom[2];
      if (nx * cx + ny * cy + nz * cz < 0) {
        nx = -nx;
        ny = -ny;
        nz = -nz;
      }
    }
    const l = Math.hypot(nx, ny, nz) || 1;
    const n = [nx / l, ny / l, nz / l];
    const cols = Array.isArray(color) && typeof color[0] !== "number" ? color : [color, color, color];
    const i0 = this.vert(a, n, cols[0], part);
    const i1 = this.vert(b, n, cols[1], part);
    const i2 = this.vert(c, n, cols[2], part);
    this.face(i0, i1, i2);
  }

  /** Thin double-sided triangle (one face per side), optional colour per side. */
  tri2(a, b, c, colorFront, part, colorBack = colorFront) {
    const ux = a[0] - b[0];
    const uy = a[1] - b[1];
    const uz = a[2] - b[2];
    const vx = c[0] - b[0];
    const vy = c[1] - b[1];
    const vz = c[2] - b[2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const m = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
    this.tri(a, b, c, colorFront, part, [m[0] - nx, m[1] - ny, m[2] - nz]);
    this.tri(a, b, c, colorBack, part, [m[0] + nx, m[1] + ny, m[2] + nz]);
  }

  /**
   * Flat polygon (both sides) with a coloured rim: an inner fan (centre colour
   * -> fill colour) and an outer band in the rim colour. points[0] is the
   * fan centre, the rest the outline in order. `up` picks which side gets
   * colours.top ([x,y,z] direction).
   */
  wing(points, colors, part, up = [0, 1, 0], inset = 0.7) {
    const c = points[0];
    const outline = points.slice(1);
    const inner = outline.map((p) => [c[0] + (p[0] - c[0]) * inset, c[1] + (p[1] - c[1]) * inset, c[2] + (p[2] - c[2]) * inset]);
    const n = outline.length;
    for (const side of [1, -1]) {
      const nrm = [up[0] * side, up[1] * side, up[2] * side];
      const tint = side > 0 ? colors.top ?? colors : colors.bottom ?? colors.top ?? colors;
      const ci = this.vert(c, nrm, tint.centre, part);
      const ins = inner.map((p) => this.vert(p, nrm, tint.fill, part));
      const rimIn = inner.map((p) => this.vert(p, nrm, tint.rim, part));
      const rimOut = outline.map((p) => this.vert(p, nrm, tint.rim, part));
      for (let i = 0; i < n - 1; i++) {
        this.face(ci, ins[i], ins[i + 1]);
        this.face(rimIn[i], rimOut[i], rimOut[i + 1]);
        this.face(rimIn[i], rimOut[i + 1], rimIn[i + 1]);
      }
    }
  }

  /**
   * Smooth low-poly ellipsoid. `color` is a colour or a function
   * (unit direction [x,y,z]) => colour, for bellies, masks etc.
   */
  ellipsoid(c, r, color, part, seg = 8, rings = 5) {
    const base = this.part.length;
    for (let i = 0; i <= rings; i++) {
      const th = (i / rings) * Math.PI;
      for (let j = 0; j <= seg; j++) {
        const ph = (j / seg) * Math.PI * 2;
        const d = [Math.sin(th) * Math.sin(ph), Math.cos(th), Math.sin(th) * Math.cos(ph)];
        const p = [c[0] + d[0] * r[0], c[1] + d[1] * r[1], c[2] + d[2] * r[2]];
        let nx = d[0] / r[0];
        let ny = d[1] / r[1];
        let nz = d[2] / r[2];
        const l = Math.hypot(nx, ny, nz) || 1;
        nx /= l;
        ny /= l;
        nz /= l;
        this.vert(p, [nx, ny, nz], typeof color === "function" ? color(d) : color, part);
      }
    }
    for (let i = 0; i < rings; i++) {
      for (let j = 0; j < seg; j++) {
        const a = base + i * (seg + 1) + j;
        const b = a + 1;
        const d = a + seg + 1;
        const e = d + 1;
        this.face(a, d, b);
        this.face(b, d, e);
      }
    }
  }

  get vertexCount() {
    return this.part.length;
  }
}

/** One mesh holding `count` copies of a template, animated per part on the CPU. */
export class PartMesh {
  /**
   * @param {import("@babylonjs/core").Scene} scene
   * @param {string} name
   * @param {PartBuilder} tpl
   * @param {number} count
   * @param {import("@babylonjs/core").Material} material
   * @param {number} partCount
   * @param {(i:number, r:number, g:number, b:number, part:number, out:number[]) => void} [tint]
   *   optional per-instance colour tweak; writes [r, g, b] into out
   */
  constructor(scene, name, tpl, count, material, partCount, tint) {
    this.count = count;
    this.partCount = partCount;
    this.nv = tpl.vertexCount;
    this.tplPos = Float32Array.from(tpl.pos);
    this.tplNrm = Float32Array.from(tpl.nrm);
    this.tplPart = Uint8Array.from(tpl.part);
    const total = this.nv * count;
    this.positions = new Float32Array(total * 3);
    this.normals = new Float32Array(total * 3);
    const colors = new Float32Array(total * 4);
    const ni = tpl.idx.length;
    const indices = new Uint32Array(ni * count);
    const tmp = [0, 0, 0];
    for (let i = 0; i < count; i++) {
      for (let v = 0; v < this.nv; v++) {
        const o = (i * this.nv + v) * 4;
        tmp[0] = tpl.col[v * 4];
        tmp[1] = tpl.col[v * 4 + 1];
        tmp[2] = tpl.col[v * 4 + 2];
        if (tint) tint(i, tmp[0], tmp[1], tmp[2], tpl.part[v], tmp);
        colors[o] = tmp[0];
        colors[o + 1] = tmp[1];
        colors[o + 2] = tmp[2];
        colors[o + 3] = 1;
      }
      for (let k = 0; k < ni; k++) indices[i * ni + k] = tpl.idx[k] + i * this.nv;
    }
    /** Affine matrices, 12 floats each (row-major 3x4), per instance per part. */
    this.mats = new Float32Array(count * partCount * 12);
    for (let k = 0; k < count * partCount; k++) setIdentity(this.mats, k * 12);
    this.apply();

    const mesh = new Mesh(name, scene);
    const vd = new VertexData();
    vd.positions = this.positions;
    vd.normals = this.normals;
    vd.colors = colors;
    vd.indices = indices;
    vd.applyToMesh(mesh, true);
    mesh.material = material;
    mesh.isPickable = false;
    mesh.receiveShadows = true;
    // vertices move anywhere in the world every frame: never cull by the stale box
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.doNotSyncBoundingInfo = true;
    this.mesh = mesh;
  }

  /** Offset of the matrix for (instance, part) in `mats`. */
  at(i, part) {
    return (i * this.partCount + part) * 12;
  }

  /** Transform the template into the vertex buffers (CPU side only). */
  apply() {
    const { tplPos, tplNrm, tplPart, positions, normals, mats, nv, partCount } = this;
    for (let i = 0; i < this.count; i++) {
      const base = i * partCount * 12;
      let o = i * nv * 3;
      for (let v = 0; v < nv; v++, o += 3) {
        const m = base + tplPart[v] * 12;
        const x = tplPos[v * 3];
        const y = tplPos[v * 3 + 1];
        const z = tplPos[v * 3 + 2];
        positions[o] = mats[m] * x + mats[m + 1] * y + mats[m + 2] * z + mats[m + 3];
        positions[o + 1] = mats[m + 4] * x + mats[m + 5] * y + mats[m + 6] * z + mats[m + 7];
        positions[o + 2] = mats[m + 8] * x + mats[m + 9] * y + mats[m + 10] * z + mats[m + 11];
        const a = tplNrm[v * 3];
        const b = tplNrm[v * 3 + 1];
        const c = tplNrm[v * 3 + 2];
        normals[o] = mats[m] * a + mats[m + 1] * b + mats[m + 2] * c;
        normals[o + 1] = mats[m + 4] * a + mats[m + 5] * b + mats[m + 6] * c;
        normals[o + 2] = mats[m + 8] * a + mats[m + 9] * b + mats[m + 10] * c;
      }
    }
  }

  /** Recompute vertices from `mats` and upload them. */
  update() {
    this.apply();
    this.mesh.updateVerticesData(VertexBuffer.PositionKind, this.positions, false, false);
    this.mesh.updateVerticesData(VertexBuffer.NormalKind, this.normals, false, false);
  }
}

// ---- affine 3x4 helpers (row-major: [r00 r01 r02 tx, r10 r11 r12 ty, r20 r21 r22 tz]) ----

export function setIdentity(m, o) {
  m[o] = 1; m[o + 1] = 0; m[o + 2] = 0; m[o + 3] = 0;
  m[o + 4] = 0; m[o + 5] = 1; m[o + 6] = 0; m[o + 7] = 0;
  m[o + 8] = 0; m[o + 9] = 0; m[o + 10] = 1; m[o + 11] = 0;
}

/**
 * Body transform: uniform scale s, then roll (about local Z, + = right side
 * down), pitch (+ = nose up), yaw (heading, Babylon convention: forward =
 * (sin, 0, cos)), then translate to (x, y, z).
 */
export function setBody(m, o, x, y, z, yaw, pitch, roll, s = 1) {
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const cr = Math.cos(roll);
  const sr = Math.sin(roll);
  // R = Ry * Rp * Rr where
  //   Rr: x' = x cr + y sr, y' = -x sr + y cr
  //   Rp: y' = y cp + z sp, z' = -y sp + z cp
  //   Ry: x' = x cy + z sy, z' = -x sy + z cy
  // columns of R are the images of the local axes.
  // local X -> Rr: (cr, -sr, 0) -> Rp: (cr, -sr cp, sr sp) -> Ry
  const x0 = cr;
  const y0 = -sr * cp;
  const z0 = sr * sp;
  // local Y -> Rr: (sr, cr, 0) -> Rp: (sr, cr cp, -cr sp)
  const x1 = sr;
  const y1 = cr * cp;
  const z1 = -cr * sp;
  // local Z -> Rp: (0, sp, cp)
  const x2 = 0;
  const y2 = sp;
  const z2 = cp;
  m[o] = (x0 * cy + z0 * sy) * s;
  m[o + 4] = y0 * s;
  m[o + 8] = (-x0 * sy + z0 * cy) * s;
  m[o + 1] = (x1 * cy + z1 * sy) * s;
  m[o + 5] = y1 * s;
  m[o + 9] = (-x1 * sy + z1 * cy) * s;
  m[o + 2] = (x2 * cy + z2 * sy) * s;
  m[o + 6] = y2 * s;
  m[o + 10] = (-x2 * sy + z2 * cy) * s;
  m[o + 3] = x;
  m[o + 7] = y;
  m[o + 11] = z;
}

/**
 * out = parent * hinge, where hinge rotates by `angle` about an axis through
 * the local pivot (px, py, pz). axis: 0 = X, 1 = Y (yaw, Babylon convention),
 * 2 = Z. For Z: x' = x c - y s, y' = x s + y c. For X: y' = y c - z s,
 * z' = y s + z c. For Y: x' = x c + z s, z' = -x s + z c.
 */
export function setHinge(m, out, parent, px, py, pz, angle, axis = 2) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  // hinge as a 3x4: R (about pivot) => t = p - R p
  let h00 = 1, h01 = 0, h02 = 0, h10 = 0, h11 = 1, h12 = 0, h20 = 0, h21 = 0, h22 = 1;
  if (axis === 2) {
    h00 = c; h01 = -s; h10 = s; h11 = c;
  } else if (axis === 1) {
    h00 = c; h02 = s; h20 = -s; h22 = c;
  } else {
    h11 = c; h12 = -s; h21 = s; h22 = c;
  }
  const tx = px - (h00 * px + h01 * py + h02 * pz);
  const ty = py - (h10 * px + h11 * py + h12 * pz);
  const tz = pz - (h20 * px + h21 * py + h22 * pz);
  for (let r = 0; r < 3; r++) {
    const a0 = m[parent + r * 4];
    const a1 = m[parent + r * 4 + 1];
    const a2 = m[parent + r * 4 + 2];
    const a3 = m[parent + r * 4 + 3];
    m[out + r * 4] = a0 * h00 + a1 * h10 + a2 * h20;
    m[out + r * 4 + 1] = a0 * h01 + a1 * h11 + a2 * h21;
    m[out + r * 4 + 2] = a0 * h02 + a1 * h12 + a2 * h22;
    m[out + r * 4 + 3] = a0 * tx + a1 * ty + a2 * tz + a3;
  }
}

// Lightweight static collision world: axis-aligned boxes + vertical cylinders,
// stored in a uniform spatial hash on the XZ plane. The town registers its
// solid things here; the player, camera and NPCs query it. Ground (y = 0) is
// implicit everywhere. Everything is in world units (1 unit = 1 meter).
//
// Collider shapes (plain objects, treat as read-only):
//   { type: "box", minX, minY, minZ, maxX, maxY, maxZ, tag }
//   { type: "cyl", x, z, radius, minY, maxY, tag,
//     minX, minZ, maxX, maxZ }            // XZ bounds precomputed for broadphase
//
// Tags are free-form strings; conventions: "building", "prop", "tree",
// "platform" (meant to be jumped on), "water", "bounds".

export class ColliderWorld {
  constructor(cellSize = 8) {
    this.cellSize = cellSize;
    this.cells = new Map();
    this.list = [];
    this._stamp = 0;
  }

  _cellRange(minX, minZ, maxX, maxZ) {
    const s = this.cellSize;
    return [Math.floor(minX / s), Math.floor(minZ / s), Math.floor(maxX / s), Math.floor(maxZ / s)];
  }

  _insert(c) {
    c._stamp = 0;
    this.list.push(c);
    const [x0, z0, x1, z1] = this._cellRange(c.minX, c.minZ, c.maxX, c.maxZ);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const key = `${ix},${iz}`;
        let cell = this.cells.get(key);
        if (!cell) this.cells.set(key, (cell = []));
        cell.push(c);
      }
    }
    return c;
  }

  /** Add an axis-aligned box by its min/max corners. */
  addBox(minX, minY, minZ, maxX, maxY, maxZ, tag = "solid") {
    return this._insert({
      type: "box",
      minX: Math.min(minX, maxX),
      minY: Math.min(minY, maxY),
      minZ: Math.min(minZ, maxZ),
      maxX: Math.max(minX, maxX),
      maxY: Math.max(minY, maxY),
      maxZ: Math.max(minZ, maxZ),
      tag,
    });
  }

  /**
   * Add a box from its footprint center (cx, cz), bottom height baseY and size.
   * If rotationY (radians) is non-zero the conservative AABB of the rotated
   * footprint is stored.
   */
  addBoxCentered(cx, baseY, cz, width, height, depth, rotationY = 0, tag = "solid") {
    let hx = width / 2;
    let hz = depth / 2;
    if (rotationY) {
      const c = Math.abs(Math.cos(rotationY));
      const s = Math.abs(Math.sin(rotationY));
      const nx = hx * c + hz * s;
      const nz = hx * s + hz * c;
      hx = nx;
      hz = nz;
    }
    return this.addBox(cx - hx, baseY, cz - hz, cx + hx, baseY + height, cz + hz, tag);
  }

  /** Add a vertical cylinder (tree trunk, lamp post, fountain basin...). */
  addCylinder(x, z, radius, minY, maxY, tag = "solid") {
    return this._insert({
      type: "cyl",
      x,
      z,
      radius,
      minY,
      maxY,
      tag,
      minX: x - radius,
      minZ: z - radius,
      maxX: x + radius,
      maxZ: z + radius,
    });
  }

  /** All colliders whose XZ bounds overlap the given rectangle (deduplicated). */
  queryXZ(minX, minZ, maxX, maxZ, out = []) {
    out.length = 0;
    const stamp = ++this._stamp;
    const [x0, z0, x1, z1] = this._cellRange(minX, minZ, maxX, maxZ);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const cell = this.cells.get(`${ix},${iz}`);
        if (!cell) continue;
        for (const c of cell) {
          if (c._stamp === stamp) continue;
          c._stamp = stamp;
          if (c.maxX < minX || c.minX > maxX || c.maxZ < minZ || c.minZ > maxZ) continue;
          out.push(c);
        }
      }
    }
    return out;
  }

  /** True if a disc at (x, z) with this radius overlaps the collider in XZ. */
  static overlapsDiscXZ(c, x, z, radius) {
    if (c.type === "cyl") {
      const dx = x - c.x;
      const dz = z - c.z;
      const r = radius + c.radius;
      return dx * dx + dz * dz < r * r;
    }
    const px = Math.max(c.minX, Math.min(x, c.maxX));
    const pz = Math.max(c.minZ, Math.min(z, c.maxZ));
    const dx = x - px;
    const dz = z - pz;
    return dx * dx + dz * dz < radius * radius;
  }

  /**
   * Highest walkable surface under a disc at (x, z): the max top (maxY) of
   * colliders overlapping the disc whose top is <= maxTop. Returns 0 (ground)
   * if nothing qualifies.
   */
  groundHeightAt(x, z, radius = 0.3, maxTop = Infinity) {
    let best = 0;
    const hits = this.queryXZ(x - radius, z - radius, x + radius, z + radius, this._tmp || (this._tmp = []));
    for (const c of hits) {
      if (c.maxY > maxTop || c.maxY <= best) continue;
      if (ColliderWorld.overlapsDiscXZ(c, x, z, radius)) best = c.maxY;
    }
    return best;
  }

  /**
   * Segment cast from A to B against all colliders (boxes exactly, cylinders
   * as their bounding square). `pad` inflates every collider. Returns the
   * fraction t in [0, 1] of the first hit, or 1 if the path is clear.
   * Useful for camera collision.
   */
  segmentHit(ax, ay, az, bx, by, bz, pad = 0) {
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const hits = this.queryXZ(
      Math.min(ax, bx) - pad,
      Math.min(az, bz) - pad,
      Math.max(ax, bx) + pad,
      Math.max(az, bz) + pad,
      this._tmpSeg || (this._tmpSeg = []),
    );
    let best = 1;
    for (const c of hits) {
      let tmin = 0;
      let tmax = 1;
      const slabs = [
        [ax, dx, c.minX - pad, c.maxX + pad],
        [ay, dy, c.minY - pad, c.maxY + pad],
        [az, dz, c.minZ - pad, c.maxZ + pad],
      ];
      let miss = false;
      for (const [o, d, lo, hi] of slabs) {
        if (Math.abs(d) < 1e-9) {
          if (o < lo || o > hi) {
            miss = true;
            break;
          }
        } else {
          let t1 = (lo - o) / d;
          let t2 = (hi - o) / d;
          if (t1 > t2) [t1, t2] = [t2, t1];
          if (t1 > tmin) tmin = t1;
          if (t2 < tmax) tmax = t2;
          if (tmin > tmax) {
            miss = true;
            break;
          }
        }
      }
      if (!miss && tmin < best) best = tmin;
    }
    return best;
  }
}

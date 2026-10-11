// Shared "don't walk through walls" helper for the town's walkers.

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/**
 * Push a walker ({ x, y, z }, feet position) out of solid static colliders
 * that overlap a disc of `radius`: anything taller than `stepUp` above the
 * feet (buildings, props, tree trunks) and water. Mutates a.x / a.z.
 * @param {import("../colliders.js").ColliderWorld} colliders
 * @param {{x:number, y:number, z:number}} a
 * @param {number} radius
 * @param {number} stepUp
 * @param {any[]} hits  scratch array (reused, no allocation)
 */
export function pushOutOfStatic(colliders, a, radius, stepUp, hits) {
  if (!colliders?.queryXZ) return;
  const R = radius;
  colliders.queryXZ(a.x - R, a.z - R, a.x + R, a.z + R, hits);
  for (let h = 0; h < hits.length; h++) {
    const c = hits[h];
    if (c.tag !== "water" && (c.maxY <= a.y + stepUp || c.minY > a.y + 1.7)) continue;
    if (c.type === "cyl") {
      let dx = a.x - c.x;
      let dz = a.z - c.z;
      let d = Math.hypot(dx, dz);
      const rr = R + c.radius;
      if (d >= rr) continue;
      if (d < 1e-5) {
        dx = 1;
        dz = 0;
        d = 1;
      }
      a.x = c.x + (dx / d) * rr;
      a.z = c.z + (dz / d) * rr;
    } else {
      const px = clamp(a.x, c.minX, c.maxX);
      const pz = clamp(a.z, c.minZ, c.maxZ);
      const dx = a.x - px;
      const dz = a.z - pz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= R * R) continue;
      if (d2 > 1e-10) {
        const d = Math.sqrt(d2);
        a.x = px + (dx / d) * R;
        a.z = pz + (dz / d) * R;
      } else {
        // centre inside the box: leave through the nearest face
        const l = a.x - c.minX;
        const r = c.maxX - a.x;
        const b = a.z - c.minZ;
        const t = c.maxZ - a.z;
        const m = Math.min(l, r, b, t);
        if (m === l) a.x = c.minX - R;
        else if (m === r) a.x = c.maxX + R;
        else if (m === b) a.z = c.minZ - R;
        else a.z = c.maxZ + R;
      }
    }
  }
}

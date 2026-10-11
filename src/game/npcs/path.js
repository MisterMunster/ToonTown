// Closed polyline parameterised by arc length, for NPCs walking their loops.
// All queries write into caller-provided objects (no per-frame allocation).

export class LoopPath {
  /** @param {Array<{x:number, z:number}>} points closed loop (last point connects to the first) */
  constructor(points) {
    const pts = [];
    for (const p of points ?? []) {
      if (!Number.isFinite(p?.x) || !Number.isFinite(p?.z)) continue;
      const q = pts[pts.length - 1];
      if (q && Math.hypot(p.x - q.x, p.z - q.z) < 0.05) continue;
      pts.push({ x: p.x, z: p.z });
    }
    if (pts.length > 2 && Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].z - pts[pts.length - 1].z) < 0.05) pts.pop();
    const n = pts.length;
    this.n = n;
    this.xs = new Float64Array(n);
    this.zs = new Float64Array(n);
    this.cum = new Float64Array(n + 1); // cum[i] = arc length at vertex i; cum[n] = total
    let cx = 0;
    let cz = 0;
    for (let i = 0; i < n; i++) {
      this.xs[i] = pts[i].x;
      this.zs[i] = pts[i].z;
      cx += pts[i].x;
      cz += pts[i].z;
    }
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      this.cum[i + 1] = this.cum[i] + Math.hypot(this.xs[j] - this.xs[i], this.zs[j] - this.zs[i]);
    }
    this.length = n > 1 ? this.cum[n] : 0;
    this.cx = n ? cx / n : 0;
    this.cz = n ? cz / n : 0;
  }

  /** True when the loop is usable for walking. */
  get valid() {
    return this.n >= 3 && this.length > 4;
  }

  wrap(s) {
    const L = this.length || 1;
    s %= L;
    return s < 0 ? s + L : s;
  }

  /** Segment index containing arc length s (binary search). */
  segAt(s) {
    let lo = 0;
    let hi = this.n - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.cum[mid] <= s) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  /**
   * Point and unit tangent (in increasing-s direction) at arc length s.
   * @param {number} s
   * @param {{x:number, z:number, tx:number, tz:number}} out
   */
  sample(s, out) {
    s = this.wrap(s);
    const i = this.segAt(s);
    const j = (i + 1) % this.n;
    const segLen = this.cum[i + 1] - this.cum[i] || 1;
    const t = (s - this.cum[i]) / segLen;
    const dx = this.xs[j] - this.xs[i];
    const dz = this.zs[j] - this.zs[i];
    out.x = this.xs[i] + dx * t;
    out.z = this.zs[i] + dz * t;
    out.tx = dx / segLen;
    out.tz = dz / segLen;
    return out;
  }

  /**
   * Closest point on the loop near a hint segment (searches `win` segments
   * either side). Writes { s, seg, dist } into out.
   */
  project(x, z, hintSeg, win, out) {
    const n = this.n;
    let best = Infinity;
    let bestS = 0;
    let bestSeg = hintSeg;
    for (let k = -win; k <= win; k++) {
      const i = (((hintSeg + k) % n) + n) % n;
      const j = (i + 1) % n;
      const ax = this.xs[i];
      const az = this.zs[i];
      const dx = this.xs[j] - ax;
      const dz = this.zs[j] - az;
      const l2 = dx * dx + dz * dz || 1;
      let t = ((x - ax) * dx + (z - az) * dz) / l2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const px = ax + dx * t - x;
      const pz = az + dz * t - z;
      const d2 = px * px + pz * pz;
      if (d2 < best) {
        best = d2;
        bestSeg = i;
        bestS = this.cum[i] + t * (this.cum[i + 1] - this.cum[i]);
      }
    }
    out.s = bestS;
    out.seg = bestSeg;
    out.dist = Math.sqrt(best);
    return out;
  }
}

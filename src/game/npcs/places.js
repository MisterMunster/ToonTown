// Where the wildlife hangs out, derived from the town's public data
// (mapFeatures / landmarks / zones / npcPaths) so it adapts to any layout.

const dist2 = (ax, az, bx, bz) => (ax - bx) ** 2 + (az - bz) ** 2;

/** The park rectangle { minX, maxX, minZ, maxZ } or null. Prefers a labelled "...Park" feature. */
export function findPark(town) {
  const parks = (town?.mapFeatures ?? []).filter((f) => f?.kind === "park" && f.w > 0 && f.d > 0);
  const best = parks.find((f) => /park/i.test(f.label ?? "")) ?? parks.slice().sort((a, b) => b.w * b.d - a.w * a.d)[0];
  if (best) return { minX: best.x - best.w / 2, maxX: best.x + best.w / 2, minZ: best.z - best.d / 2, maxZ: best.z + best.d / 2 };
  const zone = (town?.zones ?? []).find((z) => /park/i.test(z?.name ?? ""));
  return zone ? { minX: zone.minX, maxX: zone.maxX, minZ: zone.minZ, maxZ: zone.maxZ } : null;
}

/** Centre of the town square: the fountain / plaza if known, else the spawn point. */
export function townCentre(town) {
  const lm = (town?.landmarks ?? []).find((l) => /fountain|square|plaza/i.test(l?.name ?? ""));
  if (lm) return { x: lm.x, z: lm.z };
  const plaza = (town?.mapFeatures ?? []).find((f) => f?.kind === "plaza");
  if (plaza) return { x: plaza.x, z: plaza.z };
  const sp = town?.spawnPoint;
  return { x: sp?.x ?? 0, z: sp?.z ?? 0 };
}

/**
 * 3-5 butterfly hangouts: grassy spots beside the park paths (nearest to the
 * spawn first, so they're seen early), clear of colliders and water.
 * Falls back to a ring around the town square.
 */
export function butterflyAnchors(town, colliders) {
  const park = findPark(town);
  const spawn = town?.spawnPoint ?? { x: 0, z: 0 };
  const waters = (town?.mapFeatures ?? []).filter((f) => f?.kind === "water");
  const hits = [];
  const wet = (x, z) => waters.some((w) => ((x - w.x) / (w.w / 2 + 2.5)) ** 2 + ((z - w.z) / (w.d / 2 + 2.5)) ** 2 < 1);
  const clear = (x, z) => {
    if (!colliders?.queryXZ) return true;
    colliders.queryXZ(x - 1.1, z - 1.1, x + 1.1, z + 1.1, hits);
    return !hits.some((c) => c.maxY > 0.35);
  };
  const inside = (x, z, m) => park && x > park.minX + m && x < park.maxX - m && z > park.minZ + m && z < park.maxZ - m;

  const cands = [];
  if (park) {
    for (const path of town?.npcPaths ?? []) {
      const n = path.length;
      for (let i = 0; i < n; i++) {
        const a = path[i];
        const b = path[(i + 1) % n];
        if (!inside(a.x, a.z, 2)) continue;
        const tx = b.x - a.x;
        const tz = b.z - a.z;
        const l = Math.hypot(tx, tz) || 1;
        for (const side of [-1, 1]) {
          const x = a.x + (-tz / l) * 2.6 * side;
          const z = a.z + (tx / l) * 2.6 * side;
          if (inside(x, z, 1.5) && !wet(x, z) && clear(x, z)) cands.push({ x, z });
        }
      }
    }
    if (!cands.length) {
      for (let x = park.minX + 3; x < park.maxX - 3; x += 4) {
        for (let z = park.minZ + 3; z < park.maxZ - 3; z += 4) if (!wet(x, z) && clear(x, z)) cands.push({ x, z });
      }
    }
  }
  if (!cands.length) {
    const c = townCentre(town);
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const x = c.x + Math.sin(a) * 11;
      const z = c.z + Math.cos(a) * 11;
      if (clear(x, z)) cands.push({ x, z });
    }
    if (!cands.length) cands.push({ x: c.x + 6, z: c.z + 6 });
  }

  cands.sort((p, q) => dist2(p.x, p.z, spawn.x, spawn.z) - dist2(q.x, q.z, spawn.x, spawn.z));
  const out = [];
  const take = (minGap, max) => {
    for (const p of cands) {
      if (out.length >= max) break;
      if (out.every((o) => dist2(o.x, o.z, p.x, p.z) > minGap * minGap)) out.push(p);
    }
  };
  take(8, 3); // a few near the entrance closest to the square...
  take(16, 5); // ...and a couple deeper in the park
  return out;
}

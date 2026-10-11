// Town sanity checker (headless, NullEngine):
//   node tools/preview/town-check.mjs [low|medium|high] [--verbose]
// Prints build time / vertex counts per bucket and validates gameplay data:
//  - every NPC path point keeps >= 0.8 m clearance from blocking colliders
//  - every coin floats ~1 m above a walkable surface and is not inside a solid
//  - spawn point is clear
import "../smoke-env.mjs";

const B = await import("@babylonjs/core");
const { ColliderWorld } = await import("../../src/game/colliders.js");
const { createTown } = await import("../../src/game/town.js");

const q = process.argv.find((a) => ["low", "medium", "high"].includes(a)) || "high";
const verbose = process.argv.includes("--verbose");
const origWarn = console.warn;
console.warn = (...a) => {
  if (/Thin Instances are not supported/.test(a.join(" "))) return;
  origWarn(...a);
};

const engine = new B.NullEngine();
const scene = new B.Scene(engine);
new B.DirectionalLight("sun", new B.Vector3(-1, -2, -1), scene);
new B.HemisphericLight("hemi", new B.Vector3(0, 1, 0), scene);
const casters = [];
const env = { addShadowCaster: (m) => casters.push(m), timeOfDay: 12, nightFactor: 0 };
const col = new ColliderWorld(8);
const t0 = performance.now();
const town = createTown(scene, env, col, { quality: q });
const ms = performance.now() - t0;

const rows = scene.meshes.map((m) => [m.name, m.getTotalVertices()]).sort((a, b) => b[1] - a[1]);
const byBucket = {};
for (const [n, v] of rows) {
  const k = n.split("_")[1];
  byBucket[k] = (byBucket[k] || 0) + v;
}
console.log(`quality=${q} build=${ms.toFixed(0)}ms meshes=${scene.meshes.length} materials=${scene.materials.length} casters=${casters.length} colliders=${col.list.length}`);
console.log("vertices by bucket:", byBucket, "total", rows.reduce((n, r) => n + r[1], 0));
if (verbose) for (const r of rows.slice(0, 30)) console.log("  ", r[0].padEnd(34), r[1]);
// triangles including thin instances (what the GPU actually draws)
const tris = scene.meshes
  .map((m) => [m.name, ((m.getTotalIndices?.() ?? 0) / 3) * Math.max(1, m.thinInstanceCount || 0)])
  .sort((a, b) => b[1] - a[1]);
console.log("triangles total", Math.round(tris.reduce((n, r) => n + r[1], 0)), "top:", tris.slice(0, 8).map((r) => `${r[0]}=${Math.round(r[1])}`).join(" "));
console.log(`coins=${town.coinSpots.length} npcPaths=${town.npcPaths.length} (${town.npcPaths.map((p) => p.length).join(",")}) landmarks=${town.landmarks.length} mapFeatures=${town.mapFeatures.length} zones=${town.zones.length}`);

let problems = 0;
const blocking = (c, y = 0.4) => c.maxY > y + 0.45 && c.minY < y + 1.7 && c.tag !== "water";

// ---- NPC paths: sample every 0.5 m along each loop
town.npcPaths.forEach((path, pi) => {
  const bad = [];
  for (let i = 0; i < path.length; i++) {
    const a = path[i];
    const b = path[(i + 1) % path.length];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (len > 6) bad.push(`gap ${len.toFixed(1)}m at ${i}`);
    const n = Math.max(1, Math.ceil(len / 0.5));
    for (let k = 0; k < n; k++) {
      const x = a.x + ((b.x - a.x) * k) / n;
      const z = a.z + ((b.z - a.z) * k) / n;
      const ground = col.groundHeightAt(x, z, 0.3, 0.6);
      for (const c of col.queryXZ(x - 0.8, z - 0.8, x + 0.8, z + 0.8, [])) {
        if (!blocking(c, ground)) continue;
        if (B.Vector3 && ColliderWorld.overlapsDiscXZ(c, x, z, 0.8)) {
          bad.push(`(${x.toFixed(1)},${z.toFixed(1)}) hits ${c.tag} ${c.type} [${c.minX.toFixed(1)}..${c.maxX.toFixed(1)}, ${c.minZ.toFixed(1)}..${c.maxZ.toFixed(1)}, y ${c.minY.toFixed(2)}..${c.maxY.toFixed(2)}]`);
          break;
        }
      }
    }
  }
  const uniq = [...new Set(bad)];
  if (uniq.length) {
    problems += uniq.length;
    console.log(`npcPath ${pi}: ${uniq.length} problem(s)`);
    for (const s of uniq.slice(0, 8)) console.log("   ", s);
  }
});

// ---- coins
town.coinSpots.forEach((c, i) => {
  const ground = col.groundHeightAt(c.x, c.z, 0.25, c.y - 0.3);
  const lift = c.y - ground;
  const inside = col.queryXZ(c.x - 0.3, c.z - 0.3, c.x + 0.3, c.z + 0.3, []).filter(
    (k) => ColliderWorld.overlapsDiscXZ(k, c.x, c.z, 0.3) && k.minY < c.y + 0.3 && k.maxY > c.y - 0.3,
  );
  if (lift < 0.7 || lift > 1.4 || inside.length) {
    problems++;
    console.log(`coin ${i} (${c.x}, ${c.y}, ${c.z}) surface=${ground.toFixed(2)} lift=${lift.toFixed(2)} inside=${inside.map((k) => k.tag).join(",")}`);
  } else if (verbose) console.log(`coin ${i} ok (${c.x}, ${c.y}, ${c.z}) on ${ground.toFixed(2)}`);
});

// ---- spawn
const s = town.spawnPoint;
const sg = col.groundHeightAt(s.x, s.z, 0.35, s.y + 0.4);
if (Math.abs(sg - s.y) > 0.02) {
  problems++;
  console.log(`spawn ground ${sg} != spawn y ${s.y}`);
}
console.log(problems ? `\nTOWN CHECK: ${problems} problem(s)` : "\nTOWN CHECK OK");
process.exit(problems ? 1 : 0);

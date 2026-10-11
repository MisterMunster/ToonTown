// Headless behaviour check for the NPC module against the real town:
//   node tools/preview/npcs-sim.mjs [seconds=120] [hero=spawn|walk]
// Reports greetings, min NPC-NPC / NPC-hero distances, max distance from the
// path centre line and whether any NPC ended up inside a solid collider.
import "../smoke-env.mjs";
const B = await import("@babylonjs/core");
const root = new URL("../../", import.meta.url);
const { events } = await import(new URL("src/game/events.js", root));
const { ColliderWorld } = await import(new URL("src/game/colliders.js", root));
const { createTown } = await import(new URL("src/game/town.js", root));
const { createNPCs } = await import(new URL("src/game/npcs.js", root));

const secs = Number(process.argv[2] ?? 120);
const heroMode = process.argv[3] ?? "spawn";
const quality = process.argv[4] ?? "high";
const engine = new B.NullEngine();
const scene = new B.Scene(engine);
new B.HemisphericLight("h", new B.Vector3(0, 1, 0), scene);
const cam = new B.ArcRotateCamera("c", 0, 1, 10, B.Vector3.Zero(), scene);
const env = { addShadowCaster() {}, nightFactor: 0 };
const colliders = new ColliderWorld(8);
const town = createTown(scene, env, colliders, { quality });
const npcs = createNPCs(scene, env, colliders, town, { quality, events });
const greets = [];
let t = 0;
events.on("npc:greet", (p) => greets.push(`${t.toFixed(1)}s ${p.name}: ${p.text}`));
const hero = town.spawnPoint.clone();
const dt = 1 / 60;
let minNN = Infinity, minNH = Infinity, maxOff = 0, inside = 0, stuck = 0;
const folk = npcs.townsfolk;
const lastPos = folk.map((n) => ({ x: n.x, z: n.z, t: 0 }));
const solid = (x, z, y) => colliders.queryXZ(x - 0.25, z - 0.25, x + 0.25, z + 0.25, []).some((c) => c.tag !== "water" && c.maxY > y + 0.45 && c.minY < y + 1.6 && B.Vector3 && (c.type === "cyl" ? Math.hypot(x - c.x, z - c.z) < c.radius + 0.25 : x > c.minX - 0.25 && x < c.maxX + 0.25 && z > c.minZ - 0.25 && z < c.maxZ + 0.25) && (c.type === "cyl" || (Math.max(c.minX - x, 0, x - c.maxX) ** 2 + Math.max(c.minZ - z, 0, z - c.maxZ) ** 2 < 0.0625)));
for (let f = 0; f < secs * 60; f++) {
  t += dt;
  if (heroMode === "walk") {
    // walk around the square circle against the NPC traffic
    const a = t * 0.15;
    hero.x = Math.sin(a) * 10;
    hero.z = Math.cos(a) * 10;
  }
  npcs.update(dt, hero);
  cam.target.copyFrom(hero);
  for (let i = 0; i < folk.length; i++) {
    const a = folk[i];
    for (let j = i + 1; j < folk.length; j++) minNN = Math.min(minNN, Math.hypot(a.x - folk[j].x, a.z - folk[j].z));
    minNH = Math.min(minNH, Math.hypot(a.x - hero.x, a.z - hero.z));
    const pr = a.path.project(a.x, a.z, a.seg, a.path.n, {});
    if (f > 120) maxOff = Math.max(maxOff, pr.dist);
    if (solid(a.x, a.z, a.y)) inside++;
    if (f % 300 === 0) {
      const lp = lastPos[i];
      if (f > 0 && Math.hypot(a.x - lp.x, a.z - lp.z) < 0.5 && a.mode === "walk") stuck++;
      lp.x = a.x; lp.z = a.z;
    }
  }
}
console.log(`npcs=${folk.length} paths=${town.npcPaths.length} sim=${secs}s hero=${heroMode}`);
console.log(folk.map((n) => `${n.name}: len=${n.path.length.toFixed(0)} dir=${n.dir} speed=${n.baseSpeed.toFixed(2)} y=${n.y.toFixed(2)} mode=${n.mode}`).join("\n"));
console.log(`greetings (${greets.length}):\n  ` + greets.join("\n  "));
console.log(`min NPC-NPC=${minNN.toFixed(2)} m  min NPC-hero=${minNH.toFixed(2)} m  max off-path=${maxOff.toFixed(2)} m  insideSolid frames=${inside} stuck samples=${stuck}`);
process.exit(0);

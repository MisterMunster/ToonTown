// Integration preview: environment + real town + hero, wired like src/main.js
// (minus input/player/NPCs). Used to check lighting, shadows (incl. the
// skinned, outlined hero) and fog against the actual art.
import { ArcRotateCamera, Engine, Scene, Vector3 } from "@babylonjs/core";
import { events } from "/src/game/events.js";
import { ColliderWorld } from "/src/game/colliders.js";
import { createEnvironment } from "/src/game/environment.js";
import { createTown } from "/src/game/town.js";
import { createCharacter } from "/src/game/character.js";

const params = new URLSearchParams(location.search);
const num = (k, d) => (params.has(k) ? Number(params.get(k)) : d);
const quality = params.get("quality") || "high";

const canvas = document.getElementById("c");
const engine = new Engine(canvas, true, { stencil: true }, false);
engine.resize();
const scene = new Scene(engine);

const env = createEnvironment(scene, engine, { quality, events });
const town = createTown(scene, env, new ColliderWorld(8), { quality });
const hero = createCharacter(scene, { name: "Pip", preset: "hero", outline: true, lod: "high" });
hero.root.position.copyFrom(town.spawnPoint);
hero.root.rotation.y = town.spawnHeading + num("turn", 0);
env.addShadowCaster(hero.root, true);
if (params.has("wave")) hero.setState("wave");

const target = town.spawnPoint.add(new Vector3(0, 1.25, 0));
const camera = new ArcRotateCamera("cam", num("alpha", -Math.PI / 2 - town.spawnHeading), num("beta", 1.15), num("radius", 9), target, scene);
camera.fov = 0.85;
camera.minZ = 0.1;
camera.maxZ = 1200;
camera.attachControl(canvas, true);
env.setupPostProcessing(camera);

if (params.has("time")) {
  if (!params.has("cycle")) events.emit("settings:daynight", { mode: "day" });
  env.setTimeOfDay(num("time", 12));
}

let elapsed = 0;
let frames = 0;
engine.runRenderLoop(() => {
  const dt = Math.min(engine.getDeltaTime() / 1000, 0.05);
  elapsed += dt;
  env.update(dt, town.spawnPoint);
  town.setNightFactor(env.nightFactor);
  town.update(dt, elapsed);
  hero.update(dt, { speed: 0 });
  scene.render();
  if (++frames === 5) console.log(`[town-preview] t=${env.timeOfDay.toFixed(2)} night=${env.nightFactor.toFixed(2)} meshes=${scene.meshes.length} casters=${env.shadowGenerator.getShadowMap()?.renderList?.length}`);
});

// FX + collectibles preview: a small plaza with coins (real collectibles
// module, fake town.coinSpots), a stand-in hero and on-demand particle bursts.
// Deterministic: every rendered frame advances exactly STEP/60 s, so `?at=N` freezes the
// same moment of an effect each run (handy for headless screenshots).
import {
  ArcRotateCamera,
  Color3,
  DirectionalLight,
  Engine,
  HemisphericLight,
  MeshBuilder,
  Scene,
  Vector3,
} from "@babylonjs/core";
import { events } from "/src/game/events.js";
import { PALETTE } from "/src/game/palette.js";
import { toonMat } from "/src/game/materials.js";
import { createCollectibles } from "/src/game/collectibles.js";
import { createFX } from "/src/game/fx.js";

const params = new URLSearchParams(location.search);
const num = (k, d) => (params.has(k) ? Number(params.get(k)) : d);
const quality = params.get("quality") || "high";
const fxName = params.get("fx") || "";
const STEP = num("step", 2); // simulated 60 Hz frames per rendered frame (software WebGL is slow)
const START = num("start", 4);
const FREEZE = params.has("at") ? START + num("at", 20) : Infinity;

// Audio can't be heard headless: ?audio=1 renders every sound offline first and
// logs levels (runs before the scene so rendering doesn't starve it).
if (params.has("audio")) {
  const { runAudioSelfTest } = await import("./fx-audio-test.js");
  await runAudioSelfTest().catch((err) => console.error("[audio test] failed", err));
}

/** Import a sibling module that may not exist yet (other engineers' work in progress). */
function optionalImport(path) {
  return import(/* @vite-ignore */ path);
}

const canvas = document.getElementById("c");
const engine = new Engine(canvas, true, { stencil: true }, false);
engine.resize();
window.addEventListener("resize", () => engine.resize());
const scene = new Scene(engine);
scene.useConstantAnimationDeltaTime = true;
scene.getAnimationRatio = () => STEP; // particles advance STEP/60 s per rendered frame

// ---- environment (real module if it loads, otherwise simple lights) -----------
let env = { nightFactor: 0, update() {}, addShadowCaster() {}, setupPostProcessing() {} };
try {
  const { createEnvironment } = await optionalImport("/src/game/environment.js");
  env = createEnvironment(scene, engine, { quality, events });
} catch (err) {
  console.warn("[fx preview] environment unavailable, using stand-in lights:", err?.message);
  new HemisphericLight("hemi", new Vector3(0, 1, 0), scene).intensity = 0.8;
  const sun = new DirectionalLight("sun", new Vector3(-0.5, -1, 0.6), scene);
  sun.intensity = 0.9;
  scene.clearColor.set(0.56, 0.83, 1, 1);
}

// ---- stand-in plaza ------------------------------------------------------------
const ground = MeshBuilder.CreateGround("ground", { width: 200, height: 200 }, scene);
ground.material = toonMat(scene, PALETTE.grass);
ground.receiveShadows = true;
const plaza = MeshBuilder.CreateCylinder("plaza", { diameter: 18, height: 0.04, tessellation: 48 }, scene);
plaza.position.y = 0.0;
plaza.material = toonMat(scene, PALETTE.plaza);
plaza.receiveShadows = true;
const crate = MeshBuilder.CreateBox("crate", { size: 1.4 }, scene);
crate.position.set(4, 0.7, 3);
crate.material = toonMat(scene, PALETTE.wood);
crate.receiveShadows = true;
env.addShadowCaster(crate);
const house = MeshBuilder.CreateBox("house", { width: 7, depth: 5, height: 5 }, scene);
house.position.set(-2, 2.5, 12);
house.material = toonMat(scene, PALETTE.walls[0]);
env.addShadowCaster(house);

// Hero: real character module if present, else a capsule figure.
const heroPos = new Vector3(0, 0, 0);
let heroRoot;
try {
  const { createCharacter } = await optionalImport("/src/game/character.js");
  const ch = createCharacter(scene, { name: "Pip", preset: "hero", outline: true, lod: "high" });
  heroRoot = ch.root;
  env.addShadowCaster(ch.root, true);
} catch {
  const body = MeshBuilder.CreateCapsule("hero", { height: 1.2, radius: 0.32 }, scene);
  body.position.y = 0.6;
  body.material = toonMat(scene, PALETTE.shirts[0]);
  const head = MeshBuilder.CreateSphere("heroHead", { diameter: 0.62, segments: 16 }, scene);
  head.position.y = 1.4;
  head.material = toonMat(scene, PALETTE.skin[0]);
  heroRoot = MeshBuilder.CreateBox("heroRoot", { size: 0.01 }, scene);
  body.parent = heroRoot;
  head.parent = heroRoot;
  env.addShadowCaster(body);
  env.addShadowCaster(head);
}
heroRoot.rotation.y = Math.PI; // face the camera

// ---- coins -------------------------------------------------------------------------
const coinSpots = [];
for (let i = 0; i < 6; i++) coinSpots.push({ x: 0, y: 1, z: -2 - i * 1.6 }); // a row in front of the hero
for (let i = 0; i < 8; i++) {
  const a = (i / 8) * Math.PI * 2;
  coinSpots.push({ x: -6 + Math.cos(a) * 2.2, y: 1, z: 2 + Math.sin(a) * 2.2 }); // a ring
}
coinSpots.push({ x: 4, y: 2.4, z: 3 }); // on the crate
const town = { coinSpots };
const collectibles = createCollectibles(scene, env, town, { events });
const fx = createFX(scene, env, { events, quality });

events.on("coin:collected", (e) => console.log(`[fx preview] coin:collected ${e.collected}/${e.total}`));
events.on("coin:all", () => console.log("[fx preview] coin:all"));

// ---- camera ------------------------------------------------------------------------
const view = params.get("view");
const camDefaults = view === "coin" ? [-1.75, 1.45, 3.2, 1.0] : view === "wide" ? [-1.9, 1.05, 22, 1] : [-1.95, 1.2, 9, 1.0];
const camera = new ArcRotateCamera("cam", num("alpha", camDefaults[0]), num("beta", camDefaults[1]), num("radius", camDefaults[2]),
  view === "coin" ? new Vector3(0, num("ty", camDefaults[3]), -2) : new Vector3(0, num("ty", camDefaults[3]), -1), scene);
camera.minZ = 0.1;
camera.maxZ = 800;
camera.fov = 0.8;
camera.attachControl(canvas, true);
camera.inputs.removeByType("ArcRotateCameraKeyboardMoveInput");
scene.activeCamera = camera;
env.setupPostProcessing?.(camera);
// Hold the clock at ?time=H (default 14:00).
events.emit("settings:daynight", { mode: "day" });
env.setTimeOfDay?.(num("time", 14));
events.emit("game:start");

// ---- effects -------------------------------------------------------------------------
function trigger(name) {
  const p = heroPos.clone();
  switch (name) {
    case "land":
      events.emit("player:land", { impact: num("impact", 11), position: p });
      break;
    case "jump":
      events.emit("player:jump", { double: false, position: p });
      break;
    case "double":
      events.emit("player:jump", { double: true, position: p.add(new Vector3(0, 1.2, 0)) });
      break;
    case "coin":
      events.emit("coin:collected", { collected: 1, total: 15, position: new Vector3(0, 1.1, -0.8) });
      break;
    case "confetti":
      events.emit("player:footstep", { run: false, position: p });
      events.emit("coin:all");
      break;
    case "all":
      trigger("land");
      events.emit("player:jump", { double: true, position: new Vector3(-3, 1.5, -1) });
      events.emit("coin:collected", { collected: 1, total: 15, position: new Vector3(2.2, 1.1, -1) });
      events.emit("coin:all");
      break;
  }
}

// ---- loop ------------------------------------------------------------------------------
const info = document.getElementById("info");
if (params.get("hud") === "0") info.style.display = "none";
const walk = params.has("walk");
const dt = STEP / 60;
let frame = 0;
const t0 = performance.now();

function step() {
  frame++;
  if (walk && frame > START) {
    // Run along the coin row (toward -Z), kicking dust.
    heroPos.z -= 5.5 * dt;
    if (frame % Math.max(1, Math.round(18 / STEP)) === 0) events.emit("player:footstep", { run: true, position: heroPos.clone() });
  }
  heroRoot.position.copyFrom(heroPos);
  if (frame === START && fxName) for (const n of fxName.split(",")) trigger(n);
  env.update?.(dt, heroPos);
  collectibles.update(dt, heroPos);
  fx.update(dt);
  scene.render();
  if (frame % 10 === 0 || frame >= FREEZE) {
    const counts = scene.particleSystems.map((p) => `${p.name.replace("fx", "")}:${p.getActiveCount()}`).join(" ");
    info.textContent = `frame ${frame}  coins ${collectibles.collected}/${collectibles.total}  ${counts}`;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await scene.whenReadyAsync();
// Compile the particle shaders before the timed sequence (they compile lazily).
for (let i = 0; i < 400 && !scene.particleSystems.every((p) => p.isReady()); i++) {
  scene.render();
  await sleep(25);
}

if (Number.isFinite(FREEZE)) {
  // Screenshot mode: simulate + render synchronously up to the freeze frame, so
  // the captured image is the same moment every run regardless of virtual time.
  while (frame < FREEZE) step();
  // Hold that moment: keep presenting it with particle simulation paused.
  for (const ps of scene.particleSystems) ps.paused = true;
  engine.runRenderLoop(() => scene.render());
  const counts = scene.particleSystems.map((p) => `${p.name}:${p.getActiveCount()}`).join(" ");
  console.log(`[fx preview] frozen at frame ${frame} (${((performance.now() - t0) / 1000).toFixed(1)}s) ${counts} coins ${collectibles.collected}/${collectibles.total}`);
} else {
  engine.runRenderLoop(step);
}


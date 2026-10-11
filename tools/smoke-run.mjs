// Headless smoke test. Builds the game in Node with Babylon's NullEngine using
// every module that exists (missing ones are replaced by stubs), simulates
// ~10 seconds of gameplay (walking, running, jumping, day/night, settings
// events) and reports any exception or console.error.
//
//   node tools/smoke-run.mjs                 # use all real modules that exist
//   node tools/smoke-run.mjs --only town     # real town, everything else stubbed
//   node tools/smoke-run.mjs --frames 900
//
// This does NOT check visuals — only that code runs without throwing.
import "./smoke-env.mjs";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const onlyIdx = argv.indexOf("--only");
const only = onlyIdx >= 0 ? argv[onlyIdx + 1].split(",") : null;
const framesIdx = argv.indexOf("--frames");
const FRAMES = framesIdx >= 0 ? Number(argv[framesIdx + 1]) : 600;

const errors = [];
const origError = console.error;
console.error = (...a) => {
  errors.push(a.map((x) => (x instanceof Error ? x.stack : String(x))).join(" "));
  origError(...a);
};
const origWarn = console.warn;
console.warn = (...a) => {
  const s = a.join(" ");
  // NullEngine-only noise: no float textures, and it reports just 16 vertex
  // uniform vectors, so skinned characters warn about bone uniforms (WebGL2 in
  // the browser stores bones in a texture and stays silent).
  if (/Thin Instances are not supported|PrePassRenderer|WebGL 2|bones stored as vertex uniforms/.test(s)) return;
  origWarn(...a);
};

const B = await import("@babylonjs/core");
const { events } = await import(pathToFileURL(path.join(root, "src/game/events.js")).href);
const { ColliderWorld } = await import(pathToFileURL(path.join(root, "src/game/colliders.js")).href);

const MODULES = {
  environment: ["src/game/environment.js", "createEnvironment"],
  town: ["src/game/town.js", "createTown"],
  character: ["src/game/character.js", "createCharacter"],
  input: ["src/game/input.js", "createInput"],
  player: ["src/game/player.js", "createPlayer"],
  camera: ["src/game/camera.js", "createCameraRig"],
  npcs: ["src/game/npcs.js", "createNPCs"],
  collectibles: ["src/game/collectibles.js", "createCollectibles"],
  fx: ["src/game/fx.js", "createFX"],
  audio: ["src/game/audio.js", "createAudio"],
  hud: ["src/ui/hud.js", "createHUD"],
};

const used = {};
async function load(name) {
  const [file, fn] = MODULES[name];
  const abs = path.join(root, file);
  if ((only && !only.includes(name)) || !existsSync(abs)) {
    used[name] = "stub";
    return null;
  }
  const mod = await import(pathToFileURL(abs).href);
  if (typeof mod[fn] !== "function") throw new Error(`${file} does not export ${fn}()`);
  used[name] = "REAL";
  return mod[fn];
}

// ---------- stubs ----------------------------------------------------------
function stubEnv(scene) {
  const sun = new B.DirectionalLight("sun", new B.Vector3(-1, -2, -1), scene);
  const hemi = new B.HemisphericLight("hemi", new B.Vector3(0, 1, 0), scene);
  return {
    sun, hemi, shadowGenerator: null,
    addShadowCaster() {}, removeShadowCaster() {}, setupPostProcessing() {},
    update() {}, timeOfDay: 12, nightFactor: 0, setTimeOfDay() {}, setQuality() {},
  };
}
function stubTown() {
  return {
    spawnPoint: new B.Vector3(0, 0, -12), spawnHeading: 0,
    bounds: { minX: -80, maxX: 80, minZ: -80, maxZ: 80 },
    mapFeatures: [], landmarks: [], zones: [{ name: "Town Square", minX: -15, maxX: 15, minZ: -15, maxZ: 15 }],
    npcPaths: [[{ x: -20, z: -20 }, { x: 20, z: -20 }, { x: 20, z: 20 }, { x: -20, z: 20 }]],
    coinSpots: [{ x: 0, y: 1, z: -8 }, { x: 3, y: 1, z: -12 }, { x: 10, y: 2, z: 10 }],
    setNightFactor() {}, update() {},
  };
}
function stubCharacter(scene) {
  const root = new B.TransformNode("stubChar", scene);
  return { root, meshes: [], state: "idle", setState(s) { this.state = s; }, update() {}, setLookAt() {}, dispose() { root.dispose(); } };
}
function stubInput() {
  let jump = false;
  return { moveX: 0, moveZ: 0, run: false, jumpHeld: false, lookX: 0, lookY: 0, device: "keyboard",
    consumeJump() { const j = jump; jump = false; return j; }, pressJump() { jump = true; }, update() {} };
}
function stubPlayer(character, spawn) {
  const position = spawn.clone();
  return { root: character.root, position, velocity: B.Vector3.Zero(), heading: 0, speed: 0, grounded: true, enabled: true,
    update(dt) { this.position.z += dt; }, teleport(v) { this.position.copyFrom(v); } };
}
function stubCamera(scene) {
  const camera = new B.ArcRotateCamera("cam", -Math.PI / 2, 1.1, 10, B.Vector3.Zero(), scene);
  return { camera, yaw: 0, update() {}, setIntro() {} };
}
function stubHud() {
  return { setLoading() {}, showStartScreen: async () => {}, setMap() {}, update() {}, toast() {}, showZone() {}, paused: false };
}

// ---------- build ----------------------------------------------------------
const engine = new B.NullEngine({ renderWidth: 1280, renderHeight: 720, textureSize: 512, deterministicLockstep: false });
const scene = new B.Scene(engine);
const colliders = new ColliderWorld(8);
const quality = "high";
let phase = "build";
try {
  const createHUD = await load("hud");
  phase = "hud";
  const hud = createHUD ? createHUD({ root: document.getElementById("hud-root"), events, quality }) : stubHud();
  hud.setLoading(0.1, "smoke");

  const createEnvironment = await load("environment");
  phase = "environment";
  const env = createEnvironment ? createEnvironment(scene, engine, { quality, events }) : stubEnv(scene);

  const createTown = await load("town");
  phase = "town";
  const town = createTown ? createTown(scene, env, colliders, { quality }) : stubTown();

  const createCharacter = await load("character");
  phase = "character";
  const hero = createCharacter ? createCharacter(scene, { name: "Pip", preset: "hero", outline: true, lod: "high" }) : stubCharacter(scene);
  env.addShadowCaster(hero.root, true);

  const createInput = await load("input");
  phase = "input";
  const canvas = engine.getRenderingCanvas?.() ?? document.createElement("canvas");
  const input = createInput ? createInput(scene, canvas, { events }) : stubInput();

  const createPlayer = await load("player");
  phase = "player";
  const player = createPlayer
    ? createPlayer(scene, hero, input, colliders, { spawn: town.spawnPoint, heading: town.spawnHeading, bounds: town.bounds, events })
    : stubPlayer(hero, town.spawnPoint);

  const createCameraRig = await load("camera");
  phase = "camera";
  const cameraRig = createCameraRig ? createCameraRig(scene, canvas, player, input, colliders, { quality }) : stubCamera(scene);
  scene.activeCamera = cameraRig.camera;
  env.setupPostProcessing(cameraRig.camera);
  cameraRig.setIntro(true);

  const createNPCs = await load("npcs");
  phase = "npcs";
  const npcs = createNPCs ? createNPCs(scene, env, colliders, town, { quality, events }) : { update() {}, positions: [] };

  const createCollectibles = await load("collectibles");
  phase = "collectibles";
  const collectibles = createCollectibles ? createCollectibles(scene, env, town, { events }) : { update() {}, positions: [], collected: 0, total: 0 };

  const createFX = await load("fx");
  phase = "fx";
  const fx = createFX ? createFX(scene, env, { events, quality }) : { update() {} };

  const createAudio = await load("audio");
  phase = "audio";
  const audio = createAudio ? createAudio({ events }) : { update() {} };

  phase = "hud.setMap";
  hud.setMap(town);

  console.log("modules:", Object.entries(used).map(([k, v]) => `${k}=${v}`).join(" "));
  console.log(`meshes=${scene.meshes.length} materials=${scene.materials.length} lights=${scene.lights.length} colliders=${colliders.list.length} coins=${collectibles.total} npcPaths=${town.npcPaths?.length}`);

  // ---------- simulate ------------------------------------------------------
  phase = "simulate";
  events.emit("game:start");
  cameraRig.setIntro(false);
  player.enabled = true;
  const dt = 1 / 60;
  let elapsed = 0;
  const spawnY = player.position.y;
  let maxY = spawnY;
  const startPos = player.position.clone();
  for (let f = 0; f < FRAMES; f++) {
    elapsed += dt;
    if (f === 100) events.emit("settings:daynight", { mode: "night" });
    if (f === 200) events.emit("settings:daynight", { mode: "sunset" });
    if (f === 300) events.emit("settings:daynight", { mode: "cycle" });
    if (f === 250) events.emit("settings:quality", { level: "low" });
    if (f === 350) events.emit("settings:quality", { level: "high" });
    if (f === 120) events.emit("hud:slotSelected", { index: 2, item: { id: "potion", name: "Potion" } });
    if (f === 130) events.emit("hud:useItem", { index: 2, item: { id: "potion", name: "Potion" } });
    if (f === 140) events.emit("settings:mute", { muted: true });
    if (f === 150) events.emit("settings:music", { on: false });
    if (f === 160) events.emit("camera:reset");

    input.update(dt);
    // Drive the input object directly after polling (works for real module and stub).
    input.moveZ = f % 240 < 180 ? 1 : 0;
    input.moveX = f % 480 < 240 ? 0 : 0.5;
    input.run = f % 600 > 300;
    if (f % 90 === 30) {
      if (typeof input.pressJump === "function") input.pressJump();
      else input._press?.();
    }
    player.update(dt, cameraRig.yaw);
    cameraRig.update(dt);
    env.update(dt, player.position);
    town.setNightFactor(env.nightFactor);
    town.update(dt, elapsed);
    npcs.update(dt, player.position);
    collectibles.update(dt, player.position);
    fx.update(dt);
    audio.update(dt, { paused: false, nightFactor: env.nightFactor, speed: player.speed });
    hud.update(dt, {
      playerPos: player.position, heading: player.heading, cameraYaw: cameraRig.yaw, timeOfDay: env.timeOfDay,
      nightFactor: env.nightFactor, speed: player.speed, grounded: player.grounded, fps: 60,
      npcPositions: npcs.positions, coinPositions: collectibles.positions, coins: collectibles.collected, coinsTotal: collectibles.total,
    });
    maxY = Math.max(maxY, player.position.y);
    if (f % 2 === 0) scene.render();
    for (const k of ["x", "y", "z"]) {
      if (!Number.isFinite(player.position[k])) throw new Error(`player.position.${k} became ${player.position[k]} at frame ${f}`);
    }
  }
  const moved = B.Vector3.Distance(startPos, player.position);
  console.log(`simulated ${FRAMES} frames: player moved ${moved.toFixed(2)} m, max jump height ${(maxY - spawnY).toFixed(2)} m, final pos (${player.position.x.toFixed(2)}, ${player.position.y.toFixed(2)}, ${player.position.z.toFixed(2)}), time ${env.timeOfDay?.toFixed?.(2)}h night=${env.nightFactor?.toFixed?.(2)} coins=${collectibles.collected}/${collectibles.total}`);
  console.log(`drawable meshes=${scene.meshes.filter((m) => m.isEnabled() && m.isVisible && m.getTotalVertices() > 0).length} activeMeshes(last frame)=${scene.getActiveMeshes().length} totalVertices=${scene.getTotalVertices()}`);
} catch (err) {
  errors.push(`[${phase}] ${err.stack || err}`);
}

if (errors.length) {
  console.log(`\nSMOKE FAILED (${errors.length} error(s)):`);
  for (const e of errors) console.log(" - " + e.split("\n").slice(0, 6).join("\n   "));
  process.exit(1);
}
console.log("\nSMOKE OK");
process.exit(0);

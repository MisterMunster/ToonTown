// Controls preview: a small obstacle course (curb, 0.35 step, 0.6 block,
// 1 m crate, stairs to a 1.8 m ledge, high platform, wall, posts, an arch to
// bonk your head on) with the real input / player / camera modules.
// See controls.html for the query params.
import "@fontsource/fredoka/600.css";
import "@fontsource/fredoka/700.css";
import "/src/ui/base.css";
import {
  Color3,
  Color4,
  DirectionalLight,
  DynamicTexture,
  Engine,
  HemisphericLight,
  MeshBuilder,
  Scene,
  ShadowGenerator,
  StandardMaterial,
  Texture,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
import { events } from "/src/game/events.js";
import { PALETTE } from "/src/game/palette.js";
import { toonMat } from "/src/game/materials.js";
import { ColliderWorld } from "/src/game/colliders.js";
import { createInput } from "/src/game/input.js";
import { createPlayer } from "/src/game/player.js";
import { createCameraRig } from "/src/game/camera.js";

// Optional modules owned by other engineers: only loaded if the file exists.
const characterModules = import.meta.glob("/src/game/character.js");
const environmentModules = import.meta.glob("/src/game/environment.js");

const params = new URLSearchParams(location.search);
const num = (k, d) => (params.has(k) && params.get(k) !== "" ? Number(params.get(k)) : d);
const autoName = params.get("auto");
const freezeAt = num("freeze", Infinity);
const showInfo = params.get("hud") !== "0";

const canvas = document.getElementById("renderCanvas");
const engine = new Engine(canvas, true, { stencil: true }, false);
engine.resize();
window.addEventListener("resize", () => engine.resize());
const scene = new Scene(engine);
scene.clearColor = Color4.FromHexString(PALETTE.sky + "ff");
scene.skipPointerMovePicking = true;
scene.fogMode = Scene.FOGMODE_LINEAR;
scene.fogColor = Color3.FromHexString(PALETTE.fog);
scene.fogStart = 45;
scene.fogEnd = 110;

// ---- lights (or the real environment) ---------------------------------------
let env = null;
if (params.get("env") === "1" && environmentModules["/src/game/environment.js"]) {
  try {
    const { createEnvironment } = await environmentModules["/src/game/environment.js"]();
    env = createEnvironment(scene, engine, { quality: "high", events });
  } catch (err) {
    console.warn("environment module failed, using simple lights", err);
    env = null;
  }
}
let shadowGen = null;
if (!env) {
  const hemi = new HemisphericLight("hemi", new Vector3(0.2, 1, -0.3), scene);
  hemi.intensity = 0.5;
  hemi.groundColor = new Color3(0.45, 0.5, 0.62);
  const sun = new DirectionalLight("sun", new Vector3(-0.45, -1, 0.55), scene);
  sun.position = new Vector3(18, 40, -22);
  sun.intensity = 0.82;
  sun.diffuse = Color3.FromHexString("#fff3df");
  shadowGen = new ShadowGenerator(2048, sun);
  shadowGen.usePercentageCloserFiltering = true;
  shadowGen.filteringQuality = ShadowGenerator.QUALITY_MEDIUM;
  shadowGen.bias = 0.002;
  shadowGen.normalBias = 0.02;
  shadowGen.setDarkness(0.35);
}
function addCaster(node) {
  if (env) return env.addShadowCaster(node, true);
  if (typeof node.getBoundingInfo === "function") shadowGen.addShadowCaster(node, true);
  else for (const m of node.getChildMeshes()) shadowGen.addShadowCaster(m, false);
}

// ---- arena -----------------------------------------------------------------------
const colliders = new ColliderWorld(8);
const bounds = { minX: -30, maxX: 30, minZ: -30, maxZ: 30 };

function gridGround() {
  const tex = new DynamicTexture("gridTex", { width: 256, height: 256 }, scene, true);
  const ctx = tex.getContext();
  ctx.fillStyle = PALETTE.grass;
  ctx.fillRect(0, 0, 256, 256);
  ctx.fillStyle = PALETTE.grassDark;
  ctx.globalAlpha = 0.35;
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillRect(128, 128, 128, 128);
  ctx.globalAlpha = 1;
  tex.update();
  tex.wrapU = tex.wrapV = Texture.WRAP_ADDRESSMODE;
  tex.uScale = tex.vScale = 30; // 4 m checker tiles
  const mat = new StandardMaterial("groundMat", scene);
  mat.diffuseTexture = tex;
  mat.specularColor = new Color3(0.02, 0.02, 0.02);
  const ground = MeshBuilder.CreateGround("ground", { width: 120, height: 120 }, scene);
  ground.material = mat;
  ground.receiveShadows = true;
  ground.isPickable = false;
}
gridGround();

/** Visible box + matching collider; (x0,z0)-(x1,z1) footprint, y0..y1 height. */
function block(name, x0, z0, x1, z1, y0, y1, color, tag = "prop") {
  const m = MeshBuilder.CreateBox(name, { width: x1 - x0, depth: z1 - z0, height: y1 - y0 }, scene);
  m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  m.material = toonMat(scene, color);
  m.receiveShadows = true;
  m.isPickable = false;
  addCaster(m);
  colliders.addBox(x0, y0, z0, x1, y1, z1, tag);
  return m;
}
function post(name, x, z, r, h, color) {
  const m = MeshBuilder.CreateCylinder(name, { diameter: r * 2, height: h, tessellation: 20 }, scene);
  m.position.set(x, h / 2, z);
  m.material = toonMat(scene, color);
  m.receiveShadows = true;
  addCaster(m);
  colliders.addCylinder(x, z, r, 0, h, "prop");
  return m;
}

const plaza = MeshBuilder.CreateCylinder("plaza", { diameter: 9, height: 0.04, tessellation: 48 }, scene);
plaza.position.set(0, 0.02, -4);
plaza.material = toonMat(scene, PALETTE.plaza);
plaza.receiveShadows = true;

block("curb", -10, 0, 10, 3, 0, 0.15, PALETTE.sidewalk, "sidewalk"); // 0.15 curb / sidewalk
block("step35", -7.5, 6, -4, 9, 0, 0.35, PALETTE.stone); // steppable
block("block60", 4, 6, 7, 8, 0, 0.6, PALETTE.walls[3]); // NOT steppable (0.6)
block("crate", -1, 8, 1, 10, 0, 1.0, PALETTE.wood, "platform"); // jump onto it
block("crateTop", -0.75, 8.25, 0.75, 9.75, 1.0, 1.04, PALETTE.woodDark, "platform");
for (let i = 0; i < 6; i++) block(`stair${i}`, 9, 3 + i * 0.45, 11.5, 3 + (i + 1) * 0.45, 0, 0.3 * (i + 1), i % 2 ? PALETTE.stone : PALETTE.stoneDark, "stairs");
block("ledge", 8.5, 5.7, 14, 14, 0, 1.8, PALETTE.walls[2], "platform"); // walk off its edges
block("highPlatform", -3.2, 13, 0.2, 15.5, 0, 2.6, PALETTE.roofs[0], "platform"); // double-jump target
block("wall", -14, 19, 14, 19.6, 0, 3.2, PALETTE.walls[0], "building");
// Arch: walk under, jump to bonk your head.
block("archL", -11.4, 2.4, -11, 3.6, 0, 2.4, PALETTE.trim);
block("archR", -8, 2.4, -7.6, 3.6, 0, 2.4, PALETTE.trim);
block("archTop", -11.6, 2.3, -7.4, 3.7, 2.4, 2.8, PALETTE.roofs[1]);
post("lamp", -9, 12, 0.18, 3.2, PALETTE.metal);
post("trunk", 5, 13, 0.4, 2.6, PALETTE.trunk);
const canopy = MeshBuilder.CreateSphere("canopy", { diameter: 3.2, segments: 16 }, scene);
canopy.position.set(5, 3.6, 13);
canopy.material = toonMat(scene, PALETTE.foliage[1]);
addCaster(canopy);

// ---- hero ------------------------------------------------------------------------
/** Stand-in hero (used when src/game/character.js doesn't exist yet). */
function createStubCharacter() {
  const root = new TransformNode("heroRoot", scene);
  const pivot = new TransformNode("heroPivot", scene); // somersault around the hips
  pivot.parent = root;
  pivot.position.y = 0.8;
  const body = new TransformNode("heroBody", scene);
  body.parent = pivot;
  body.position.y = -0.8;
  const part = (mesh, color, x, y, z) => {
    mesh.parent = body;
    mesh.position.set(x, y, z);
    mesh.material = toonMat(scene, color);
    mesh.isPickable = false;
    return mesh;
  };
  part(MeshBuilder.CreateCapsule("torso", { radius: 0.3, height: 0.95, tessellation: 16 }, scene), PALETTE.shirts[1], 0, 0.62, 0);
  part(MeshBuilder.CreateSphere("head", { diameter: 0.62, segments: 16 }, scene), PALETTE.skin[0], 0, 1.3, 0);
  part(MeshBuilder.CreateSphere("eyeL", { diameter: 0.09, segments: 8 }, scene), "#1d2b3a", -0.11, 1.36, 0.27);
  part(MeshBuilder.CreateSphere("eyeR", { diameter: 0.09, segments: 8 }, scene), "#1d2b3a", 0.11, 1.36, 0.27);
  part(MeshBuilder.CreateSphere("nose", { diameter: 0.1, segments: 8 }, scene), "#f4a88a", 0, 1.28, 0.31);
  part(MeshBuilder.CreateSphere("cap", { diameter: 0.66, segments: 16, slice: 0.5 }, scene), PALETTE.shirts[0], 0, 1.36, 0);
  part(MeshBuilder.CreateBox("brim", { width: 0.42, height: 0.04, depth: 0.25 }, scene), PALETTE.shirts[0], 0, 1.38, 0.33);
  const meshes = root.getChildMeshes();

  let state = "idle";
  let phase = 0;
  let oneShot = 0;
  return {
    root,
    meshes,
    get state() {
      return state;
    },
    setState(s) {
      state = s;
      if (s === "doubleJump" || s === "land") oneShot = 0;
    },
    update(dt, { speed = 0 } = {}) {
      phase += dt * (2 + speed * 2.2);
      oneShot += dt;
      const gait = Math.min(1, speed / 4.6);
      body.position.y = -0.8 + Math.abs(Math.sin(phase)) * 0.07 * gait;
      body.rotation.z = Math.sin(phase) * 0.06 * gait;
      pivot.rotation.x = state === "doubleJump" && oneShot < 0.45 ? (oneShot / 0.45) * Math.PI * 2 : 0;
      const squash = state === "land" ? 1 - 0.18 * Math.max(0, 1 - oneShot / 0.18) : state === "jump" ? 1.07 : 1;
      body.scaling.set(1 / Math.sqrt(squash), squash, 1 / Math.sqrt(squash));
    },
    setLookAt() {},
    dispose() {
      root.dispose();
    },
  };
}

let hero = null;
if (characterModules["/src/game/character.js"]) {
  try {
    const { createCharacter } = await characterModules["/src/game/character.js"]();
    hero = createCharacter(scene, { name: "Pip", preset: "hero", outline: true, lod: "high" });
  } catch (err) {
    console.warn("character module failed, using stand-in", err);
    hero = null;
  }
}
if (!hero) hero = createStubCharacter();
addCaster(hero.root);

// ---- controls under test --------------------------------------------------------------
const input = createInput(scene, canvas, { events, touch: params.get("touch") === "1" ? true : undefined });
const player = createPlayer(scene, hero, input, colliders, { spawn: new Vector3(0, 0, -4), heading: 0, bounds, events });
const rig = createCameraRig(scene, canvas, player, input, colliders, { quality: "high", events });
env?.setupPostProcessing?.(rig.camera);
scene.activeCamera = rig.camera;

// "C" resets the camera (the HUD owns this key in the real game).
window.addEventListener("keydown", (e) => {
  if (e.code === "KeyC") events.emit("camera:reset");
});

const camMode = params.get("cam");
if (camMode === "intro" || camMode === "swoop") rig.setIntro(true);
if (camMode === "intro" || camMode === "swoop") player.enabled = false;

// ---- autopilot ---------------------------------------------------------------------
// Each step: { go:[x,z], run, tol, timeout, jumpWhen(p), double } | { wait } | { jump, double }.
const SCRIPTS = {
  walk: [{ wait: 0.3 }, { go: [0, 1.5] }, { go: [-5.7, 7.5], run: true }, { wait: 0.3 }, { go: [5.5, 7.2], timeout: 2.6 }, { wait: 5 }],
  jump: [{ go: [0, 5.2] }, { go: [0, 8.6], run: true, jumpWhen: (p) => p.z > 6.4 }, { wait: 0.4 }, { go: [-1.2, 14.4], run: true, jumpWhen: (p) => p.z > 9.55, double: true, timeout: 2.5 }, { wait: 5 }],
  stairs: [{ go: [10.25, 2.4], run: true }, { go: [10.25, 7.5] }, { go: [11, 11] }, { go: [6.5, 11.5] }, { wait: 5 }],
  double: [{ wait: 0.5 }, { jump: true, double: true }, { wait: 5 }],
  wall: [{ go: [2, 18.5], run: true, timeout: 3.5 }, { go: [13, 18.4], run: true, timeout: 2 }, { wait: 5 }],
  bonk: [{ go: [-9.5, 0], run: true }, { go: [-9.5, 3] }, { jump: true }, { wait: 5 }],
  tour: [
    { go: [0, 5.2] },
    { go: [0, 8.6], run: true, jumpWhen: (p) => p.z > 6.4 },
    { wait: 0.3 },
    { go: [-1.2, 14.4], run: true, jumpWhen: (p) => p.z > 9.55, double: true, timeout: 2.5 },
    { go: [-1.5, 17], run: true, timeout: 2.5 },
    { go: [9, 17], run: true },
    { go: [11, 11], run: true },
    { wait: 5 },
  ],
};

function makeAutopilot(script) {
  let i = 0;
  let stepT = 0;
  let jumped = false;
  let doubled = false;
  const steer = (dx, dz, mag, run) => {
    const yaw = rig.yaw;
    const s = Math.sin(yaw);
    const c = Math.cos(yaw);
    input.moveZ = (dx * s + dz * c) * mag;
    input.moveX = (dx * c - dz * s) * mag;
    input.run = !!run;
  };
  return (dt) => {
    input.moveX = 0;
    input.moveZ = 0;
    input.run = false;
    const step = script[i];
    if (!step) return;
    const first = stepT === 0;
    stepT += dt;
    const p = player.position;
    let done = false;
    if (first) {
      jumped = false;
      doubled = false;
    }
    if (step.go) {
      const dx = step.go[0] - p.x;
      const dz = step.go[1] - p.z;
      const d = Math.hypot(dx, dz);
      if ((d < (step.tol ?? 0.3) && player.grounded) || stepT > (step.timeout ?? 8)) done = true;
      else steer(dx / d, dz / d, Math.min(1, 0.25 + d / 0.9), step.run);
    }
    if ((step.jump && first) || (step.jumpWhen && !jumped && step.jumpWhen(p))) {
      input.pressJump();
      jumped = true;
    }
    if (step.double && jumped && !doubled && !player.grounded && player.velocity.y < 0.4) {
      input.pressJump();
      doubled = true;
    }
    if (step.wait != null && stepT >= step.wait) done = true;
    if (step.jump && !step.go && step.wait == null && stepT > 1.2) done = true;
    if (done) {
      i++;
      stepT = 0;
    }
  };
}
const autopilot = SCRIPTS[autoName] ? makeAutopilot(SCRIPTS[autoName]) : null;

// ---- synthetic touch presses (?press=ne,jump,run) ---------------------------------------
const DIRS = { e: 0, ne: 45, n: 90, nw: 135, w: 180, sw: 225, s: 270, se: 315 };
function synthesizePresses() {
  const list = (params.get("press") || "").split(",").filter(Boolean);
  let id = 40;
  for (const what of list) {
    const target = what === "jump" ? document.querySelector(".tc-jump") : what === "run" ? document.querySelector(".tc-run") : document.querySelector(".tc-dpad");
    if (!target) continue;
    const r = target.getBoundingClientRect();
    let x = r.left + r.width / 2;
    let y = r.top + r.height / 2;
    if (what in DIRS) {
      const a = (DIRS[what] * Math.PI) / 180;
      x += Math.cos(a) * r.width * 0.33;
      y -= Math.sin(a) * r.height * 0.33;
    }
    target.dispatchEvent(new PointerEvent("pointerdown", { pointerId: id++, pointerType: "touch", clientX: x, clientY: y, bubbles: true, cancelable: true, isPrimary: id === 41 }));
  }
}

// ---- loop --------------------------------------------------------------------------------
const info = document.getElementById("info");
const counts = { jump: 0, double: 0, land: 0, footstep: 0 };
let lastEvent = "";
events.on("player:jump", (e) => {
  counts[e.double ? "double" : "jump"]++;
  lastEvent = e.double ? "double jump!" : "jump";
});
events.on("player:land", (e) => {
  counts.land++;
  lastEvent = `land ${e.impact.toFixed(1)} m/s`;
});
events.on("player:footstep", () => counts.footstep++);

// Scripted runs use a fixed 60 Hz step and may simulate several steps per
// rendered frame (?steps=N, default 40) so slow software-GL screenshots still
// reach the interesting moment; interactive runs use real frame time.
const fixedStep = autoName || params.has("freeze") || params.has("press") || camMode;
const stepsPerFrame = fixedStep ? Math.max(1, num("steps", 40)) : 1;
let simTime = 0;
let frame = 0;
function simulate(dt) {
  {
    simTime += dt;
    input.update(dt);
    autopilot?.(dt);
    player.update(dt, rig.yaw);
    if (frame === 1) {
      if (params.has("alpha")) rig.camera.alpha = num("alpha", 0);
      if (params.has("beta")) rig.camera.beta = num("beta", 1.15);
      if (params.has("radius")) rig.camera.radius = num("radius", 9);
    }
    if (frame === 2 && params.has("press")) synthesizePresses();
    if (camMode === "swoop" && Math.abs(simTime - 1) < dt / 2) {
      rig.setIntro(false);
      player.enabled = true;
    }
    rig.update(dt);
    env?.update?.(dt, player.position);
    frame++;
  }
}
engine.runRenderLoop(() => {
  const dt = fixedStep ? 1 / 60 : Math.min(engine.getDeltaTime() / 1000, 1 / 20);
  for (let i = 0; i < stepsPerFrame && simTime < freezeAt - 1e-9; i++) simulate(dt);
  if (showInfo) {
    const p = player.position;
    info.textContent =
      `t ${simTime.toFixed(2)}s  ${engine.getFps().toFixed(0)} fps  device ${input.device}\n` +
      `pos ${p.x.toFixed(2)} ${p.y.toFixed(2)} ${p.z.toFixed(2)}  speed ${player.speed.toFixed(2)}\n` +
      `${player.grounded ? "grounded" : "airborne"}  vy ${player.velocity.y.toFixed(2)}  state ${hero.state}\n` +
      `yaw ${rig.yaw.toFixed(2)}  r ${rig.camera.radius.toFixed(2)}  move ${input.moveX.toFixed(2)},${input.moveZ.toFixed(2)}${input.run ? " RUN" : ""}${input.jumpHeld ? " JUMP" : ""}\n` +
      `jumps ${counts.jump} doubles ${counts.double} lands ${counts.land} steps ${counts.footstep}  ${lastEvent}`;
  }
  scene.render();
});

if (params.has("debug")) console.log(`viewport ${innerWidth}x${innerHeight} dpr ${devicePixelRatio}`);
window.preview = { scene, engine, input, player, rig, colliders, hero, events };

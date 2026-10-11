// Environment preview: a stand-in mini town (ground, houses, trees, lamps,
// a "hero" capsule) lit by the real environment module.
import { ArcRotateCamera, Color3, Engine, Mesh, MeshBuilder, Scene, Vector3 } from "@babylonjs/core";
import { events } from "/src/game/events.js";
import { PALETTE, makeRng, pick } from "/src/game/palette.js";
import { toonMat, uniqueMat } from "/src/game/materials.js";
import { createEnvironment } from "/src/game/environment.js";

const params = new URLSearchParams(location.search);
const num = (k, d) => (params.has(k) ? Number(params.get(k)) : d);
const quality = params.get("quality") || "high";

const canvas = document.getElementById("c");
const engine = new Engine(canvas, true, { stencil: true }, false);
engine.resize();
window.addEventListener("resize", () => engine.resize());
const scene = new Scene(engine);

const env = createEnvironment(scene, engine, { quality, events, ssao: params.has("ssao") });

// ---- stand-in town ------------------------------------------------------------
const rng = makeRng(7);
const ground = MeshBuilder.CreateGround("ground", { width: 700, height: 700, subdivisions: 2 }, scene);
ground.material = toonMat(scene, PALETTE.grass);
ground.receiveShadows = true;

const road = MeshBuilder.CreateGround("road", { width: 9, height: 240 }, scene);
road.position.set(0, 0.02, 0);
road.material = toonMat(scene, PALETTE.road);
road.receiveShadows = true;
const road2 = MeshBuilder.CreateGround("road2", { width: 240, height: 9 }, scene);
road2.position.set(0, 0.021, 18);
road2.material = toonMat(scene, PALETTE.road);
road2.receiveShadows = true;
const plaza = MeshBuilder.CreateCylinder("plaza", { diameter: 22, height: 0.1, tessellation: 40 }, scene);
plaza.position.set(-16, 0.05, -6);
plaza.material = toonMat(scene, PALETTE.plaza);
plaza.receiveShadows = true;

const windowMat = uniqueMat(scene, "windows", PALETTE.windowDay, { emissive: "#000000" });
const lampMat = uniqueMat(scene, "lampBulb", PALETTE.lampGlow, { emissive: "#000000" });
const litWindow = Color3.FromHexString(PALETTE.windowLit);
const dayWindow = Color3.FromHexString(PALETTE.windowDay);
const lampGlow = Color3.FromHexString(PALETTE.lampGlow);

function house(x, z, w, d, h, i) {
  const body = MeshBuilder.CreateBox("house", { width: w, depth: d, height: h }, scene);
  body.position.set(x, h / 2, z);
  body.material = toonMat(scene, pick(PALETTE.walls, i));
  const roof = MeshBuilder.CreateCylinder("roof", { diameterTop: 0, diameterBottom: Math.max(w, d) * 1.5, height: h * 0.6, tessellation: 4 }, scene);
  roof.rotation.y = Math.PI / 4;
  roof.scaling.set(w / Math.max(w, d), 1, d / Math.max(w, d));
  roof.position.set(x, h + h * 0.3, z);
  roof.material = toonMat(scene, pick(PALETTE.roofs, i + 2));
  for (let k = 0; k < 2; k++) {
    const win = MeshBuilder.CreatePlane("win", { width: 1.2, height: 1.4 }, scene);
    win.position.set(x - w / 4 + (k * w) / 2, h * 0.55, z - d / 2 - 0.02);
    win.material = windowMat;
  }
  const door = MeshBuilder.CreatePlane("door", { width: 1.3, height: 2.2 }, scene);
  door.position.set(x, 1.1, z - d / 2 - 0.02);
  door.material = toonMat(scene, PALETTE.door);
  env.addShadowCaster(body);
  env.addShadowCaster(roof);
  body.receiveShadows = true;
  roof.receiveShadows = true;
}

function tree(x, z, s) {
  const trunk = MeshBuilder.CreateCylinder("trunk", { diameterTop: 0.5 * s, diameterBottom: 0.8 * s, height: 2.6 * s, tessellation: 10 }, scene);
  trunk.position.set(x, 1.3 * s, z);
  trunk.material = toonMat(scene, PALETTE.trunk);
  const crown = MeshBuilder.CreateSphere("crown", { diameter: 3.6 * s, segments: 12 }, scene);
  crown.position.set(x, 3.6 * s, z);
  crown.material = toonMat(scene, pick(PALETTE.foliage, Math.floor(x * 7 + z)));
  const crown2 = MeshBuilder.CreateSphere("crown2", { diameter: 2.4 * s, segments: 10 }, scene);
  crown2.position.set(x + 0.6 * s, 4.9 * s, z - 0.3 * s);
  crown2.material = crown.material;
  for (const m of [trunk, crown, crown2]) {
    env.addShadowCaster(m);
    m.receiveShadows = true;
  }
}

function lamp(x, z) {
  const post = MeshBuilder.CreateCylinder("lampPost", { diameter: 0.18, height: 3.6, tessellation: 8 }, scene);
  post.position.set(x, 1.8, z);
  post.material = toonMat(scene, PALETTE.metal);
  const bulb = MeshBuilder.CreateSphere("lampBulb", { diameter: 0.6, segments: 10 }, scene);
  bulb.position.set(x, 3.75, z);
  bulb.material = lampMat;
  env.addShadowCaster(post);
}

const houses = [
  [-14, 30, 8, 7, 6], [-3 - 10, 6, 7, 6, 5], [12, 30, 9, 8, 7], [14, 6, 8, 7, 5.5], [26, 30, 7, 7, 8],
  [-28, 30, 8, 6, 5], [28, 6, 7, 7, 6], [-30, 6, 8, 7, 7], [12, -14, 8, 8, 6], [26, -14, 7, 6, 5], [40, 30, 9, 7, 6],
  [-42, 30, 7, 7, 6], [42, 6, 8, 6, 7], [-44, 6, 7, 7, 5], [12, -32, 8, 7, 6], [-12, -32, 8, 7, 7], [26, -32, 7, 6, 5],
  [-30, -30, 9, 8, 6], [40, -14, 8, 7, 7], [55, 30, 8, 7, 6], [-56, 30, 8, 7, 6], [56, 6, 7, 7, 5], [-58, 6, 7, 7, 6],
];
houses.forEach(([x, z, w, d, h], i) => house(x, z, w, d, h, i));
for (let i = 0; i < 26; i++) {
  const x = (rng() - 0.5) * 140;
  const z = (rng() - 0.5) * 140;
  if (Math.abs(x) < 7 || Math.abs(z - 18) < 7) continue;
  if (houses.some(([hx, hz, w, d]) => Math.abs(x - hx) < w / 2 + 3 && Math.abs(z - hz) < d / 2 + 3)) continue;
  tree(x, z, 0.8 + rng() * 0.6);
}
for (let z = -40; z <= 40; z += 16) lamp(5.5, z);
for (let x = -40; x <= 40; x += 16) lamp(x, 23.5);

// Distant hills (show the fog fade).
for (let i = 0; i < 9; i++) {
  const a = (i / 9) * Math.PI * 2 + 0.3;
  const hill = MeshBuilder.CreateSphere("hill", { diameter: 90 + rng() * 60, segments: 16 }, scene);
  hill.scaling.y = 0.32;
  hill.position.set(Math.cos(a) * 150, -6, Math.sin(a) * 150);
  hill.material = toonMat(scene, i % 2 ? PALETTE.grassDark : PALETTE.grass);
  hill.receiveShadows = true;
}

// "Hero" + a few props near the focus point.
const hero = MeshBuilder.CreateCapsule("hero", { height: 1.6, radius: 0.35 }, scene);
hero.position.set(-2, 0.8, -4);
hero.material = toonMat(scene, PALETTE.shirts[0]);
env.addShadowCaster(hero);
const ball = MeshBuilder.CreateSphere("ball", { diameter: 1.4, segments: 20 }, scene);
ball.position.set(-5, 0.7, -2);
ball.material = toonMat(scene, PALETTE.shirts[1]);
env.addShadowCaster(ball);
const crate = MeshBuilder.CreateBox("crate", { size: 1.4 }, scene);
crate.position.set(-8, 0.7, -5);
crate.rotation.y = 0.5;
crate.material = toonMat(scene, PALETTE.wood);
env.addShadowCaster(crate);
crate.receiveShadows = true;
const fountain = MeshBuilder.CreateCylinder("fountain", { diameter: 6, height: 1, tessellation: 32 }, scene);
fountain.position.set(-16, 0.5, -6);
fountain.material = toonMat(scene, PALETTE.stone);
env.addShadowCaster(fountain);
fountain.receiveShadows = true;
const water = MeshBuilder.CreateCylinder("water", { diameter: 5.2, height: 0.1, tessellation: 32 }, scene);
water.position.set(-16, 0.98, -6);
water.material = toonMat(scene, PALETTE.water, { specular: 0.4 });

// Inverted-hull "toon outline" test figures (like the character module bakes):
// a capsule plus a slightly bigger copy with flipped winding. One is flagged
// metadata.shadowFrontFaces (as skinned characters are treated automatically).
function hulled(name, x, z, flag) {
  const body = MeshBuilder.CreateSphere(name, { diameterX: 0.7, diameterY: 1.7, diameterZ: 0.7, segments: 16 }, scene);
  body.material = toonMat(scene, PALETTE.shirts[4]);
  body.position.set(x, 0.85, z);
  const hull = MeshBuilder.CreateSphere(name + "Hull", { diameterX: num("hw", 0.78), diameterY: 1.0 + num("hw", 0.78), diameterZ: num("hw", 0.78), segments: 16, sideOrientation: Mesh.BACKSIDE }, scene);
  hull.material = toonMat(scene, PALETTE.ui.dark);
  hull.parent = body;
  body.receiveShadows = true;
  hull.receiveShadows = true;
  if (flag) body.metadata = hull.metadata = { shadowFrontFaces: true };
  env.addShadowCaster(body, true);
  return body;
}
if (params.has("hull")) {
  hulled("outlined", 0.2, -3.5, true); // right of the hero: flagged (correct)
  hulled("outlinedNoFlag", -4.2, -3.5, false); // left: unflagged (shows the self-shadow problem)
  const flag = MeshBuilder.CreatePlane("flag", { width: 1.6, height: 1 }, scene);
  flag.position.set(-1, 2.6, -8);
  flag.rotation.y = 0.6;
  flag.material = toonMat(scene, PALETTE.flowers[0], { backFaceCulling: false });
  env.addShadowCaster(flag);
}

for (const m of scene.meshes) {
  m.isPickable = false;
  if (!m.name.startsWith("sky") && m.name !== "clouds") m.freezeWorldMatrix();
}

// ---- camera ------------------------------------------------------------------
// view=game mimics the follow cam (radius 9, beta 1.15, fov 0.85, target at the hero's chest).
const game = params.get("view") === "game";
const heroPos = new Vector3(-2, 0, -4);
const camera = game
  ? new ArcRotateCamera("cam", num("alpha", -2.1), num("beta", 1.15), num("radius", 9), heroPos.add(new Vector3(0, 1.25, 0)), scene)
  : new ArcRotateCamera("cam", num("alpha", -2.1), num("beta", 1.36), num("radius", 26), new Vector3(-4, num("ty", 4), 2), scene);
camera.minZ = 0.3;
camera.maxZ = 600; // env should raise this so the clouds fit
camera.fov = num("fov", game ? 0.85 : 0.9);
camera.attachControl(canvas, true);
camera.inputs.removeByType("ArcRotateCameraKeyboardMoveInput");
scene.activeCamera = camera;
if (params.get("post") !== "0") env.setupPostProcessing(camera);

// Freeze the clock at ?time=H (fixed mode holds whatever time is set).
if (params.has("time")) {
  if (!params.has("cycle")) events.emit("settings:daynight", { mode: "day" });
  env.setTimeOfDay(num("time", 12));
}
if (params.has("q2")) {
  setTimeout(() => {
    events.emit("settings:quality", { level: params.get("q2") });
    console.log(`[preview] quality -> ${params.get("q2")}`);
  }, 300);
}

// Look-dev overrides (preview only): tm=0 disables tone mapping, con/exp/sat tweak the grade.
{
  const ipc = scene.imageProcessingConfiguration;
  if (params.get("tm") === "0") ipc.toneMappingEnabled = false;
  if (params.has("con")) ipc.contrast = num("con", 1);
  if (params.has("exp")) ipc.exposure = num("exp", 1);
  if (params.has("sat")) {
    ipc.colorCurvesEnabled = true;
    ipc.colorCurves.globalSaturation = num("sat", 0);
  }
}

// ---- loop --------------------------------------------------------------------
const info = document.getElementById("info");
if (params.get("hud") === "0") info.style.display = "none";
const focus = heroPos.clone();
let frames = 0;
let drawsBefore = 0;
engine.runRenderLoop(() => {
  if (frames === 10) drawsBefore = engine._drawCalls?.current ?? 0;
  const dt = Math.min(engine.getDeltaTime() / 1000, 0.05);
  env.update(dt, focus);
  const n = env.nightFactor;
  Color3.LerpToRef(Color3.BlackReadOnly, litWindow, n * 1.0, windowMat.emissiveColor);
  Color3.LerpToRef(dayWindow, litWindow, n, windowMat.diffuseColor);
  lampGlow.scaleToRef(0.15 + n * 1.25, lampMat.emissiveColor);
  scene.render();
  if (++frames % 10 === 0) {
    const h = env.timeOfDay;
    info.textContent = `${String(Math.floor(h)).padStart(2, "0")}:${String(Math.floor((h % 1) * 60)).padStart(2, "0")}  night ${n.toFixed(2)}  ${quality}  fps ${engine.getFps().toFixed(0)}  draws ${engine._drawCalls?.current ?? "?"}`;
  }
  if (frames === 11) {
    const casters = env.shadowGenerator.getShadowMap()?.renderList?.length ?? 0;
    console.log(`[preview] draw calls in one frame: ${(engine._drawCalls?.current ?? 0) - drawsBefore} (shadow casters ${casters}, meshes ${scene.meshes.length})`);
  }
  if (frames === 3 || frames === 30) console.log(`[preview] t=${env.timeOfDay.toFixed(2)} night=${n.toFixed(2)} meshes=${scene.meshes.length} pipeline=${!!scene.postProcessRenderPipelineManager.supportedPipelines.length}`);
});

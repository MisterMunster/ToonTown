// Visual test page for src/game/character.js (see character.html for params).
import {
  Engine, Scene, Color3, Color4, Vector3, ArcRotateCamera, HemisphericLight, DirectionalLight,
  ShadowGenerator, MeshBuilder, StandardMaterial, SceneInstrumentation,
} from "@babylonjs/core";
import { createCharacter } from "/src/game/character.js";
import { PALETTE } from "/src/game/palette.js";

const q = new URLSearchParams(location.search);
const num = (k, d) => (q.has(k) && Number.isFinite(Number(q.get(k))) ? Number(q.get(k)) : d);

const canvas = document.getElementById("c");
const engine = new Engine(canvas, true, { stencil: true, preserveDrawingBuffer: true }, false);
engine.resize();
window.addEventListener("resize", () => engine.resize());
const scene = new Scene(engine);
scene.clearColor = Color4.FromHexString(PALETTE.sky + "ff");
scene.ambientColor = new Color3(0.25, 0.25, 0.3);

const hemi = new HemisphericLight("hemi", new Vector3(0, 1, 0), scene);
hemi.intensity = 0.62;
hemi.diffuse = Color3.FromHexString("#fff6e8");
hemi.groundColor = Color3.FromHexString("#8fa6c0");
const sun = new DirectionalLight("sun", new Vector3(-0.55, -1, -0.65).normalize(), scene);
sun.position = new Vector3(6, 12, 8);
sun.intensity = 0.95;
sun.diffuse = Color3.FromHexString("#fff1d6");
const sg = new ShadowGenerator(1024, sun);
sg.useBlurExponentialShadowMap = false;
sg.usePercentageCloserFiltering = true;
sg.bias = 0.002;
sg.normalBias = 0.01;

const ground = MeshBuilder.CreateDisc("ground", { radius: 14, tessellation: 64 }, scene);
ground.rotation.x = Math.PI / 2;
const gm = new StandardMaterial("gm", scene);
gm.diffuseColor = Color3.FromHexString(PALETTE.grass);
gm.specularColor = new Color3(0, 0, 0);
ground.material = gm;
ground.receiveShadows = true;

const lineup = q.get("lineup") === "1";
const strip = Math.max(0, Math.floor(num("strip", 0)));
const chars = [];
const makeOne = () => {
  const preset = q.get("preset") ?? "hero";
  return createCharacter(scene, {
    name: preset === "hero" ? "Pip" : undefined,
    preset,
    seed: num("seed", 1),
    lod: q.get("lod") ?? (preset === "hero" ? "high" : "low"),
    outline: q.has("outline") ? q.get("outline") === "1" : preset === "hero",
    hairStyle: q.get("hair") ?? undefined,
    headwear: q.get("headwear") ?? undefined,
    accessory: q.get("acc") ?? undefined,
    mustache: q.has("stache") ? q.get("stache") === "1" : undefined,
  });
};
if (strip) {
  // filmstrip: N copies laid out along the camera's right vector, copy i is
  // simulated i*dt further (so one shot shows a whole motion)
  const camAlpha = ({ front: Math.PI / 2, tq: Math.PI / 2 - 0.62, side: 0, back: -Math.PI / 2 + 0.4 })[q.get("cam") ?? "tq"] ?? 0;
  for (let i = 0; i < strip; i++) {
    const c = makeOne();
    const k = (i - (strip - 1) / 2) * num("gap", 0.95);
    c.root.position.x = -Math.sin(camAlpha) * k;
    c.root.position.z = Math.cos(camAlpha) * k;
    c.root.position.y = num("y", 0);
    chars.push(c);
  }
} else if (lineup) {
  const hero = createCharacter(scene, { name: "Pip", preset: "hero", outline: true, lod: "high" });
  hero.root.position.x = 0;
  chars.push(hero);
  const n = 8;
  for (let i = 0; i < n; i++) {
    const c = createCharacter(scene, { preset: "random", seed: num("seed", 1) + i, lod: q.get("lod") ?? "low", outline: false });
    const slot = i < n / 2 ? -(i + 1) : i - n / 2 + 1;
    c.root.position.x = slot * 0.95;
    c.root.position.z = -Math.abs(slot) * 0.12;
    c.root.rotation.y = -slot * 0.06;
    chars.push(c);
  }
} else {
  const c = makeOne();
  c.root.position.y = num("y", 0);
  c.root.rotation.y = num("yaw", 0);
  chars.push(c);
}
for (const c of chars) for (const m of c.meshes) sg.addShadowCaster(m);
if (q.has("look")) {
  const [x, y, z] = q.get("look").split(",").map(Number);
  for (const c of chars) c.setLookAt(new Vector3(x, y, z));
}

// camera presets
const cam = q.get("cam") ?? (lineup ? "front" : "tq");
const presets = {
  front: [Math.PI / 2, 1.42, 4.2, 0.82],
  tq: [Math.PI / 2 - 0.62, 1.36, 4.2, 0.82],
  side: [0, 1.45, 4.2, 0.82],
  back: [-Math.PI / 2 + 0.4, 1.3, 4.2, 0.82],
  face: [Math.PI / 2 - 0.35, 1.45, 1.35, 1.2],
  facefront: [Math.PI / 2, 1.5, 1.3, 1.2],
  top: [Math.PI / 2 - 0.5, 0.75, 5, 0.8],
  low: [Math.PI / 2 - 0.5, 1.75, 3.6, 1.0],
  game: [Math.PI / 2 + 2.6, 1.15, 8.5, 1.0],
};
const [alpha, beta, radius, ty] = presets[cam] ?? presets.tq;
const camRadius = strip ? (strip * num("gap", 0.95)) / 2.2 + 0.4 : lineup ? radius * 1.35 : radius;
const camera = new ArcRotateCamera("cam", alpha, beta, num("r", camRadius), new Vector3(0, lineup ? 0.85 : ty + num("y", 0) * 0.6, 0), scene);
camera.fov = 0.7;
camera.minZ = 0.05;
if (q.has("alpha")) camera.alpha = num("alpha", alpha);
camera.attachControl(canvas, true);
camera.inputs.removeByType("ArcRotateCameraKeyboardMoveInput");
camera.wheelDeltaPercentage = 0.01;

// animation driving
const state = q.get("state") ?? "idle";
const speed = num("speed", state === "walk" ? 3 : state === "run" ? 7 : 0);
for (const c of chars) c.setState(state);
const step = (dt, s) => {
  for (let i = 0; i < chars.length; i++) chars[i].update(dt, { speed: s ?? speed });
};
const stepOne = (c, dt) => c.update(dt, { speed });
if (q.has("blinkshot")) {
  // advance until the (random) blink logic has the lids mostly closed, then freeze
  const target = num("blinkshot", 0.25);
  for (let i = 0; i < 1200 && chars[0].nodes.lidL.rotation.x < target; i++) step(1 / 120);
}
const frozen = q.has("t") || q.has("seq") || strip > 0 || q.has("blinkshot");
if (q.has("seq")) {
  for (const part of q.get("seq").split(",")) {
    const [s, dur] = part.split(":");
    for (const c of chars) c.setState(s);
    const steps = Math.round(Number(dur) * 60);
    for (let i = 0; i < steps; i++) step(1 / 60);
  }
} else if (q.has("t")) {
  const steps = Math.round(num("t", 0) * 60);
  for (let i = 0; i < steps; i++) step(1 / 60);
}
if (strip) {
  // advance copy i by i*dt more (in small steps)
  const dtStrip = num("dt", 0.05);
  chars.forEach((c, i) => {
    let left = i * dtStrip;
    while (left > 1e-6) {
      const h = Math.min(1 / 120, left);
      stepOne(c, h);
      left -= h;
    }
  });
}

const inst = new SceneInstrumentation(scene);
inst.captureFrameTime = true;
const info = document.getElementById("info");
let frames = 0;
scene.onAfterRenderObservable.add(() => {
  frames++;
  if (frames === 3) {
    const msg = `chars=${chars.length} drawCalls=${inst.drawCallsCounter.current} verts=${scene.getTotalVertices()} state=${chars[0].state}`;
    info.textContent = msg;
    console.log("[preview]", msg);
  }
});

engine.runRenderLoop(() => {
  if (!frozen) step(Math.min(engine.getDeltaTime() / 1000, 0.05));
  scene.render();
});
window.preview = { scene, chars, camera };

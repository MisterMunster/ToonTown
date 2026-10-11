// HUD preview: a tiny Babylon backdrop town + the real HUD driven by fake
// map data and a fake animated state. See hud.html for the query params.
import "@fontsource/fredoka/400.css";
import "@fontsource/fredoka/500.css";
import "@fontsource/fredoka/600.css";
import "@fontsource/fredoka/700.css";
import "/src/ui/base.css";

import {
  Engine, Scene, Color4, Vector3, ArcRotateCamera, HemisphericLight, DirectionalLight,
  CreateGround, CreateBox, CreateCylinder, CreateSphere,
} from "@babylonjs/core";
import { events } from "/src/game/events.js";
import { toonMat } from "/src/game/materials.js";
import { PALETTE } from "/src/game/palette.js";
import { createHUD } from "/src/ui/hud.js";
import { createInput } from "/src/game/input.js";
import { ICONS, ITEM_ICONS, PIP_PORTRAIT } from "/src/ui/icons.js";

const params = new URLSearchParams(location.search);
const screen = params.get("screen") || "hud";
const touch = params.get("touch") === "1";
const at = Number(params.get("at")) || 5000;
const quality = params.get("quality") || "high";
const realTown = params.get("town") === "real"; // town=real: use src/game/town.js for the map + backdrop
let timeOfDay = Number(params.get("time")) || 16;
// Headless screenshots only get a handful of animation frames, so by default
// CSS transitions are disabled and Web Animations are seeked to a
// representative moment (still=0 restores normal motion).
const still = params.get("still") !== "0";
if (still) {
  const style = document.createElement("style");
  style.textContent = ".tt-hud *, .tt-hud *::before, .tt-hud *::after { transition: none !important; }";
  document.head.appendChild(style);
}
function settleAnimations() {
  if (!still || !document.getAnimations) return;
  for (const a of document.getAnimations()) {
    if (a instanceof CSSAnimation || a instanceof CSSTransition) continue;
    const d = a.effect && a.effect.getTiming().duration;
    if (typeof d !== "number") continue;
    if (d >= 2000) {
      a.currentTime = d * 0.4;
      a.pause();
    } else a.finish();
  }
}

// touch=1: the real on-screen controls from src/game/input.js (built once the
// scene exists, below) so overlaps with the HUD are checked against the real thing.
const zoneName = params.get("zone") || "Town Square"; // zone=Residential%20Lane = longest name

// ---- fake town (shared by the 3D backdrop and the minimap) ----------------
const W = PALETTE.walls;
const R = PALETTE.roofs;
const buildings = [
  [24, 20, 12, 10, W[0], R[0], 7], [40, 22, 10, 12, W[1], R[1], 9], [-22, 20, 12, 10, W[2], R[2], 8],
  [-40, 22, 10, 10, W[3], R[3], 6], [24, -20, 12, 12, W[4], R[4], 7], [42, -24, 12, 14, W[5], R[5], 10],
  [-12, 46, 10, 8, W[6], R[0], 6], [12, 46, 10, 8, W[7], R[1], 6], [0, 58, 22, 12, "#f6e7c8", "#5d7be0", 11],
  [62, 18, 10, 10, W[2], R[3], 7], [62, -8, 10, 12, W[0], R[4], 8], [-62, -8, 12, 10, W[5], R[5], 6],
  [-60, 24, 10, 10, W[1], R[2], 7], [8, -44, 14, 10, W[3], R[0], 7], [-14, -46, 10, 10, W[4], R[1], 6],
];
const features = [];
// roads + sidewalks
const road = (x, z, w, d) => {
  features.push({ kind: "sidewalk", x, z, w: w + (w > d ? 0 : 6), d: d + (d > w ? 0 : 6), color: PALETTE.sidewalk });
  features.push({ kind: "road", x, z, w, d, color: PALETTE.road });
};
road(0, 0, 170, 9);
road(0, 0, 9, 170);
road(50, 0, 8, 120);
road(-50, 0, 8, 120);
road(0, 34, 100, 7);
road(0, -32, 100, 7);
features.push({ kind: "plaza", x: 0, z: 17, w: 26, d: 22, color: PALETTE.plaza });
features.push({ kind: "park", x: -26, z: -17, w: 36, d: 22, color: PALETTE.grass });
features.push({ kind: "water", x: -30, z: -18, w: 14, d: 9, color: PALETTE.water });
features.push({ kind: "water", x: 0, z: 17, w: 6, d: 6, color: PALETTE.water });
for (const [x, z, w, d, wall] of buildings) features.push({ kind: "building", x, z, w, d, color: wall });
const trees = [[-16, -11], [-38, -10], [-14, -24], [-40, -25], [-22, -9], [-34, -27], [30, 6], [-6, 26], [6, 27], [70, 30], [-70, 12]];
for (const [x, z] of trees) features.push({ kind: "tree", x, z, w: 4, d: 4, color: "#4caf50" });

// dense=1: a row of shop landmarks a few meters apart (like the real town's square)
const denseLandmarks = params.get("dense") === "1"
  ? ["Bookshop", "Toy Shop", "Ice Cream", "Flower Shop", "Cafe", "Bakery", "Post Office", "Grocer", "Bus Stop", "Bandstand"]
      .map((name, i) => ({ name, x: -14 + (i % 5) * 7, z: i < 5 ? 8 : 26 }))
  : [];
const fakeTown = {
  bounds: { minX: -80, maxX: 80, minZ: -70, maxZ: 75 },
  mapFeatures: features,
  landmarks: [
    { name: "Town Hall", x: 0, z: 58 },
    { name: "Fountain", x: 0, z: 17 },
    { name: "Bakery", x: 24, z: 20 },
    { name: "Café", x: -22, z: 20 },
    { name: "Park", x: -26, z: -10 },
    { name: "Library", x: 42, z: -24 },
    { name: "Windmill", x: -62, z: -8 },
    ...denseLandmarks,
  ],
};

// ---- Babylon backdrop -------------------------------------------------------
const canvas = document.getElementById("renderCanvas");
const engine = new Engine(canvas, true, { stencil: true }, false);
engine.resize();
const scene = new Scene(engine);
scene.clearColor = new Color4(0.56, 0.83, 1, 1);
const camera = new ArcRotateCamera("cam", -Math.PI / 2.4, 1.08, 95, new Vector3(0, 0, 8), scene);
const hemi = new HemisphericLight("hemi", new Vector3(0.2, 1, 0.1), scene);
hemi.intensity = 0.75;
const sun = new DirectionalLight("sun", new Vector3(-0.6, -1, 0.4), scene);
sun.intensity = 0.7;

function buildFakeBackdrop() {
const ground = CreateGround("ground", { width: 260, height: 260 }, scene);
ground.material = toonMat(scene, PALETTE.grass);
for (const f of features) {
  if (f.kind === "building" || f.kind === "tree") continue;
  const m = CreateBox(`f_${f.kind}`, { width: f.w, depth: f.d, height: 0.1 }, scene);
  const y = { sidewalk: 0.03, road: 0.06, plaza: 0.09, park: 0.04, water: 0.12 }[f.kind] ?? 0.05;
  m.position.set(f.x, y, f.z);
  m.material = toonMat(scene, f.kind === "park" ? PALETTE.grassDark : f.color);
}
for (const [x, z, w, d, wall, roof, h] of buildings) {
  const b = CreateBox("b", { width: w, depth: d, height: h }, scene);
  b.position.set(x, h / 2, z);
  b.material = toonMat(scene, wall);
  const r = CreateCylinder("r", { height: 4, diameterTop: 0, diameterBottom: Math.max(w, d) * 1.25, tessellation: 4 }, scene);
  r.rotation.y = Math.PI / 4;
  r.scaling.set(w / Math.max(w, d), 1, d / Math.max(w, d));
  r.position.set(x, h + 2, z);
  r.material = toonMat(scene, roof);
}
for (const [x, z] of trees) {
  const t = CreateCylinder("t", { height: 3, diameter: 0.7 }, scene);
  t.position.set(x, 1.5, z);
  t.material = toonMat(scene, PALETTE.trunk);
  const c = CreateSphere("c", { diameter: 5, segments: 10 }, scene);
  c.position.set(x, 4.6, z);
  c.material = toonMat(scene, PALETTE.foliage[(x * 7 + z) & 3]);
}
}

/** Build the real town (stub environment) and return it, or null on failure. */
async function buildRealTown() {
  try {
    const { createTown } = await import("/src/game/town.js");
    const { ColliderWorld } = await import("/src/game/colliders.js");
    const env = {
      sun, hemi, shadowGenerator: null, timeOfDay: 16, nightFactor: 0,
      addShadowCaster() {}, removeShadowCaster() {}, setupPostProcessing() {}, update() {}, setTimeOfDay() {}, setQuality() {},
    };
    const town = createTown(scene, env, new ColliderWorld(8), { quality });
    console.log(`real town: ${town.mapFeatures.length} features, ${town.landmarks.length} landmarks: ${town.landmarks.map((l) => l.name).join(", ")}`);
    return town;
  } catch (err) {
    console.error("real town failed", err);
    return null;
  }
}
if (!realTown) buildFakeBackdrop();

if (touch) createInput(scene, canvas, { events, touch: true });

// ---- HUD ---------------------------------------------------------------------
const hud = createHUD({ root: document.getElementById("hud-root"), events, quality });
events.on("game:pause", (p) => console.log("event game:pause", JSON.stringify(p)));
events.on("hud:slotSelected", (p) => console.log("event hud:slotSelected", p.index, p.item.name));
events.on("hud:useItem", (p) => console.log("event hud:useItem", p.index, p.item.name));

const coinPositions = [];
for (let i = 0; i < 32; i++) {
  const a = i * 2.4;
  const r = 6 + ((i * 37) % 60);
  coinPositions.push({ x: Math.cos(a) * r, z: Math.sin(a) * r });
}
const npcPositions = [{ x: 8, z: 10 }, { x: -10, z: 4 }, { x: 22, z: -6 }, { x: -4, z: 30 }];
const playerPos = { x: 0, y: 0, z: 6 };
const center = { x: 0, z: -2 }; // player walks a circle around this point
const state = {
  playerPos, heading: 0, cameraYaw: 0, timeOfDay, nightFactor: 0, speed: 0, grounded: true, fps: 60,
  npcPositions, coinPositions, coins: 7, coinsTotal: 32,
};

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
/** screen=icons: a large gallery of every icon, to judge the SVG art. */
function showIconGallery() {
  const g = document.createElement("div");
  g.style.cssText = "position:fixed;inset:0;z-index:99;overflow:auto;padding:24px;background:#fffaf0;display:flex;flex-wrap:wrap;gap:18px;align-content:flex-start;font:600 13px Fredoka,sans-serif;color:#1d2b3a";
  const cell = (name, svg, size) => `<div style="text-align:center"><div style="width:${size}px;height:${size}px;background:#f3e9d4;border:3px solid #1d2b3a;border-radius:18px;padding:8px">${svg}</div>${name}</div>`;
  g.innerHTML =
    cell("Pip", `<div style="width:100%;height:100%;border-radius:50%;overflow:hidden">${PIP_PORTRAIT}</div>`, 220) +
    Object.entries(ITEM_ICONS).map(([k, v]) => cell(k, v, 150)).join("") +
    Object.entries(ICONS).map(([k, v]) => cell(k, v, 72)).join("");
  for (const svg of g.querySelectorAll("svg")) svg.style.cssText = "width:100%;height:100%;display:block";
  document.body.appendChild(g);
}

async function run() {
  if (screen === "icons") return showIconGallery();
  hud.setLoading(0.05, "Warming up the engine…");
  const town = realTown ? await buildRealTown() : null;
  if (town) {
    camera.setTarget(new Vector3(town.spawnPoint.x, 0, town.spawnPoint.z));
    camera.radius = 40;
    center.x = town.spawnPoint.x;
    center.z = town.spawnPoint.z;
  }
  hud.setMap(town || fakeTown);
  if (screen === "loading") {
    await wait(400);
    hud.setLoading(0.62, "Building the town…");
    return;
  }
  hud.setLoading(1, "Ready!");
  if (screen === "start") {
    await wait(300);
    hud.showStartScreen().then(() => console.log("start screen resolved"));
  } else {
    await wait(Number(params.get("delay")) || 0); // delay=ms before auto-start
    await hud.showStartScreen({ auto: true });
  }
  // Showcase events fire at `at` ms; take the shot ~0.8 s later (budget = at + 800).
  setTimeout(() => {
    if (screen !== "start") {
      hud.showZone(zoneName);
      events.emit("hud:cycle", { dir: 1 });
      events.emit("hud:cycle", { dir: 1 });
    }
    if (screen === "toast" || screen === "pause") {
      hud.toast("Health Potion — coming soon!", "potion");
      events.emit("npc:greet", { name: "Mabel", text: "Lovely evening for a stroll, isn't it?" });
      hud.toast("Time of day: golden sunset", "sunset");
    }
    if (screen === "celebrate") events.emit("coin:all");
    // keys=KeyH,Backquote,…  dispatch real keydown events (exercises the HUD key handler)
    for (const code of (params.get("keys") || "").split(",").filter(Boolean)) {
      window.dispatchEvent(new KeyboardEvent("keydown", { code, key: code.replace(/^Key|^Digit/, "").toLowerCase() }));
    }
    // clicks=selector;selector  dispatch real click events
    for (const sel of (params.get("clicks") || "").split(";").filter(Boolean)) {
      const target = document.querySelector(sel);
      console.log("click", sel, target ? "ok" : "NOT FOUND");
      target?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    }
    if (screen === "pause") events.emit("game:togglePause");
    settleAnimations();
  }, at);
}
run();

// The fake game state ticks on a timer (headless shots get few rAF frames).
let t = 0;
setInterval(() => {
  const dt = 0.03;
  t += dt;
  camera.alpha += dt * 0.05;
  playerPos.x = center.x + Math.sin(t * 0.3) * 10;
  playerPos.z = center.z + 10 + Math.cos(t * 0.3) * 10;
  state.heading = -t * 0.3 + Math.PI / 2;
  state.cameraYaw = Math.atan2(-Math.cos(camera.alpha), -Math.sin(camera.alpha));
  state.speed = t % 8 < 4 ? 6.5 : 2;
  timeOfDay = (timeOfDay + dt / 20) % 24;
  state.timeOfDay = timeOfDay;
  state.fps = engine.getFps();
  for (let i = 0; i < npcPositions.length; i++) npcPositions[i].x += Math.sin(t + i) * dt * 2;
  hud.update(dt, state);
}, 30);
engine.runRenderLoop(() => scene.render());
window.addEventListener("resize", () => engine.resize());

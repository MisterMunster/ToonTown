// Visual test page for src/game/npcs.js (see npcs.html for the query params).
import "@fontsource/fredoka/600.css";
import {
  Engine, Scene, Color3, Color4, Vector3, ArcRotateCamera, HemisphericLight, DirectionalLight,
  ShadowGenerator, MeshBuilder, SceneInstrumentation, Mesh,
} from "@babylonjs/core";
import { events } from "/src/game/events.js";
import { ColliderWorld } from "/src/game/colliders.js";
import { PALETTE } from "/src/game/palette.js";
import { toonMat } from "/src/game/materials.js";
import { createCharacter } from "/src/game/character.js";
import { createNPCs } from "/src/game/npcs.js";

const q = new URLSearchParams(location.search);
const num = (k, d) => (q.has(k) && Number.isFinite(Number(q.get(k))) ? Number(q.get(k)) : d);
const quality = q.get("quality") ?? "high";
const real = q.get("real") === "1";

const canvas = document.getElementById("c");
const engine = new Engine(canvas, true, { stencil: true, preserveDrawingBuffer: true }, false);
engine.resize();
window.addEventListener("resize", () => engine.resize());
const scene = new Scene(engine);
scene.clearColor = Color4.FromHexString(PALETTE.sky + "ff");
const colliders = new ColliderWorld(8);

// ---------------------------------------------------------------- fake town --
function roundedRect(x0, z0, x1, z1, r, step = 2.2) {
  const pts = [];
  const corner = (cx, cz, a0) => {
    for (let i = 0; i <= 4; i++) {
      const a = a0 + (i / 4) * (Math.PI / 2);
      pts.push({ x: cx + Math.sin(a) * r, z: cz + Math.cos(a) * r });
    }
  };
  const line = (ax, az, bx, bz) => {
    const n = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az) / step));
    for (let i = 1; i < n; i++) pts.push({ x: ax + ((bx - ax) * i) / n, z: az + ((bz - az) * i) / n });
  };
  corner(x0 + r, z1 - r, -Math.PI / 2);
  line(x0 + r, z1, x1 - r, z1);
  corner(x1 - r, z1 - r, 0);
  line(x1, z1 - r, x1, z0 + r);
  corner(x1 - r, z0 + r, Math.PI / 2);
  line(x1 - r, z0, x0 + r, z0);
  corner(x0 + r, z0 + r, Math.PI);
  line(x0, z0 + r, x0, z1 - r);
  return pts;
}

function buildFakeTown(sg) {
  const flat = (name, w, d, hex, x, z, y = 0.01) => {
    const m = MeshBuilder.CreateGround(name, { width: w, height: d }, scene);
    m.position.set(x, y, z);
    m.material = toonMat(scene, hex);
    m.receiveShadows = true;
    return m;
  };
  flat("grass", 240, 240, PALETTE.grass, 0, 0, 0);
  const plaza = MeshBuilder.CreateDisc("plaza", { radius: 12, tessellation: 48 }, scene);
  plaza.rotation.x = Math.PI / 2;
  plaza.position.y = 0.02;
  plaza.material = toonMat(scene, PALETTE.plaza);
  plaza.receiveShadows = true;
  flat("sidewalk", 60, 8, PALETTE.sidewalk, 0, 19);
  flat("road", 70, 6, PALETTE.road, 0, 12);
  flat("parkLawn", 32, 32, PALETTE.grassDark, -40, -20, 0.015);
  // fountain
  const basin = MeshBuilder.CreateCylinder("basin", { diameter: 5, height: 0.7, tessellation: 32 }, scene);
  basin.position.y = 0.35;
  basin.material = toonMat(scene, PALETTE.stone);
  const water = MeshBuilder.CreateCylinder("water", { diameter: 4.4, height: 0.1, tessellation: 32 }, scene);
  water.position.y = 0.66;
  water.material = toonMat(scene, PALETTE.water, { emissive: 0.15 });
  const spout = MeshBuilder.CreateCylinder("spout", { diameter: 0.8, height: 2.2, tessellation: 16 }, scene);
  spout.position.y = 1.1;
  spout.material = toonMat(scene, PALETTE.stoneDark);
  colliders.addCylinder(0, 0, 2.5, 0, 0.7, "prop");
  for (const m of [basin, spout]) sg.addShadowCaster(m);
  // a row of shops behind the sidewalk
  for (let i = 0; i < 7; i++) {
    const x = -24 + i * 8;
    const h = 4 + (i % 3) * 1.5;
    const b = MeshBuilder.CreateBox(`shop${i}`, { width: 7, height: h, depth: 7 }, scene);
    b.position.set(x, h / 2, 27);
    b.material = toonMat(scene, PALETTE.walls[i % PALETTE.walls.length]);
    const roof = MeshBuilder.CreateCylinder(`roof${i}`, { diameterTop: 0, diameterBottom: 10.6, height: 3, tessellation: 4 }, scene);
    roof.rotation.y = Math.PI / 4;
    roof.position.set(x, h + 1.5, 27);
    roof.material = toonMat(scene, PALETTE.roofs[i % PALETTE.roofs.length]);
    for (const m of [b, roof]) {
      sg.addShadowCaster(m);
      m.receiveShadows = true;
    }
    colliders.addBox(x - 3.5, 0, 23.5, x + 3.5, h, 30.5, "building");
  }
  // park: trees + flower beds
  const trunkMat = toonMat(scene, PALETTE.trunk);
  const trees = [[-50, -8], [-28, -30], [-52, -30], [-36, -34], [-46, -14]];
  trees.forEach(([x, z], i) => {
    const t = MeshBuilder.CreateCylinder(`trunk${i}`, { diameter: 0.5, height: 2.2 }, scene);
    t.position.set(x, 1.1, z);
    t.material = trunkMat;
    const f = MeshBuilder.CreateSphere(`foliage${i}`, { diameter: 3.6, segments: 8 }, scene);
    f.position.set(x, 3.3, z);
    f.material = toonMat(scene, PALETTE.foliage[i % PALETTE.foliage.length]);
    sg.addShadowCaster(t);
    sg.addShadowCaster(f);
    colliders.addCylinder(x, z, 0.4, 0, 3, "tree");
  });
  for (let k = 0; k < 40; k++) {
    const a = k * 2.399;
    const r = 1 + (k % 7) * 0.35;
    const cx = k < 20 ? -33 : -44;
    const cz = k < 20 ? -14 : -27;
    const fl = MeshBuilder.CreateSphere(`flower${k}`, { diameter: 0.32, segments: 4 }, scene);
    fl.position.set(cx + Math.sin(a) * r, 0.25, cz + Math.cos(a) * r);
    fl.material = toonMat(scene, PALETTE.flowers[k % PALETTE.flowers.length]);
  }
  return {
    spawnPoint: new Vector3(0, 0, -10),
    spawnHeading: 0,
    bounds: { minX: -60, maxX: 60, minZ: -60, maxZ: 60 },
    mapFeatures: [
      { kind: "plaza", x: 0, z: 0, w: 24, d: 24, color: PALETTE.plaza },
      { kind: "park", x: -40, z: -20, w: 32, d: 32, color: PALETTE.grass, label: "Maple Park" },
    ],
    landmarks: [{ name: "Fountain", x: 0, z: 0 }],
    zones: [{ name: "Maple Park", minX: -56, maxX: -24, minZ: -36, maxZ: -4 }],
    npcPaths: [
      roundedRect(-7.5, -7.5, 7.5, 7.5, 4),
      roundedRect(-26, 17, 26, 21, 1.5),
      roundedRect(-50, -30, -30, -10, 3),
    ],
    setNightFactor() {},
    update() {},
  };
}

// ---------------------------------------------------------------- world -----
let env;
let town;
if (real) {
  const { createEnvironment } = await import("/src/game/environment.js");
  const { createTown } = await import("/src/game/town.js");
  env = createEnvironment(scene, engine, { quality, events });
  await Promise.race([document.fonts.load("700 64px Fredoka"), new Promise((r) => setTimeout(r, 1500))]);
  town = createTown(scene, env, colliders, { quality });
  if (q.has("time")) {
    events.emit("settings:daynight", { mode: "day" });
    env.setTimeOfDay(num("time", 12));
  }
} else {
  const hemi = new HemisphericLight("hemi", new Vector3(0, 1, 0), scene);
  hemi.intensity = 0.65;
  hemi.diffuse = Color3.FromHexString("#fff6e8");
  hemi.groundColor = Color3.FromHexString("#8fa6c0");
  const sun = new DirectionalLight("sun", new Vector3(-0.5, -1, 0.45).normalize(), scene);
  sun.position = new Vector3(30, 60, -30);
  sun.intensity = 0.95;
  sun.diffuse = Color3.FromHexString("#fff1d6");
  const sg = new ShadowGenerator(2048, sun);
  sg.usePercentageCloserFiltering = true;
  sg.bias = 0.002;
  sun.autoUpdateExtends = false;
  sun.shadowFrustumSize = 90;
  sun.shadowMinZ = 1;
  sun.shadowMaxZ = 200;
  const night = num("night", 0);
  env = {
    nightFactor: night,
    addShadowCaster: (n) => {
      const list = n.getChildMeshes ? [n, ...n.getChildMeshes(false)] : [n];
      for (const m of list) if (m instanceof Mesh) sg.addShadowCaster(m);
    },
  };
  town = buildFakeTown(sg);
  scene.fogMode = Scene.FOGMODE_EXP2;
  scene.fogDensity = 0.004;
  scene.fogColor = Color3.FromHexString(PALETTE.fog);
}

await Promise.race([document.fonts.load("600 40px Fredoka"), new Promise((r) => setTimeout(r, 1500))]);

// the hero (static stand-in for the player)
const defaultHero = real ? [town.spawnPoint.x, town.spawnPoint.z] : [0, -8.9];
const heroPos = new Vector3(num("hx", defaultHero[0]), 0, num("hz", defaultHero[1]));
heroPos.y = colliders.groundHeightAt(heroPos.x, heroPos.z, 0.3, 1);
const hero = createCharacter(scene, { name: "Pip", preset: "hero", outline: true, lod: "high" });
hero.root.position.copyFrom(heroPos);
hero.root.rotation.y = num("hh", Math.PI);
env.addShadowCaster(hero.root, true);

const npcs = createNPCs(scene, env, colliders, town, { quality, events });

// ---------------------------------------------------------------- camera ----
const camera = new ArcRotateCamera("cam", 0, 1, 10, Vector3.Zero(), scene);
camera.fov = 0.85;
camera.minZ = 0.1;
camera.maxZ = 1200;
camera.attachControl(canvas, true);
camera.inputs.removeByType("ArcRotateCameraKeyboardMoveInput");
env.setupPostProcessing?.(camera);

let greeter = null;
let greetText = "";
events.on("npc:greet", ({ name, text }) => {
  console.log(`[npc:greet] ${name}: "${text}"`);
  greeter ??= npcs.townsfolk.find((n) => n.name === name);
  greetText = greetText || `${name}: ${text}`;
});

function aimCamera() {
  const cam = q.get("cam") ?? (q.get("greet") === "1" ? "greet" : "town");
  const set = (tx, ty, tz, alpha, beta, radius) => {
    camera.target.set(tx, ty, tz);
    camera.alpha = num("alpha", alpha);
    camera.beta = num("beta", beta);
    camera.radius = num("radius", radius);
  };
  const sp = town.spawnPoint;
  if (cam === "greet" && greeter) {
    // between the greeter and the hero, seen from the greeter's front-side
    const mx = greeter.x * 0.6 + heroPos.x * 0.4;
    const mz = greeter.z * 0.6 + heroPos.z * 0.4;
    const toHero = Math.atan2(heroPos.x - greeter.x, heroPos.z - greeter.z);
    hero.root.rotation.y = toHero + Math.PI; // Pip faces the greeter
    // ArcRotate alpha for a camera placed at yaw angle a around the target: position = (cos a, sin a)*r
    const camYaw = toHero + num("side", 0.75);
    set(mx, 1.35, mz, Math.atan2(Math.cos(camYaw), Math.sin(camYaw)), 1.38, 5.2);
  } else if (cam === "sky") set(sp.x, 17, sp.z, -Math.PI / 2, 1.95, 34);
  else if (cam === "park") {
    const b = npcs.butterflyAnchors?.[0] ?? { x: -33, z: -14 };
    set(b.x, 0.9, b.z, -Math.PI / 2 + 0.5, 1.2, 6.5);
  } else if (cam === "game") {
    // like the follow camera: behind Pip, looking towards the greeter (or north)
    const h = greeter ? Math.atan2(greeter.x - heroPos.x, greeter.z - heroPos.z) + num("turn", 0.5) : 0;
    hero.root.rotation.y = h;
    set(heroPos.x, heroPos.y + 1.25, heroPos.z, Math.atan2(-Math.cos(h), -Math.sin(h)), 1.15, 9);
  } else if (cam === "face" && greeter) {
    const yaw = greeter.heading + num("side", 0.3);
    set(greeter.x, greeter.y + 1.25, greeter.z, Math.atan2(Math.cos(yaw), Math.sin(yaw)), 1.45, 2.2);
  } else if (cam === "dog") {
    const d = npcs.wildlife.dog?.dog;
    if (d) set(d.x, 0.45, d.z, num("alpha", d.heading + 0.9), num("beta", 1.3), num("radius", 2.6));
  } else if (cam === "bird") {
    const b = npcs.wildlife.birds?.birds[num("bi", 0)];
    if (b) set(b.x, b.y, b.z, num("alpha", 0.6), num("beta", 1.2), num("radius", 2.6));
  } else if (cam === "bfly") {
    const b = npcs.wildlife.butterflies?.list[num("bi", 0)];
    if (b) set(b.x, b.y, b.z, num("alpha", 0.6), num("beta", 1.0), num("radius", 1.2));
  } else if (cam === "top") set(sp.x, 0, sp.z + 10, -Math.PI / 2, 0.5, 70);
  else if (cam === "hero") set(heroPos.x, 1.2, heroPos.z, -Math.PI / 2 - 0.3, 1.15, 9);
  else set(real ? sp.x : 0, 1, real ? sp.z + 4 : 4, -Math.PI / 2 - 0.35, 1.1, real ? 24 : 26);
}

// ---------------------------------------------------------------- warm-up ---
const STEP = 1 / 30;
const tick = (dt) => {
  npcs.update(dt, heroPos);
  hero.update(dt, { speed: 0 });
  env.update?.(dt, heroPos);
  town.update?.(dt, 0);
};
if (q.get("greet") === "1") {
  for (let i = 0; i < 30 * 90 && !greeter; i++) tick(STEP);
  const extra = Math.round(num("gd", 0.7) / STEP);
  for (let i = 0; i < extra; i++) tick(STEP);
} else {
  const n = Math.round(num("t", 0) / STEP);
  for (let i = 0; i < n; i++) tick(STEP);
}
aimCamera();
const frozen = q.get("freeze") === "1" || q.get("greet") === "1";

const inst = new SceneInstrumentation(scene);
const info = document.getElementById("info");
let frames = 0;
scene.onAfterRenderObservable.add(() => {
  if (++frames === 4) {
    const msg = `npcs=${npcs.positions.length} drawCalls=${inst.drawCallsCounter.current} meshes=${scene.meshes.length} activeMeshes=${scene.getActiveMeshes().length}${greetText ? `\n${greetText}` : ""}`;
    info.textContent = msg;
    console.log("[preview]", msg.replace("\n", " | "));
  }
});
engine.runRenderLoop(() => {
  if (!frozen) tick(Math.min(engine.getDeltaTime() / 1000, 0.05));
  scene.render();
});

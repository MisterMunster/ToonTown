// Preview harness for the Town module (see town.html for URL params).
import "@fontsource/fredoka/700.css";
import {
  Engine,
  Scene,
  Color3,
  Color4,
  Vector3,
  HemisphericLight,
  DirectionalLight,
  ShadowGenerator,
  UniversalCamera,
  DefaultRenderingPipeline,
  SceneInstrumentation,
  MeshBuilder,
  StandardMaterial,
} from "@babylonjs/core";
import { ColliderWorld } from "/src/game/colliders.js";
import { createTown } from "/src/game/town.js";
import { PALETTE } from "/src/game/palette.js";

const params = new URLSearchParams(location.search);
const view = params.get("view") || "overview";
const night = params.get("night") === "1" ? 1 : Number(params.get("nf") || 0);
const time = Number(params.get("time") || (night > 0.5 ? 21.5 : 15.5));
const quality = params.get("q") || "high";

const VIEWS = {
  overview: [95, 78, -118, 0, 0, -6],
  top: [0, 210, -60, 0, 0, -4],
  square: [0, 2.7, -17.5, 0, 2.4, 2],
  street: [2.2, 2.4, 13.5, 0, 6.5, 58],
  hall: [5, 2.6, 40.5, 0, 8.5, 60],
  park: [-18, 7.5, -20, -44, 0.5, -46],
  playground: [-11, 5, -47, -24, 0.5, -62],
  market: [6.5, 4.2, -9, 24, 1.2, -24],
  edge: [1.5, 3.5, -74, 0, 9, -230],
  east: [20, 3, 2.5, 80, 3, 0],
  shops: [-4, 3, 6, -20, 3, 26],
};

async function main() {
  const canvas = document.getElementById("c");
  const engine = new Engine(canvas, true, { stencil: true }, false);
  engine.resize();
  addEventListener("resize", () => engine.resize());
  const scene = new Scene(engine);
  scene.skipPointerMovePicking = true;

  // ---- stand-in environment ------------------------------------------------
  const sky = night ? new Color3(0.1, 0.14, 0.3) : Color3.FromHexString(PALETTE.sky);
  scene.clearColor = Color4.FromColor3(sky, 1);
  scene.fogMode = Scene.FOGMODE_EXP2;
  scene.fogDensity = night ? 0.0045 : 0.0028;
  scene.fogColor = night ? new Color3(0.12, 0.16, 0.32) : Color3.FromHexString(PALETTE.fog);
  scene.ambientColor = new Color3(0, 0, 0);

  const hemi = new HemisphericLight("hemi", new Vector3(0, 1, 0), scene);
  hemi.intensity = night ? 0.32 : 0.72;
  hemi.diffuse = night ? new Color3(0.5, 0.6, 1) : new Color3(1, 1, 1);
  hemi.groundColor = night ? new Color3(0.12, 0.14, 0.25) : new Color3(0.55, 0.62, 0.5);
  const sun = new DirectionalLight("sun", new Vector3(-0.55, -1, 0.42).normalize(), scene);
  sun.position = new Vector3(55, 100, -42);
  sun.intensity = night ? 0.35 : 0.95;
  sun.diffuse = night ? new Color3(0.55, 0.65, 1) : new Color3(1, 0.96, 0.88);
  const sg = new ShadowGenerator(2048, sun);
  sg.usePercentageCloserFiltering = true;
  sg.bias = 0.0008;
  sg.normalBias = 0.02;
  sun.shadowMinZ = 1;
  sun.shadowMaxZ = 260;
  sun.autoUpdateExtends = false;
  sun.orthoLeft = -95;
  sun.orthoRight = 95;
  sun.orthoTop = 95;
  sun.orthoBottom = -95;

  const env = {
    sun,
    hemi,
    shadowGenerator: sg,
    addShadowCaster: (m, desc = true) => sg.addShadowCaster(m, desc),
    removeShadowCaster: (m) => sg.removeShadowCaster(m),
    timeOfDay: time,
    nightFactor: night,
  };

  await Promise.race([document.fonts.load("700 64px Fredoka").catch(() => {}), new Promise((r) => setTimeout(r, 1500))]);

  const colliders = new ColliderWorld(8);
  const t0 = performance.now();
  const town = createTown(scene, env, colliders, { quality });
  const buildMs = performance.now() - t0;
  town.setNightFactor(night);

  // a 1.6 m stand-in hero at the spawn point for scale
  if (params.get("hero") !== "0") {
    const hero = MeshBuilder.CreateCapsule("hero", { height: 1.6, radius: 0.32 }, scene);
    hero.position.copyFrom(town.spawnPoint).addInPlaceFromFloats(0, 0.8, 0);
    const hm = new StandardMaterial("heroMat", scene);
    hm.diffuseColor = Color3.FromHexString("#ff5d5d");
    hero.material = hm;
    sg.addShadowCaster(hero);
  }

  // ---- camera ----------------------------------------------------------------
  const v = params.get("cam") ? params.get("cam").split(",").map(Number) : VIEWS[view] || VIEWS.overview;
  const cam = new UniversalCamera("cam", new Vector3(v[0], v[1], v[2]), scene);
  cam.setTarget(new Vector3(v[3], v[4], v[5]));
  cam.minZ = 0.3;
  cam.maxZ = 1600;
  cam.fov = 0.9;
  cam.attachControl(canvas, true);
  cam.speed = 1.5;

  if (params.get("bloom") !== "0") {
    const pipe = new DefaultRenderingPipeline("pipe", true, scene, [cam]);
    pipe.bloomEnabled = true;
    pipe.bloomThreshold = 0.75;
    pipe.bloomWeight = night ? 0.6 : 0.3;
    pipe.bloomKernel = 48;
    pipe.fxaaEnabled = true;
    pipe.imageProcessingEnabled = true;
    pipe.imageProcessing.contrast = 1.08;
    pipe.imageProcessing.exposure = 1.0;
  }

  const inst = new SceneInstrumentation(scene);
  inst.captureFrameTime = true;
  let frame = 0;
  let t = 0;
  const info = document.getElementById("info");
  engine.runRenderLoop(() => {
    const dt = Math.min(engine.getDeltaTime() / 1000, 0.05);
    t += dt;
    town.setNightFactor(night);
    town.update(dt, t);
    scene.render();
    frame++;
    if (frame === 8 || frame % 60 === 0) {
      const msg = `view=${view} q=${quality} build=${buildMs.toFixed(0)}ms drawCalls=${inst.drawCallsCounter.current} activeMeshes=${scene.getActiveMeshes().length} meshes=${scene.meshes.length} verts=${scene.getTotalVertices()} activeIdx=${scene.getActiveIndices()} lights=${scene.lights.length}`;
      info.textContent = msg;
      if (frame === 8) console.log(msg);
    }
  });
}

main().catch((e) => console.error(e));

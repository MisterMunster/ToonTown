import "@fontsource/fredoka/400.css";
import "@fontsource/fredoka/500.css";
import "@fontsource/fredoka/600.css";
import "@fontsource/fredoka/700.css";
import "./ui/base.css";

import { Engine, Scene, Color4 } from "@babylonjs/core";
import { events } from "./game/events.js";
import { ColliderWorld } from "./game/colliders.js";
import { createEnvironment } from "./game/environment.js";
import { createTown } from "./game/town.js";
import { createCharacter } from "./game/character.js";
import { createInput } from "./game/input.js";
import { createPlayer } from "./game/player.js";
import { createCameraRig } from "./game/camera.js";
import { createNPCs } from "./game/npcs.js";
import { createCollectibles } from "./game/collectibles.js";
import { createFX } from "./game/fx.js";
import { createAudio } from "./game/audio.js";
import { createHUD } from "./ui/hud.js";

const MAX_DT = 1 / 20;
const DPR_CAP = { low: 1, medium: 1.25, high: 1.75 };

function detectQuality() {
  const q = new URLSearchParams(location.search).get("quality");
  if (q === "low" || q === "medium" || q === "high") return q;
  return matchMedia("(pointer: coarse)").matches ? "low" : "high";
}

function applyScaling(engine, quality) {
  const dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP[quality] ?? 1);
  engine.setHardwareScalingLevel(1 / dpr);
}

// Yield so the loading bar can paint. requestAnimationFrame never fires in a
// background tab (or under headless virtual time), so a timer keeps loading going.
const nextFrame = () =>
  new Promise((r) => {
    requestAnimationFrame(() => r());
    setTimeout(r, 100);
  });

function findZone(zones, x, z) {
  for (const zone of zones) {
    if (x >= zone.minX && x <= zone.maxX && z >= zone.minZ && z <= zone.maxZ) return zone.name;
  }
  return null;
}

function showFatal(err) {
  console.error(err);
  const el = document.createElement("div");
  el.className = "fatal-error";
  el.innerHTML = `<h1>Oops! The town didn't load.</h1><p>${String(err?.message || err)}</p>
    <p>Try a recent Chrome, Edge, Safari or Firefox with hardware acceleration enabled.</p>`;
  document.body.appendChild(el);
}

async function boot() {
  // ---- debug URL params (handy for headless screenshots) ----------------
  //   ?autostart=1  skip the title screen (and the camera intro/swoop)
  //   ?time=21.5    set the clock (hours); the day/night cycle keeps running
  //   ?quality=low|medium|high   (read in detectQuality)
  //   ?touch=1|0    force the touch controls on/off (read in input.js)
  //   ?demo=1       DEBUG autopilot: walks Pip around the fountain, jumping and
  //                 double-jumping every few seconds (drives the input object)
  //   ?ff=2.5       DEBUG fast-forward: after start, simulate this many seconds
  //                 synchronously before the first rendered gameplay frame.
  //                 Headless Chrome (tools/shot.sh) renders only ~1 frame, so
  //                 this is how screenshots capture mid-walk / mid-flip moments.
  const params = new URLSearchParams(location.search);
  const autostart = params.has("autostart");

  const canvas = document.getElementById("renderCanvas");
  let quality = detectQuality();

  const hud = createHUD({ root: document.getElementById("hud-root"), events, quality });
  hud.setLoading(0.05, "Warming up the engine…");
  await nextFrame();

  const engine = new Engine(canvas, true, { stencil: true, powerPreference: "high-performance" }, false);
  applyScaling(engine, quality);
  window.addEventListener("resize", () => engine.resize());

  const scene = new Scene(engine);
  scene.clearColor = new Color4(0.56, 0.83, 1, 1);
  scene.skipPointerMovePicking = true;

  const colliders = new ColliderWorld(8);

  hud.setLoading(0.15, "Painting the sky…");
  await nextFrame();
  const env = createEnvironment(scene, engine, { quality, events });

  hud.setLoading(0.3, "Building the town…");
  // Shop signs are drawn into canvases — make sure the bundled font is ready.
  await Promise.race([
    Promise.all(["700 64px Fredoka", "600 32px Fredoka"].map((f) => document.fonts?.load?.(f))).catch(() => {}),
    new Promise((r) => setTimeout(r, 1500)),
  ]);
  await nextFrame();
  const town = createTown(scene, env, colliders, { quality });

  hud.setLoading(0.55, "Dressing up our hero…");
  await nextFrame();
  const hero = createCharacter(scene, { name: "Pip", preset: "hero", outline: true, lod: "high" });
  env.addShadowCaster(hero.root, true);

  const input = createInput(scene, canvas, { events });
  const player = createPlayer(scene, hero, input, colliders, {
    spawn: town.spawnPoint,
    heading: town.spawnHeading,
    bounds: town.bounds,
    events,
  });
  player.enabled = false;

  const cameraRig = createCameraRig(scene, canvas, player, input, colliders, { quality });
  env.setupPostProcessing(cameraRig.camera);
  // The title screen sits over a slow cinematic orbit of the town square.
  // (?autostart skips it: the rig starts out following the hero.)
  if (!autostart) cameraRig.setIntro(true);

  hud.setLoading(0.75, "Waking up the neighbours…");
  await nextFrame();
  const npcs = createNPCs(scene, env, colliders, town, { quality, events });
  const collectibles = createCollectibles(scene, env, town, { events });
  const fx = createFX(scene, env, { events, quality });
  const audio = createAudio({ events });
  hud.setMap(town);

  events.on("settings:quality", ({ level }) => {
    quality = level;
    applyScaling(engine, level);
    env.setQuality(level);
  });

  hud.setLoading(0.9, "Compiling shaders…");
  await scene.whenReadyAsync();
  hud.setLoading(1, "Ready!");

  const demo = params.has("demo") ? createAutopilot(input, player, cameraRig) : null;
  const fastForward = Math.min(120, Math.max(0, Number(params.get("ff")) || 0));
  if (params.has("time")) env.setTimeOfDay(Number(params.get("time")) || 12);

  // ---- main loop -------------------------------------------------------
  let elapsed = 0;
  let currentZone = null;
  let started = false;
  const hudState = {
    playerPos: player.position,
    heading: 0,
    cameraYaw: 0,
    timeOfDay: 0,
    nightFactor: 0,
    speed: 0,
    grounded: true,
    fps: 60,
    npcPositions: npcs.positions,
    coinPositions: collectibles.positions,
    coins: 0,
    coinsTotal: collectibles.total,
  };

  /** One simulation step (everything except scene.render). */
  function step(dt) {
    elapsed += dt;
    const paused = hud.paused;

    if (!paused) {
      input.update(dt);
      if (demo && started) demo.update(dt);
      player.update(dt, cameraRig.yaw);
      cameraRig.update(dt);
      env.update(dt, player.position);
      town.setNightFactor(env.nightFactor);
      town.update(dt, elapsed);
      npcs.update(dt, player.position);
      collectibles.update(dt, player.position);
      fx.update(dt);
    }
    audio.update(dt, { paused, nightFactor: env.nightFactor, speed: player.speed });

    if (started) {
      const zone = findZone(town.zones, player.position.x, player.position.z);
      if (zone && zone !== currentZone) {
        currentZone = zone;
        hud.showZone(zone);
        events.emit("zone:enter", { name: zone });
      } else if (!zone) {
        currentZone = null;
      }
    }

    hudState.heading = player.heading;
    hudState.cameraYaw = cameraRig.yaw;
    hudState.timeOfDay = env.timeOfDay;
    hudState.nightFactor = env.nightFactor;
    hudState.speed = player.speed;
    hudState.grounded = player.grounded;
    hudState.fps = engine.getFps();
    hudState.coins = collectibles.collected;
    hud.update(dt, hudState);
  }

  engine.runRenderLoop(() => {
    step(Math.min(engine.getDeltaTime() / 1000, MAX_DT));
    scene.render();
  });

  // Handy for debugging from the browser console (and for test harnesses).
  window.toonTown = { engine, scene, env, town, hero, input, player, cameraRig, npcs, collectibles, fx, audio, hud, events };

  // ---- title screen → play ---------------------------------------------
  await hud.showStartScreen(autostart ? { auto: true } : undefined);
  started = true;
  events.emit("game:start");
  cameraRig.setIntro(false); // swoop from the intro orbit to behind the hero
  player.enabled = true;

  // DEBUG fast-forward (see ?ff above): fixed 60 Hz steps, no rendering.
  if (fastForward > 0) {
    const n = Math.round(fastForward * 60);
    for (let i = 0; i < n; i++) step(1 / 60);
  }
}

/**
 * DEBUG autopilot for ?demo=1 — walks Pip in a circle around the fountain
 * (the plaza ring at r = 10 m is obstacle-free), with a double jump, then a
 * single jump, every 4 s, and alternates walking / running every 8 s. It
 * drives the same input object the player reads (camera-relative intent),
 * exactly like a keyboard or gamepad would.
 */
function createAutopilot(input, player, cameraRig) {
  const R = 10;
  let t = 0;
  let jumps = 0;
  let doubleAt = 0;
  return {
    update(dt) {
      t += dt;
      const p = player.position;
      const r = Math.hypot(p.x, p.z) || 1;
      // Counter-clockwise tangent plus a gentle pull back onto the ring.
      const ux = p.x / r;
      const uz = p.z / r;
      let dx = -uz + (R - r) * 0.35 * ux;
      let dz = ux + (R - r) * 0.35 * uz;
      const len = Math.hypot(dx, dz) || 1;
      dx /= len;
      dz /= len;
      // World direction → camera-relative intent (forward (sin θ, cos θ), right (cos θ, −sin θ)).
      const yaw = cameraRig.yaw;
      const sy = Math.sin(yaw);
      const cy = Math.cos(yaw);
      input.moveX = dx * cy - dz * sy;
      input.moveZ = dx * sy + dz * cy;
      input.run = t % 16 >= 8;
      // Jump at t = 2, 6, 10, … — every other one becomes a double jump 0.3 s later.
      const k = Math.floor((t - 2) / 4);
      if (k >= jumps) {
        jumps = k + 1;
        input.pressJump();
        if (k % 2 === 0) doubleAt = t + 0.3;
      }
      if (doubleAt && t >= doubleAt) {
        doubleAt = 0;
        input.pressJump();
      }
    },
  };
}

boot().catch(showFatal);

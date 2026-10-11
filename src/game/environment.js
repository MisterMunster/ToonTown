// Environment: sky dome, sun & moon, lighting, shadows, fog, clouds, stars,
// the day/night cycle and post-processing. See ARCHITECTURE.md
// ("Environment") for the contract. Helpers live in ./env/.
import { DirectionalLight, HemisphericLight, Scene, Vector3 } from "@babylonjs/core";
import { createClock, createSkyState, evaluateSky } from "./env/timeOfDay.js";
import { createSky } from "./env/sky.js";
import { createClouds } from "./env/clouds.js";
import { createShadows } from "./env/shadows.js";
import { createPostFX } from "./env/postfx.js";

const START_HOURS = 16;
const FOG_DENSITY_DAY = 0.0062;
const FOG_DENSITY_NIGHT = 0.0074;
const SHADOW_DARKNESS_DAY = 0.3; // Babylon: 0 = black shadows, 1 = none
const SHADOW_DARKNESS_NIGHT = 0.5; // crisper moon shadows
const MIN_CAMERA_FAR = 1000; // clouds live up to ~450 m away
const QUALITIES = ["low", "medium", "high"];

/**
 * @param {import("@babylonjs/core").Scene} scene
 * @param {import("@babylonjs/core").AbstractEngine} engine
 * @param {{ quality?: "low"|"medium"|"high", events?: { on: Function, off: Function }, ssao?: boolean }} [opts]
 *   ssao: opt-in subtle SSAO2 on "high" (off by default to protect frame rate).
 */
export function createEnvironment(scene, engine, { quality = "high", events, ssao = false } = {}) {
  let level = QUALITIES.includes(quality) ? quality : "high";

  // ---- lights ----------------------------------------------------------------
  const sun = new DirectionalLight("sun", new Vector3(-0.4, -1, 0.5).normalize(), scene);
  const hemi = new HemisphericLight("hemi", new Vector3(0, 1, 0), scene);
  hemi.specular.set(0, 0, 0);

  // ---- sky, clouds, shadows, post --------------------------------------------
  const sky = createSky(scene);
  const clouds = createClouds(scene, { count: 20 });
  const shadows = createShadows(scene, sun, level);
  const post = createPostFX(scene, engine, level, { ssao, ssaoExcludedMaterials: [sky.material, clouds.material] });

  scene.fogMode = Scene.FOGMODE_EXP2;
  scene.fogDensity = FOG_DENSITY_DAY;

  // ---- time of day -------------------------------------------------------------
  const clock = createClock(START_HOURS);
  const state = createSkyState();
  const lastFocus = new Vector3(0, 0, 0);
  let elapsed = 0;
  let warned = false;

  /** Push the evaluated sky state into lights, fog, sky, clouds and post. */
  function apply(dt) {
    evaluateSky(clock.hours, state);
    const n = state.nightFactor;

    sun.direction.copyFrom(state.keyDir);
    sun.diffuse.copyFrom(state.keyColor);
    state.keyColor.scaleToRef(0.35, sun.specular);
    sun.intensity = state.keyIntensity;

    hemi.diffuse.copyFrom(state.hemiSky);
    hemi.groundColor.copyFrom(state.hemiGround);
    hemi.intensity = state.hemiI;

    scene.fogColor.copyFrom(state.fog);
    scene.fogDensity = FOG_DENSITY_DAY + (FOG_DENSITY_NIGHT - FOG_DENSITY_DAY) * n;
    const cc = scene.clearColor;
    cc.r = state.horizon.r;
    cc.g = state.horizon.g;
    cc.b = state.horizon.b;
    cc.a = 1;

    shadows.generator.darkness = SHADOW_DARKNESS_DAY + (SHADOW_DARKNESS_NIGHT - SHADOW_DARKNESS_DAY) * n;
    shadows.follow(lastFocus, sun.direction);

    // Custom shaders must output linear colour when image processing runs as a post-process.
    const ipc = scene.imageProcessingConfiguration;
    const linear = ipc.isEnabled && ipc.applyByPostProcess ? 1 : 0;
    sky.update(state, elapsed, linear);
    clouds.update(dt, state, linear);
    post.update(n);
  }

  function setQuality(q) {
    if (!QUALITIES.includes(q) || q === level) return;
    level = q;
    shadows.setQuality(q);
    post.setQuality(q);
  }

  const onDayNight = (p) => clock.setMode(p?.mode);
  const onQuality = (p) => setQuality(p?.level);
  events?.on?.("settings:daynight", onDayNight);
  events?.on?.("settings:quality", onQuality);

  apply(0);

  return {
    sun,
    hemi,
    shadowGenerator: shadows.generator,
    addShadowCaster: shadows.addShadowCaster,
    removeShadowCaster: shadows.removeShadowCaster,

    /** Attach post-processing to the game camera (call once, after the camera exists). */
    setupPostProcessing(camera) {
      if (!camera) return;
      if (camera.maxZ > 0 && camera.maxZ < MIN_CAMERA_FAR) camera.maxZ = MIN_CAMERA_FAR;
      try {
        post.setup(camera);
      } catch (err) {
        console.warn("[environment] post-processing unavailable", err);
      }
    },

    /**
     * Advance the clock and update everything. Never throws.
     * @param {number} dt seconds
     * @param {Vector3} focus player feet position (shadow frustum follows it)
     */
    update(dt, focus) {
      try {
        const step = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.25) : 0;
        elapsed += step;
        if (focus && Number.isFinite(focus.x) && Number.isFinite(focus.z)) lastFocus.copyFrom(focus);
        clock.update(step);
        apply(step);
      } catch (err) {
        if (!warned) console.warn("[environment] update failed", err);
        warned = true;
      }
    },

    /** Current time in hours [0, 24). */
    get timeOfDay() {
      return clock.hours;
    },
    /** 0 = full day … 1 = full night (drives lamps / windows). */
    get nightFactor() {
      return state.nightFactor;
    },
    /** Current day/night mode: "cycle" | "day" | "sunset" | "night". */
    get mode() {
      return clock.mode;
    },

    /** Jump straight to a time (hours). Cycle mode continues from there. */
    setTimeOfDay(hours) {
      clock.setHours(Number(hours));
      apply(0);
    },

    setQuality,

    dispose() {
      events?.off?.("settings:daynight", onDayNight);
      events?.off?.("settings:quality", onQuality);
      post.dispose();
      shadows.dispose();
      clouds.mesh.dispose();
      sky.mesh.dispose();
      sun.dispose();
      hemi.dispose();
    },
  };
}

// Post-processing per quality level, rebuilt from scratch on quality changes
// (so SSAO, when enabled, always runs before bloom / image processing).
//   low:    image processing + FXAA
//   medium: image processing + bloom + FXAA + vignette
//   high:   image processing + bloom + MSAA x4 (WebGL2, else FXAA) + vignette
//           (+ subtle half-res SSAO2 when the `ssao` option is on — off by default:
//           it needs a prepass MRT + 4 extra passes for a very subtle gain in this
//           flat toon look, which is not worth risking 60 fps on laptops; also,
//           switching to "high" at runtime with SSAO on can log one transient
//           WebGL sampler warning while materials recompile for the prepass)
// Image processing runs on every level so the look is identical everywhere.
// No tone-mapping curve: lighting is calibrated so sunlit surfaces land at
// ~1x their palette colour, and filmic/neutral curves either desaturate the
// cartoon palette (ACES/standard) or crush shaded areas (KHR Neutral's toe).
// Instead: gentle contrast + a small saturation lift via colour curves.
import { Color4, ColorCurves, Constants, DefaultRenderingPipeline, ImageProcessingConfiguration, SSAO2RenderingPipeline } from "@babylonjs/core";

const LEVELS = {
  low: { msaa: false, bloom: false, ssao: false, vignette: false },
  medium: { msaa: false, bloom: true, ssao: false, vignette: true },
  high: { msaa: true, bloom: true, ssao: true, vignette: true },
};

// Bloom only catches genuinely bright things: high threshold by day (sun disc,
// glints), lower at night so bulbs, lit windows and string lights glow.
// Babylon raises the threshold to the 1/2.2 power before comparing it with the
// luma of the *linear* HDR scene colour, so 0.62 here = linear luma 0.80
// (≈ 0.9 on screen): lamp-lit paving stays below it, emissive bulbs are above.
const BLOOM_THRESHOLD_DAY = 1.2;
const BLOOM_THRESHOLD_NIGHT = 0.62;
// Night grade (all interpolated by nightFactor, so daytime is untouched): a
// stronger, softer bloom and a deeper blue vignette. Both are plain uniforms,
// cheap to change every frame (unlike ipc.exposure, which dirties every
// material). Night "exposure" is lowered through the light/palette energy
// instead, which also keeps full headroom for the emissive glows.
const BLOOM_WEIGHT_DAY = 0.3;
const BLOOM_WEIGHT_NIGHT = 0.42;
const VIGNETTE_WEIGHT_DAY = 1.6;
const VIGNETTE_WEIGHT_NIGHT = 2.6;

/**
 * @param {import("@babylonjs/core").Scene} scene
 * @param {import("@babylonjs/core").AbstractEngine} engine
 * @param {"low"|"medium"|"high"} quality
 * @param {{ ssao?: boolean, ssaoExcludedMaterials?: import("@babylonjs/core").Material[] }} [opts]
 */
export function createPostFX(scene, engine, quality, { ssao: allowSSAO = false, ssaoExcludedMaterials = [] } = {}) {
  let level = LEVELS[quality] ? quality : "high";
  let camera = null;
  let pipeline = null;
  let ssao = null;
  let threshold = BLOOM_THRESHOLD_DAY;
  let weight = BLOOM_WEIGHT_DAY;

  const webgl2 = (engine.webGLVersion ?? 1) >= 2;
  const caps = engine.getCaps();
  const hdrType = caps.textureHalfFloatRender ? Constants.TEXTURETYPE_HALF_FLOAT : Constants.TEXTURETYPE_UNSIGNED_BYTE;

  // Shared image-processing look (applied by the pipeline's post-process).
  const ipc = scene.imageProcessingConfiguration;
  ipc.toneMappingEnabled = false;
  ipc.exposure = 1.0;
  ipc.contrast = 1.1;
  if (!ipc.colorCurves) ipc.colorCurves = new ColorCurves();
  ipc.colorCurves.globalSaturation = 10;
  ipc.colorCurvesEnabled = true;
  ipc.vignetteWeight = VIGNETTE_WEIGHT_DAY;
  ipc.vignetteStretch = 0.15;
  ipc.vignetteColor = new Color4(0.07, 0.06, 0.18, 0);
  ipc.vignetteBlendMode = ImageProcessingConfiguration.VIGNETTEMODE_MULTIPLY;

  function disposePipelines() {
    try {
      pipeline?.dispose();
    } catch (err) {
      console.warn("[environment] pipeline dispose failed", err);
    }
    try {
      if (ssao) {
        ssao.dispose();
        scene.disablePrePassRenderer?.(); // stop paying for the MRT prepass
      }
    } catch (err) {
      console.warn("[environment] SSAO dispose failed", err);
    }
    pipeline = null;
    ssao = null;
  }

  function createSSAO() {
    if (!webgl2 || !SSAO2RenderingPipeline.IsSupported) return null;
    try {
      const p = new SSAO2RenderingPipeline("toonSSAO", scene, { ssaoRatio: 0.5, blurRatio: 0.5 }, [camera], false, hdrType);
      p.radius = 1.5;
      p.totalStrength = 1.0;
      p.base = 0.0;
      p.samples = 16;
      p.maxZ = 90;
      p.minZAspect = 0.5;
      p.expensiveBlur = true;
      p.bilateralSamples = 16;
      const ppr = scene.prePassRenderer;
      if (ppr) for (const m of ssaoExcludedMaterials) if (!ppr.excludedMaterials.includes(m)) ppr.excludedMaterials.push(m);
      return p;
    } catch (err) {
      console.warn("[environment] SSAO unavailable, continuing without it", err);
      return null;
    }
  }

  function build() {
    if (!camera) return;
    disposePipelines();
    const cfg = LEVELS[level];
    const useMsaa = cfg.msaa && webgl2;

    if (cfg.ssao && allowSSAO) ssao = createSSAO();

    // automaticBuild = false: configure everything, then build once.
    pipeline = new DefaultRenderingPipeline("toonPipeline", true, scene, [camera], false);
    pipeline.imageProcessingEnabled = true;
    pipeline.fxaaEnabled = !useMsaa;
    pipeline.bloomEnabled = cfg.bloom;
    pipeline.bloomKernel = 64;
    pipeline.bloomScale = 0.5;
    pipeline.bloomWeight = weight;
    pipeline.bloomThreshold = threshold;
    // With SSAO first in the chain, MSAA belongs on SSAO's scene-colour target.
    if (ssao) {
      pipeline.samples = 1;
      if (useMsaa) ssao.textureSamples = 4;
    } else {
      pipeline.samples = useMsaa ? 4 : 1;
    }
    pipeline.prepare();
    ipc.vignetteEnabled = cfg.vignette;
  }

  return {
    get pipeline() {
      return pipeline;
    },
    get ssao() {
      return ssao;
    },
    /** Attach to the game camera (called once). */
    setup(cam) {
      camera = cam;
      build();
    },
    setQuality(q) {
      if (!LEVELS[q] || q === level) return;
      level = q;
      build();
    },
    /** Per-frame: night-dependent bloom + vignette (cheap uniform changes, no rebuild). */
    update(nightFactor) {
      const n = nightFactor > 0 ? (nightFactor < 1 ? nightFactor : 1) : 0;
      threshold = BLOOM_THRESHOLD_DAY + (BLOOM_THRESHOLD_NIGHT - BLOOM_THRESHOLD_DAY) * n;
      weight = BLOOM_WEIGHT_DAY + (BLOOM_WEIGHT_NIGHT - BLOOM_WEIGHT_DAY) * n;
      if (pipeline && pipeline.bloomEnabled) {
        pipeline.bloomThreshold = threshold;
        pipeline.bloomWeight = weight;
      }
      ipc.vignetteWeight = VIGNETTE_WEIGHT_DAY + (VIGNETTE_WEIGHT_NIGHT - VIGNETTE_WEIGHT_DAY) * n;
    },
    dispose: disposePipelines,
  };
}

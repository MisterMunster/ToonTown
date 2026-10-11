// Town materials + small procedural textures. Only a handful of materials are
// used for the entire town (vertex colours carry the palette), which keeps
// shader variants and draw calls low. Night-driven materials expose a
// `setNight(f)` hook.
import { StandardMaterial, Color3, DynamicTexture, Texture, Constants } from "@babylonjs/core";
import { PALETTE } from "../palette.js";

const C = (hex) => Color3.FromHexString(hex);

function canvasTex(scene, name, size, draw, { wrap = true, mips = true } = {}) {
  const tex = new DynamicTexture(name, { width: size, height: size }, scene, mips);
  const ctx = tex.getContext();
  draw(ctx, size);
  tex.update(true);
  tex.wrapU = tex.wrapV = wrap ? Texture.WRAP_ADDRESSMODE : Texture.CLAMP_ADDRESSMODE;
  return tex;
}

function matte(scene, name, { specular = 0.06, lights = 4 } = {}) {
  const m = new StandardMaterial(name, scene);
  m.diffuseColor = new Color3(1, 1, 1);
  m.specularColor = new Color3(specular, specular, specular);
  m.specularPower = 32;
  m.maxSimultaneousLights = lights;
  return m;
}

const smooth = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Create every town material.
 * @returns {{ [name: string]: StandardMaterial } & { setNight(f: number): void, tick(t: number): void }}
 */
export function createTownMaterials(scene) {
  // Vertex-coloured matte "clay" used by nearly everything. Up to 6 lights so
  // the four plaza lamps can add to sun + hemi around the square.
  const solid = matte(scene, "town_solid", { lights: 6 });

  // ---- window glass: soft sky gradient with a diagonal glint -------------
  const glassTex = canvasTex(scene, "town_glassTex", 128, (ctx, s) => {
    const g = ctx.createLinearGradient(0, 0, 0, s);
    g.addColorStop(0, "#d9f1ff");
    g.addColorStop(1, "#7fbfe8");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.beginPath();
    ctx.moveTo(s * 0.15, s);
    ctx.lineTo(s * 0.4, s);
    ctx.lineTo(s * 0.95, 0);
    ctx.lineTo(s * 0.7, 0);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.beginPath();
    ctx.moveTo(s * 0.5, s);
    ctx.lineTo(s * 0.58, s);
    ctx.lineTo(s * 1.1, 0);
    ctx.lineTo(s * 1.02, 0);
    ctx.fill();
  }, { wrap: false });

  const glass = (name, threshold) => {
    const m = new StandardMaterial(name, scene);
    m.diffuseTexture = glassTex;
    m.diffuseColor = new Color3(1, 1, 1);
    m.specularColor = new Color3(0.5, 0.5, 0.5);
    m.specularPower = 64;
    m.emissiveColor = new Color3(0, 0, 0);
    // The night glow is added on top of the lit glass instead of being tinted
    // by the pale-blue glass texture (which turned it a dim green-grey). By
    // day the emissive is black, so the look is identical.
    m.useEmissiveAsIllumination = true;
    m._nightThreshold = threshold;
    return m;
  };
  const glass0 = glass("town_glass0", 0.18);
  const glass1 = glass("town_glass1", 0.38);
  const glass2 = glass("town_glass2", 0.6);
  const glassShop = glass("town_glassShop", 0.08);
  const glassDark = glass("town_glassDark", 9); // never lit
  const litWindows = [glass0, glass1, glass2, glassShop];
  // Lit-window glow: palette windowLit nudged toward cream so the brightest
  // panes cross the night bloom threshold; per-material strength varies a bit.
  const warm = Color3.Lerp(C(PALETTE.windowLit), new Color3(1, 0.94, 0.7), 0.35);
  const windowGain = new Map([[glass0, 1.0], [glass1, 0.9], [glass2, 0.97], [glassShop, 1.05]]);

  // ---- emissive bulbs -------------------------------------------------------
  const bulb = new StandardMaterial("town_bulb", scene);
  const bulbDay = C("#fff6dc");
  bulb.diffuseColor = bulbDay.clone();
  bulb.specularColor = new Color3(0.3, 0.3, 0.3);
  bulb.emissiveColor = C("#5a5040");
  const lampGlow = C(PALETTE.lampGlow);
  // At night the globes burn a warm white-hot (bright enough to bloom).
  const bulbNight = new Color3(1, 0.93, 0.72);

  // fairy lights: vertex-coloured, emissive is multiplied by the bulb colour
  const fairy = matte(scene, "town_fairy", { specular: 0.3 });
  fairy.emissiveColor = new Color3(0.25, 0.25, 0.25);

  // ---- signs (atlas texture assigned later) --------------------------------
  const sign = new StandardMaterial("town_signs", scene);
  sign.diffuseColor = new Color3(1, 1, 1);
  sign.specularColor = new Color3(0.08, 0.08, 0.08);
  sign.emissiveColor = new Color3(0.08, 0.08, 0.08);

  // ---- water ---------------------------------------------------------------
  const waterTex = canvasTex(scene, "town_waterTex", 256, (ctx, s) => {
    ctx.fillStyle = PALETTE.water;
    ctx.fillRect(0, 0, s, s);
    // soft darker blotches
    for (let i = 0; i < 18; i++) {
      const x = (i * 97) % s;
      const y = (i * 61) % s;
      const g = ctx.createRadialGradient(x, y, 0, x, y, 40);
      g.addColorStop(0, "rgba(33,150,201,0.35)");
      g.addColorStop(1, "rgba(33,150,201,0)");
      ctx.fillStyle = g;
      for (const ox of [-s, 0, s]) for (const oy of [-s, 0, s]) {
        ctx.save();
        ctx.translate(ox, oy);
        ctx.fillRect(x - 40, y - 40, 80, 80);
        ctx.restore();
      }
    }
    // cartoon wave glints
    ctx.strokeStyle = "rgba(255,255,255,0.75)";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    for (let i = 0; i < 14; i++) {
      const x = (i * 71 + 13) % s;
      const y = (i * 43 + 29) % s;
      ctx.beginPath();
      ctx.arc(x, y, 9, Math.PI * 1.15, Math.PI * 1.85);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x + 15, y + 2, 7, Math.PI * 1.15, Math.PI * 1.85);
      ctx.stroke();
    }
  });
  const water = new StandardMaterial("town_water", scene);
  water.diffuseTexture = waterTex;
  water.diffuseColor = new Color3(1, 1, 1);
  water.specularColor = new Color3(0.7, 0.7, 0.7);
  water.specularPower = 80;
  water.emissiveColor = new Color3(0.08, 0.12, 0.16);
  water.alpha = 0.88;

  // falling water curtains / jets: scrolling white streaks
  const streamTex = canvasTex(scene, "town_streamTex", 128, (ctx, s) => {
    ctx.clearRect(0, 0, s, s);
    ctx.fillStyle = "rgba(185,230,255,0.28)";
    ctx.fillRect(0, 0, s, s);
    // soft vertical streaks with faded ends (tile vertically)
    for (let i = 0; i < 70; i++) {
      const x = (i * 37 + (i % 7) * 5) % s;
      const w = 1 + (i % 3);
      const y = (i * 53) % s;
      const len = 24 + ((i * 29) % 70);
      for (const oy of [0, -s]) {
        const g = ctx.createLinearGradient(0, y + oy, 0, y + oy + len);
        const a = 0.45 + (i % 4) * 0.12;
        g.addColorStop(0, "rgba(255,255,255,0)");
        g.addColorStop(0.5, `rgba(255,255,255,${a})`);
        g.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = g;
        ctx.fillRect(x, y + oy, w, len);
      }
    }
  });
  streamTex.uScale = 3;
  streamTex.hasAlpha = true;
  const stream = new StandardMaterial("town_stream", scene);
  stream.diffuseTexture = streamTex;
  stream.useAlphaFromDiffuseTexture = true;
  stream.diffuseColor = new Color3(1, 1, 1);
  stream.emissiveColor = new Color3(0.35, 0.45, 0.5);
  stream.specularColor = new Color3(0.15, 0.15, 0.15);
  stream.backFaceCulling = false;

  // ---- lamp light pools (additive decals on the ground at night) ----------
  const poolTex = canvasTex(scene, "town_poolTex", 128, (ctx, s) => {
    ctx.clearRect(0, 0, s, s);
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.35, "rgba(255,255,255,0.55)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  }, { wrap: false });
  poolTex.hasAlpha = true;
  const pool = new StandardMaterial("town_pool", scene);
  pool.diffuseTexture = poolTex;
  pool.useAlphaFromDiffuseTexture = true;
  pool.disableLighting = true;
  pool.emissiveColor = new Color3(0, 0, 0);
  pool.alphaMode = Constants.ALPHA_ADD;
  pool.fogEnabled = false;
  pool.zOffset = -2;
  pool.backFaceCulling = true;

  // ---- double-sided vertex-colour material (flags, leaves, thin cards) ----
  const cloth = matte(scene, "town_cloth");
  cloth.backFaceCulling = false;
  cloth.twoSidedLighting = true;

  // ---- grass tufts / meadow flowers (thin instances, colour per instance) --
  const foliage = matte(scene, "town_tufts");
  foliage.backFaceCulling = false;

  const all = { solid, glass0, glass1, glass2, glassShop, glassDark, bulb, fairy, sign, water, stream, pool, cloth, foliage };
  for (const m of Object.values(all)) m.fogEnabled = m === pool ? false : true;

  let last = -1;
  /** Drive every night-reactive material from nightFactor 0..1. */
  function setNight(f) {
    if (Math.abs(f - last) < 0.004) return;
    last = f;
    for (const m of litWindows) {
      const th = m._nightThreshold;
      const k = smooth(th, th + 0.18, f) * windowGain.get(m);
      m.emissiveColor.copyFromFloats(warm.r * k, warm.g * k, warm.b * k);
      // darken the glass itself as the glow comes up, so the glow reads warm
      const d = 1 - 0.75 * Math.min(1, k);
      m.diffuseColor.copyFromFloats(d, d, d);
    }
    glassDark.diffuseColor.copyFromFloats(1 - 0.6 * f, 1 - 0.55 * f, 1 - 0.42 * f);
    const lamp = smooth(0.08, 0.45, f);
    bulb.emissiveColor.copyFromFloats(0.35 + (bulbNight.r - 0.35) * lamp, 0.31 + (bulbNight.g - 0.31) * lamp, 0.25 + (bulbNight.b - 0.25) * lamp);
    const bd = 1 - 0.7 * lamp; // the moon/sky shouldn't wash the globes white
    bulb.diffuseColor.copyFromFloats(bulbDay.r * bd, bulbDay.g * bd, bulbDay.b * bd);
    const fk = 0.25 + 0.75 * smooth(0.1, 0.5, f);
    fairy.emissiveColor.copyFromFloats(fk, fk, fk);
    // warm amber light pools under every street lamp
    const pk = 0.92 * smooth(0.15, 0.6, f);
    pool.emissiveColor.copyFromFloats(lampGlow.r * pk, lampGlow.g * pk * 0.86, lampGlow.b * pk * 0.62);
    const sk = 0.08 + 0.4 * smooth(0.2, 0.7, f); // shop signs stay readable after dark
    sign.emissiveColor.copyFromFloats(sk, sk, sk * 0.9);
    const wk = smooth(0.2, 0.8, f);
    water.emissiveColor.copyFromFloats(0.08 + 0.05 * wk, 0.12 + 0.18 * wk, 0.16 + 0.3 * wk);
    stream.emissiveColor.copyFromFloats(0.35 + 0.1 * wk, 0.45 + 0.2 * wk, 0.5 + 0.35 * wk);
  }

  /** Scroll water textures. */
  function tick(t) {
    waterTex.uOffset = (t * 0.012) % 1;
    waterTex.vOffset = (t * 0.007) % 1;
    streamTex.vOffset = (t * 0.9) % 1;
  }

  return { ...all, setNight, tick };
}

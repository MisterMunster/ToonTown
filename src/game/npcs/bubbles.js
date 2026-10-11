// Speech bubbles above townsfolk: a small pool of camera-facing planes whose
// textures (one per line of dialogue, drawn lazily into a DynamicTexture and
// cached) show a rounded white bubble with a little tail. Bubbles pop in,
// bob gently, then fade out. They live in rendering group 1 (depth cleared
// after the world) so walls never hide them.

import { DynamicTexture, Matrix, MeshBuilder, Mesh, StandardMaterial, Color3, Texture } from "@babylonjs/core";

const FONT = "600 40px Fredoka, Arial, sans-serif";
const TEXT_COLOR = "#1d2b3a";
const OUTLINE_COLOR = "#1d2b3a";
const OUTLINE_PX = 3;
const PPM = 175; // texture pixels per metre (at distance-scale 1)
const MAX_TEXT_W = 410; // wrap width in px
const LINE_H = 46;
const PAD_X = 28;
const PAD_Y = 16;
const RADIUS = 30;
const TAIL_W = 30;
const TAIL_H = 24;
const MARGIN = 6; // room for the outline + drop shadow
const SHADOW_DY = 5;

const POP_TIME = 0.32;
const HOLD_TIME = 3.0; // fully visible
const FADE_TIME = 0.4;
const HEAD_CLEARANCE = 0.22; // gap between head top and tail tip (m)

const pow2 = (v) => 2 ** Math.ceil(Math.log2(Math.max(2, v)));
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
/** Ease-out with a springy overshoot (scale pop). */
const backOut = (t) => {
  const c = 2.2;
  const u = t - 1;
  return 1 + (c + 1) * u * u * u + c * u * u;
};

function wrapLines(ctx, text) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (cur && ctx.measureText(next).width > MAX_TEXT_W) {
      lines.push(cur);
      cur = w;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 3);
}

/** Rounded rectangle with a tail on its bottom edge whose tip sits at (tipX, tipY). */
function bubblePath(ctx, x, y, w, h, r, tipX, tipY) {
  const bx = tipX + TAIL_W * 0.2; // tail base centre, slightly right so the tip leans left
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(bx + TAIL_W / 2, y + h);
  ctx.quadraticCurveTo(bx + TAIL_W * 0.05, y + h + TAIL_H * 0.55, tipX, tipY);
  ctx.quadraticCurveTo(bx - TAIL_W * 0.2, y + h + TAIL_H * 0.4, bx - TAIL_W / 2, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

/**
 * @param {import("@babylonjs/core").Scene} scene
 * @param {{ maxActive?: number }} [opts]
 */
export function createBubbles(scene, { maxActive = 3 } = {}) {
  const engine = scene.getEngine();
  const cache = new Map(); // text -> { tex, w, h }
  const pool = [];
  let measureCtx = null;

  function measure() {
    if (!measureCtx) {
      const c = engine.createCanvas(16, 16);
      measureCtx = c.getContext("2d");
    }
    measureCtx.font = FONT;
    return measureCtx;
  }

  function draw(entry) {
    const { tex, lines, bw, bh } = entry;
    const ctx = tex.getContext();
    const W = entry.w;
    ctx.clearRect(0, 0, W, entry.h);
    // bubble sits at the bottom of the (power-of-two) texture, tail tip just
    // above the bottom edge, so the mesh origin (bottom centre) is the tip
    const x = (W - bw) / 2;
    const tipX = W / 2;
    const tipY = entry.h - MARGIN - SHADOW_DY;
    const y = tipY - TAIL_H - bh;
    // soft drop shadow
    ctx.save();
    ctx.translate(0, SHADOW_DY);
    bubblePath(ctx, x, y, bw, bh, RADIUS, tipX, tipY);
    ctx.fillStyle = "rgba(29, 43, 58, 0.2)";
    ctx.fill();
    ctx.restore();
    // body
    bubblePath(ctx, x, y, bw, bh, RADIUS, tipX, tipY);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.lineJoin = "round";
    ctx.lineWidth = OUTLINE_PX;
    ctx.strokeStyle = OUTLINE_COLOR;
    ctx.stroke();
    // text
    ctx.font = FONT;
    ctx.fillStyle = TEXT_COLOR;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    lines.forEach((line, i) => ctx.fillText(line, W / 2, y + PAD_Y + LINE_H * (i + 0.5) + 2));
    tex.update();
  }

  /** Cached bubble texture for a line of text (created on first use). */
  function textureFor(text) {
    let entry = cache.get(text);
    if (entry) return entry;
    const m = measure();
    const lines = wrapLines(m, text);
    let textW = 0;
    for (const l of lines) textW = Math.max(textW, m.measureText(l).width);
    const bw = Math.ceil(Math.max(textW + PAD_X * 2, RADIUS * 2 + TAIL_W + 12));
    const bh = lines.length * LINE_H + PAD_Y * 2;
    const w = pow2(bw + MARGIN * 2);
    const h = pow2(bh + TAIL_H + MARGIN * 2 + SHADOW_DY);
    const tex = new DynamicTexture(`npcBubble_${cache.size}`, { width: w, height: h }, scene, true, Texture.TRILINEAR_SAMPLINGMODE);
    tex.hasAlpha = true;
    // the real texture size can differ (POT rounding on old devices): draw in its space
    const size = tex.getSize();
    entry = { tex, lines, bw, bh, w: size.width || w, h: size.height || h };
    cache.set(text, entry);
    draw(entry);
    // If the bundled Fredoka face isn't loaded yet, redraw once it is.
    const fonts = typeof document !== "undefined" ? document.fonts : null;
    try {
      if (fonts?.check && !fonts.check(FONT)) fonts.load(FONT).then(() => draw(entry)).catch(() => {});
    } catch {
      /* font API unavailable: keep the fallback face */
    }
    return entry;
  }

  function makeSlot(i) {
    const mesh = MeshBuilder.CreatePlane(`npcBubble${i}`, { width: 1, height: 1 }, scene);
    // origin at the bottom centre (the tail tip), so scaling pops out of the head
    mesh.bakeTransformIntoVertices(Matrix.Translation(0, 0.5, 0));
    mesh.billboardMode = Mesh.BILLBOARDMODE_ALL;
    mesh.renderingGroupId = 1;
    mesh.isPickable = false;
    mesh.receiveShadows = false;
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.setEnabled(false);
    const mat = new StandardMaterial(`npcBubbleMat${i}`, scene);
    // unlit: with lighting disabled only the emissive term reaches the texture
    mat.disableLighting = true;
    mat.diffuseColor = new Color3(1, 1, 1);
    mat.specularColor = new Color3(0, 0, 0);
    mat.emissiveColor = new Color3(1, 1, 1);
    mat.useAlphaFromDiffuseTexture = true;
    mat.fogEnabled = false;
    mesh.material = mat;
    return { mesh, mat, active: false, t: 0, target: null, entry: null };
  }

  /**
   * Show a bubble above `target` ({x, y, z} feet position, `height` in m, read every frame).
   * Replaces the target's current bubble, or the oldest one if the pool is full.
   */
  function show(target, text) {
    let slot = pool.find((s) => s.active && s.target === target) ?? pool.find((s) => !s.active);
    if (!slot && pool.length < maxActive) {
      slot = makeSlot(pool.length);
      pool.push(slot);
    }
    if (!slot) slot = pool.reduce((a, b) => (b.t > a.t ? b : a));
    const entry = textureFor(text);
    slot.entry = entry;
    slot.mat.diffuseTexture = entry.tex;
    slot.target = target;
    slot.t = 0;
    slot.active = true;
    slot.mesh.scaling.setAll(0.001);
    place(slot, null);
    slot.mesh.setEnabled(true);
  }

  function place(slot, camPos) {
    const { target, entry, mesh, t } = slot;
    const fade = smoothstep(HOLD_TIME, HOLD_TIME + FADE_TIME, t);
    const pop = t < POP_TIME ? backOut(t / POP_TIME) : 1;
    const bob = Math.sin(t * 3.2) * 0.03;
    const x = target.x;
    const y = target.y + (target.height ?? 1.55) + HEAD_CLEARANCE + bob + fade * 0.25;
    const z = target.z;
    mesh.position.set(x, y, z);
    // keep roughly constant on-screen size: bigger when the camera is far away
    let k = 1;
    if (camPos) {
      const d = Math.hypot(camPos.x - x, camPos.y - y, camPos.z - z);
      k = clamp(d / 9, 0.75, 1.7);
    }
    const s = Math.max(0.001, pop * (1 - 0.15 * fade) * k);
    mesh.scaling.set((entry.w / PPM) * s, (entry.h / PPM) * s, 1);
    slot.mat.alpha = 1 - fade;
  }

  /** Advance animations. @param {number} dt @param {import("@babylonjs/core").Vector3|null} camPos */
  function update(dt, camPos) {
    for (const slot of pool) {
      if (!slot.active) continue;
      slot.t += dt;
      if (slot.t >= HOLD_TIME + FADE_TIME) {
        slot.active = false;
        slot.target = null;
        slot.mesh.setEnabled(false);
        continue;
      }
      place(slot, camPos);
    }
  }

  /** Build the first bubble up front and compile its shader, so the first greeting doesn't hitch. */
  function prewarm(text) {
    try {
      const slot = makeSlot(pool.length);
      pool.push(slot);
      slot.entry = textureFor(text);
      slot.mat.diffuseTexture = slot.entry.tex;
      slot.mat.forceCompilation(slot.mesh);
    } catch (err) {
      console.warn("[npcs] bubble prewarm failed", err);
    }
  }

  /** True while `target` has a bubble on screen. */
  function isShowing(target) {
    return pool.some((s) => s.active && s.target === target);
  }

  function dispose() {
    for (const s of pool) {
      s.mesh.dispose();
      s.mat.dispose();
    }
    for (const e of cache.values()) e.tex.dispose();
    pool.length = 0;
    cache.clear();
  }

  return { show, update, isShowing, prewarm, dispose, lifetime: HOLD_TIME + FADE_TIME };
}

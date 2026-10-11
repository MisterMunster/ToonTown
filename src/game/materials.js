import { StandardMaterial, Color3 } from "@babylonjs/core";

// Cached matte "clay/toy" materials. Reusing materials keeps draw calls and
// shader compiles down, and makes Mesh.MergeMeshes by material effective.
const cache = new WeakMap(); // scene -> Map(key -> material)

function sceneCache(scene) {
  let m = cache.get(scene);
  if (!m) {
    m = new Map();
    cache.set(scene, m);
  }
  return m;
}

/**
 * Get (or create) a shared matte material.
 * @param {import("@babylonjs/core").Scene} scene
 * @param {string} hex  e.g. "#ffcc33"
 * @param {{emissive?: number|string, specular?: number, alpha?: number, name?: string, backFaceCulling?: boolean}} [opts]
 *   emissive: 0..1 multiplier of the base color, or a hex string for an explicit emissive color.
 */
export function toonMat(scene, hex, opts = {}) {
  const { emissive = 0, specular = 0.06, alpha = 1, backFaceCulling = true } = opts;
  const key = `${hex}|${emissive}|${specular}|${alpha}|${backFaceCulling}`;
  const c = sceneCache(scene);
  if (c.has(key)) return c.get(key);

  const mat = new StandardMaterial(opts.name ?? `toon_${hex}_${c.size}`, scene);
  const base = Color3.FromHexString(hex);
  mat.diffuseColor = base;
  mat.specularColor = new Color3(specular, specular, specular);
  mat.specularPower = 32;
  if (typeof emissive === "string") mat.emissiveColor = Color3.FromHexString(emissive);
  else if (emissive > 0) mat.emissiveColor = base.scale(emissive);
  if (alpha < 1) mat.alpha = alpha;
  mat.backFaceCulling = backFaceCulling;
  c.set(key, mat);
  return mat;
}

/** A unique (non-cached) material, for things whose color animates (e.g. lit windows). */
export function uniqueMat(scene, name, hex, opts = {}) {
  const mat = new StandardMaterial(name, scene);
  mat.diffuseColor = Color3.FromHexString(hex);
  const s = opts.specular ?? 0.06;
  mat.specularColor = new Color3(s, s, s);
  if (opts.emissive) mat.emissiveColor = Color3.FromHexString(opts.emissive);
  return mat;
}

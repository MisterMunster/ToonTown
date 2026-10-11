// Character "looks": every visual choice (colors, hair, clothes, accessories,
// proportions) as one plain object. The hero preset is hand-tuned; the
// "random" preset derives a townsperson deterministically from a seed.

import { PALETTE, makeRng } from "../palette.js";

export const HAIR_STYLES = ["spiky", "bob", "bun", "ponytail", "curly", "bald"];
export const HEADWEAR = ["cap", "beanie", "none"];
export const ACCESSORIES = ["backpack", "scarf", "glasses", "none"];

/** Pip, the hero: red backwards cap, sunny hoodie, blue shorts, teal backpack. */
const HERO = {
  skin: "#f7c9a0",
  hair: "#a0592c",
  hairStyle: "spiky",
  iris: "#5a3418",
  top: "hoodie",
  shirt: PALETTE.ui.primary, // sunny orange-yellow
  bottom: "shorts",
  pants: "#3f7fe0",
  socks: "#ffffff",
  sockStripe: "#e23c3c",
  shoes: "#fbfaf6",
  sole: "#e7dccb",
  shoeAccent: "#e23c3c",
  headwear: "cap",
  headwearColor: "#e23c3c",
  capBackwards: true,
  accessory: "backpack",
  accessoryColor: "#1fb3a3",
  mouth: "grin",
  height: 1,
  width: 1,
  eyeScale: 1,
  blush: 0.55,
  freckles: false,
};

const SHOE_COLORS = ["#fbfaf6", "#6b4a32", "#2f3440", "#e05d5d", "#4d96ff", "#f2c14e"];
const IRIS_COLORS = ["#4a2c17", "#3a5a8c", "#3f6b3a", "#6b4a2a", "#2c2c38"];
const ACCENT_COLORS = ["#ffffff", "#ffd93d", "#ff6b9d", "#6bcb77", "#4d96ff", "#c77dff", "#ff8c42"];

/**
 * Seeded townsperson. Never produces Pip's signature combination (red
 * backwards cap + orange-yellow hoodie + teal backpack) so the hero stays
 * unique in a crowd.
 */
function randomLook(seed) {
  const rng = makeRng(((seed | 0) * 7919 + 104729) >>> 0);
  const r = () => rng();
  const pickR = (arr) => arr[Math.floor(r() * arr.length) % arr.length];
  // Low-discrepancy picks for the most visible traits, so consecutive seeds
  // (how the NPC module numbers townsfolk) always look clearly different.
  const spread = (arr, alpha, salt) => arr[Math.floor((((seed * alpha + salt) % 1) + 1) % 1 * arr.length) % arr.length];
  const chance = (p) => r() < p;

  const hairStyle = spread(HAIR_STYLES, 0.41421356, 0.13);
  let hair = spread(PALETTE.hair, 0.7548777, 0.31);
  if (hairStyle === "bald") hair = chance(0.7) ? "#9e9e9e" : "#d9d4cc";
  const shirts = PALETTE.shirts.filter((c) => c !== "#ff8c42");
  const shirt = spread(shirts, 0.61803399, 0.05);
  const top = pickR(["hoodie", "tee", "tee", "longsleeve"]);
  const bottom = spread(["shorts", "pants", "skirt", "pants"], 0.5698403, 0.41);
  let headwear = "none";
  const hw = r();
  if (hairStyle !== "bun" && hairStyle !== "curly") {
    if (hw < 0.24) headwear = "cap";
    else if (hw < 0.4) headwear = "beanie";
  }
  let headwearColor = pickR(ACCENT_COLORS.concat(PALETTE.shirts));
  if (headwearColor === shirt) headwearColor = pickR(ACCENT_COLORS);
  let accessory = "none";
  const ac = r();
  if (ac < 0.18) accessory = "backpack";
  else if (ac < 0.34) accessory = "scarf";
  else if (ac < 0.52) accessory = "glasses";
  let accessoryColor = pickR(ACCENT_COLORS.concat(PALETTE.shirts));
  if (accessoryColor === shirt) accessoryColor = pickR(["#ffffff", "#2f4b7c", "#ff6b9d"]);
  const sockColor = pickR(["#ffffff", "#ffffff", "#ffd93d", "#ff6b9d", "#4d96ff"]);

  return {
    skin: spread(PALETTE.skin, 0.3819660, 0.77),
    hair,
    hairStyle,
    iris: pickR(IRIS_COLORS),
    top,
    shirt,
    bottom,
    pants: spread(PALETTE.pants, 0.8191725, 0.2),
    socks: sockColor,
    sockStripe: chance(0.5) ? pickR(ACCENT_COLORS) : null,
    shoes: pickR(SHOE_COLORS),
    sole: chance(0.6) ? "#efe8dc" : "#3d3a3a",
    shoeAccent: chance(0.5) ? pickR(ACCENT_COLORS) : null,
    headwear,
    headwearColor,
    capBackwards: false,
    accessory,
    accessoryColor,
    mouth: pickR(["smile", "smile", "grin", "open"]),
    height: 0.9 + r() * 0.18,
    width: 0.92 + r() * 0.2,
    eyeScale: 0.88 + r() * 0.2,
    blush: 0.25 + r() * 0.35,
    freckles: chance(0.2),
    mustache: hairStyle === "bald" ? chance(0.65) : chance(0.06),
  };
}

const CSS_HEX = /^#[0-9a-f]{6}$/i;
const okColor = (c) => typeof c === "string" && CSS_HEX.test(c);

/**
 * Resolve createCharacter() options into a complete look.
 * Explicit options (skin, hair, hairStyle, shirt, pants, shoes, accessory,
 * headwear...) override the preset.
 */
export function resolveLook(opts = {}) {
  const base = opts.preset === "hero" ? { ...HERO } : opts.preset === "random" || opts.seed != null ? randomLook(opts.seed ?? 1) : { ...HERO, headwear: "none", accessory: "none", capBackwards: false };
  const look = { ...base };
  for (const k of ["skin", "hair", "shirt", "pants", "shoes", "iris", "headwearColor", "accessoryColor"]) {
    if (okColor(opts[k])) look[k] = opts[k];
  }
  if (HAIR_STYLES.includes(opts.hairStyle)) {
    look.hairStyle = opts.hairStyle;
    if (opts.hairStyle === "bald" && !okColor(opts.hair)) look.hair = "#a8a8a8";
  }
  if (HEADWEAR.includes(opts.headwear)) look.headwear = opts.headwear;
  if (ACCESSORIES.includes(opts.accessory)) look.accessory = opts.accessory;
  if (["hoodie", "tee", "longsleeve"].includes(opts.top)) look.top = opts.top;
  if (["shorts", "pants", "skirt"].includes(opts.bottom)) look.bottom = opts.bottom;
  if (typeof opts.capBackwards === "boolean") look.capBackwards = opts.capBackwards;
  if (typeof opts.mustache === "boolean") look.mustache = opts.mustache;
  // A cap needs somewhere to sit: buns/curls poke through it, swap for a beanie-free look.
  if (look.headwear !== "none" && (look.hairStyle === "bun" || look.hairStyle === "curly")) look.headwear = "none";
  return look;
}

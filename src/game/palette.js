// Shared cartoon palette. Every module should pull colors from here so the
// whole town reads as one art style: bright, saturated, toy-like, matte.
export const PALETTE = {
  sky: "#8fd3ff",
  skyHorizon: "#dff4ff",
  fog: "#cfeaff",

  grass: "#7ccf5b",
  grassDark: "#5fae45",
  dirt: "#c8a26b",
  sand: "#f3dfa2",
  water: "#4fc3f7",
  waterDeep: "#2196c9",

  road: "#5b5f6b",
  roadLine: "#ffe27a",
  crosswalk: "#f4f4f4",
  sidewalk: "#ddd5c7",
  curb: "#bdb5a6",
  plaza: "#e8d9bd",
  plazaAccent: "#d4bf98",

  walls: ["#ffd1dc", "#ffe6a7", "#bde0fe", "#caffbf", "#ffc6a5", "#e4c1f9", "#fdf0d5", "#a0e7e5"],
  roofs: ["#e05d5d", "#5d7be0", "#8e5de0", "#e0915d", "#4f9d69", "#c0504d"],
  trim: "#ffffff",
  door: "#8a5a3b",

  wood: "#a0673a",
  woodDark: "#7a4a28",
  stone: "#b8b8c0",
  stoneDark: "#8d8d99",
  metal: "#4a4f5a",
  metalLight: "#9aa3b0",

  trunk: "#8b5a2b",
  foliage: ["#4caf50", "#66bb6a", "#81c784", "#2e7d32", "#9ccc65"],
  flowers: ["#ff6b9d", "#ffd93d", "#ff8c42", "#c77dff", "#ffffff", "#ff5d5d"],

  lampGlow: "#ffd27a",
  windowLit: "#ffe08a",
  windowDay: "#9fd8ff",

  skin: ["#ffdbac", "#f1c27d", "#e0ac69", "#c68642", "#8d5524"],
  hair: ["#3b2414", "#6b3e1f", "#e8c26b", "#1c1c1c", "#c0502e", "#9e9e9e"],
  shirts: ["#ff5d5d", "#4d96ff", "#6bcb77", "#ffd93d", "#c77dff", "#ff8c42", "#00b4d8"],
  pants: ["#2f4b7c", "#3d3d3d", "#7a5c3e", "#4a6fa5", "#5c4b8a"],

  coin: "#ffcc33",
  ui: { primary: "#ffb703", accent: "#fb8500", dark: "#1d2b3a", light: "#fffaf0" },
};

/** Pick a deterministic element of an array from an integer/seed. */
export function pick(arr, seed) {
  const i = Math.abs(Math.floor(seed)) % arr.length;
  return arr[i];
}

/** Small deterministic PRNG (mulberry32) so the town looks the same every load. */
export function makeRng(seed = 1337) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

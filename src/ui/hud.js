// HUD & menus: loading screen, title/start screen, in-game HUD (player card,
// coin counter, zone banner, toasts, minimap + clock, hotbar, help card, FPS),
// pause menu and the "all coins" celebration. Plain HTML/CSS inside #hud-root
// (no Babylon GUI). Contract: ARCHITECTURE.md → "HUD".
//
// Performance: update() runs every frame but only touches the DOM when a
// displayed value actually changes; the minimap redraws at <= 30 fps from a
// static map pre-rendered once in setMap().

import { ICONS, ITEM_ICONS, PIP_PORTRAIT, LANDMARK_GLYPHS } from "./icons.js";
import { makeRng } from "../game/palette.js";

// Stylesheet. Vite rewrites this eager glob into a static CSS import (bundled,
// no flash of unstyled content). In plain Node (the headless smoke test, which
// cannot import .css) import.meta.env is undefined, so the line is skipped.
if (import.meta.env) import.meta.glob("./hud.css", { eager: true });

// ---------------------------------------------------------------------------
// Static data
// ---------------------------------------------------------------------------

/** Hotbar contents. Visual only: using an item shows a "coming soon" toast. */
export const HOTBAR_ITEMS = Object.freeze(
  [
    { id: "sword", name: "Wooden Sword", rarity: "common", qty: 1 },
    { id: "shield", name: "Round Shield", rarity: "common", qty: 1 },
    { id: "potion", name: "Health Potion", rarity: "rare", qty: 3 },
    { id: "bubbles", name: "Bubble Wand", rarity: "epic", qty: 1 },
    { id: "key", name: "Golden Key", rarity: "legendary", qty: 1 },
    { id: "map", name: "Treasure Map", rarity: "rare", qty: 1 },
    { id: "camera", name: "Camera", rarity: "rare", qty: 1 },
    { id: "rod", name: "Fishing Rod", rarity: "common", qty: 1 },
  ].map((item) => Object.freeze(item)),
);

const RARITY = {
  common: { label: "Common", color: "#98a2b3" },
  rare: { label: "Rare", color: "#4d96ff" },
  epic: { label: "Epic", color: "#a259ff" },
  legendary: { label: "Legendary", color: "#f2a900" },
};

const TIPS_KEYS = [
  "Tip: press <b>Space</b> twice to double jump!",
  "Tip: some coins hide on rooftops…",
  "Tip: press <b>N</b> to change the time of day",
  "Tip: hold <b>Shift</b> to run",
  "Tip: drag with the mouse to look around",
];
const TIPS_TOUCH = [
  "Tip: tap <b>JUMP</b> twice to double jump!",
  "Tip: some coins hide on rooftops…",
  "Tip: the clock button changes the time of day",
  "Tip: drag the view to look around",
];

const DAYNIGHT_MODES = ["cycle", "day", "sunset", "night"];
const DAYNIGHT = {
  cycle: { label: "Cycle", toast: "Time of day: full day/night cycle", icon: "cycle" },
  day: { label: "Day", toast: "Time of day: sunny day", icon: "sun" },
  sunset: { label: "Sunset", toast: "Time of day: golden sunset", icon: "sunset" },
  night: { label: "Night", toast: "Time of day: starry night", icon: "moon" },
};
const QUALITY_LEVELS = ["low", "medium", "high"];

/** Keys that alone never dismiss the title screen. */
const MODIFIER_KEYS = new Set([
  "Shift", "Control", "Alt", "AltGraph", "Meta", "OS", "Super", "Hyper",
  "CapsLock", "NumLock", "ScrollLock", "Fn", "FnLock", "Dead", "Unidentified",
]);
/** KeyboardEvent.code → hotbar slot index. */
const SLOT_CODES = Object.create(null);
for (let i = 1; i <= 8; i++) SLOT_CODES[`Digit${i}`] = SLOT_CODES[`Numpad${i}`] = i - 1;

const LOGO_COLORS = ["#ff5d5d", "#ffb703", "#5cc46a", "#4d96ff", "#c77dff", "#ff8c42", "#12b5d6", "#ff6b9d"];
const LOGO_TILT = [-6, 3, -3, 5, -4, 3, -2, 5];
const GOLD_COLORS = ["#ffc93c", "#ffb703", "#ffd25a", "#fb9b00"];
const AVATAR_COLORS = ["#ff5d5d", "#4d96ff", "#5cc46a", "#c77dff", "#ff8c42", "#12b5d6", "#ff6b9d", "#e0a400"];

const NAVY = "#1d2b3a";
const CREAM = "#fffaf0";
const TAU = Math.PI * 2;

// Minimap: meters visible from the center to the rim, redraw rate, palette.
const MAP_VIEW_RADIUS = 45;
const MAP_FRAME_TIME = 1 / 30;
const MAP = {
  outside: "#74c158",
  ground: "#9bd97b",
  park: "#7ccd5c",
  parkEdge: "#58a940",
  water: "#5cc8f5",
  waterEdge: "#2f9fd6",
  waterShine: "#9fe1fb",
  plaza: "#f3e3c3",
  plazaEdge: "#d6c095",
  sidewalk: "#efe6d4",
  road: "#6f7787",
  roadLine: "#ffe27a",
  tree: "#3f9e48",
  treeEdge: "#2a7634",
};
const FEATURE_ORDER = ["park", "water", "plaza", "sidewalk", "road", "tree", "building"];

// ---------------------------------------------------------------------------
// Markup helpers
// ---------------------------------------------------------------------------

function el(tag, className, html) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html != null) node.innerHTML = html;
  return node;
}

const kbd = (label, mod = "") => `<kbd class="tt-key${mod ? ` ${mod}` : ""}">${label}</kbd>`;
const or = (t = "or") => `<span class="tt-keys-or">${t}</span>`;

// Inverted-T arrow keys; every key has an explicit grid cell (see .tt-arrows).
const ARROW_CLUSTER =
  `<span class="tt-arrows">${kbd(ICONS.arrowUp, "tt-key--icon k-up")}${kbd(ICONS.arrowLeft, "tt-key--icon k-left")}` +
  `${kbd(ICONS.arrowDown, "tt-key--icon k-down")}${kbd(ICONS.arrowRight, "tt-key--icon k-right")}</span>`;
const ARROWS_INLINE = kbd(`${ICONS.arrowLeft}${ICONS.arrowUp}${ICONS.arrowDown}${ICONS.arrowRight}`, "tt-key--sm tt-key--icon");

/** Title-screen controls card: [keys, label, sublabel]. */
const CONTROLS_KEYS = [
  [`${ARROW_CLUSTER}${or()}${kbd("WASD", "tt-key--sm")}`, "Move"],
  [kbd("Space", "tt-key--wide"), "Jump", "×2 double jump"],
  [kbd("Shift", "tt-key--wide"), "Run", "hold"],
  [kbd(ICONS.mouse, "tt-key--plain"), "Camera", "drag to orbit"],
  [`${kbd("1")}${or("–")}${kbd("8")}`, "Items", "Q / E to cycle"],
  [kbd("N"), "Time of day"],
  [kbd("M"), "Sound"],
  [kbd("Esc"), "Menu"],
];
const CONTROLS_TOUCH = [
  [kbd(ICONS.dpad, "tt-key--plain"), "Move", "D-pad"],
  [kbd("JUMP", "tt-key--pill"), "Jump", "tap twice: double"],
  [kbd("RUN", "tt-key--pill"), "Run", "toggle"],
  [kbd(ICONS.hand, "tt-key--plain"), "Look", "drag the view"],
  [kbd("Tap", "tt-key--sm"), "Items", "tap a slot"],
  [kbd(ICONS.menu, "tt-key--plain"), "Menu", "top right"],
];
/** Compact rows for the help card / pause menu: [label, keys]. */
const HELP_ROWS = [
  ["Move", `${kbd("WASD", "tt-key--sm")}${or("/")}${ARROWS_INLINE}`],
  ["Jump · double", `${kbd("Space", "tt-key--sm")}${or("×2")}`],
  ["Run", kbd("Shift", "tt-key--sm")],
  ["Camera", `${kbd("Drag", "tt-key--sm")}${or("·")}${kbd("C", "tt-key--sm")}`],
  ["Items · use", `${kbd("1–8", "tt-key--sm")}${kbd("Q", "tt-key--sm")}${kbd("E", "tt-key--sm")}${kbd("F", "tt-key--sm")}`],
  ["Time of day", kbd("N", "tt-key--sm")],
  ["Sound", kbd("M", "tt-key--sm")],
  ["Menu", kbd("Esc", "tt-key--sm")],
];
const REF_EXTRA_ROWS = [
  ["Toggle this help", kbd("H", "tt-key--sm")],
  ["FPS counter", kbd("`", "tt-key--sm")],
];
const TOUCH_ROWS = [
  ["Move", kbd(ICONS.dpad, "tt-key--plain")],
  ["Jump · double", `${kbd("JUMP", "tt-key--sm tt-key--pill")}${or("×2")}`],
  ["Run (toggle)", kbd("RUN", "tt-key--sm tt-key--pill")],
  ["Look around", kbd(ICONS.hand, "tt-key--plain")],
  ["Items", kbd("Tap a slot", "tt-key--sm")],
];

const ctlHTML = ([keys, label, sub]) =>
  `<div class="tt-ctl"><span class="tt-ctl-keys">${keys}</span><span class="tt-ctl-label">${label}${sub ? `<small>${sub}</small>` : ""}</span></div>`;
const rowHTML = ([label, keys]) => `<div class="tt-help-row"><span>${label}</span><span class="tt-keys">${keys}</span></div>`;

/** Big outlined bouncy letters (logo + celebration banner). */
function logoHTML(words, colors, tilts) {
  let i = 0;
  return words
    .map((word) => {
      const letters = [...word]
        .map((ch) => {
          const k = i++;
          return `<span class="tt-logo-ch" data-ch="${ch}" style="--c:${colors[k % colors.length]};--r:${tilts[k % tilts.length]}deg;--i:${k}"><span>${ch}</span></span>`;
        })
        .join("");
      return `<span class="tt-logo-word">${letters}</span>`;
    })
    .join("");
}

const CLOUD_PATH = "M38 86A22 22 0 0 1 42 43A30 30 0 0 1 96 29A26 26 0 0 1 142 39A26 26 0 0 1 162 86Z";
const CLOUD_SVG = `<svg viewBox="0 0 200 100" aria-hidden="true"><path d="${CLOUD_PATH}" fill="#c9e6fa" transform="translate(0 7)"/><path d="${CLOUD_PATH}" fill="#fff"/></svg>`;
const CLOUDS = [
  { y: "7%", s: 1.3, d: 95, o: -20 },
  { y: "20%", s: 0.75, d: 70, o: -52, a: 0.85 },
  { y: "3%", s: 0.62, d: 80, o: -66, a: 0.8 },
  { y: "29%", s: 1.05, d: 110, o: -86 },
  { y: "14%", s: 0.9, d: 88, o: -5 },
  { y: "36%", s: 0.55, d: 64, o: -30, a: 0.78 },
];

const hillHouse = (x, y, wall, roof) =>
  `<g transform="translate(${x} ${y})"><rect x="-15" y="-26" width="30" height="28" rx="2" fill="${wall}" stroke="${NAVY}" stroke-width="3"/>` +
  `<path d="M-21 -23L0 -44L21 -23Z" fill="${roof}" stroke="${NAVY}" stroke-width="3" stroke-linejoin="round"/>` +
  `<rect x="-4.5" y="-12" width="9" height="14" rx="2" fill="#8a5a3b" stroke="${NAVY}" stroke-width="2"/>` +
  `<rect x="5" y="-21" width="7" height="6" rx="1.5" fill="#ffe08a" stroke="${NAVY}" stroke-width="2"/></g>`;
const hillTree = (x, y, s, c) =>
  `<g transform="translate(${x} ${y}) scale(${s})"><rect x="-3" y="-16" width="6" height="18" fill="#8b5a2b" stroke="${NAVY}" stroke-width="2.5"/>` +
  `<circle cx="0" cy="-28" r="15" fill="${c}" stroke="${NAVY}" stroke-width="3"/><circle cx="-5" cy="-33" r="4.5" fill="#fff" opacity=".28"/></g>`;
const HILLS_SVG = `<svg viewBox="0 0 1440 320" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
<path d="M-10 196C200 136 380 146 560 182S900 146 1080 168S1340 136 1450 156V330H-10Z" fill="#b8e59c" stroke="${NAVY}" stroke-width="3"/>
${hillTree(180, 208, 0.8, "#81c784")}${hillHouse(250, 206, "#ffd1dc", "#e05d5d")}${hillHouse(328, 210, "#bde0fe", "#5d7be0")}${hillTree(392, 214, 0.9, "#66bb6a")}
${hillTree(640, 222, 0.85, "#4caf50")}${hillHouse(700, 222, "#e4c1f9", "#4f9d69")}
${hillHouse(1010, 210, "#ffe6a7", "#8e5de0")}${hillTree(1075, 212, 1, "#4caf50")}${hillHouse(1140, 212, "#caffbf", "#e0915d")}
<path d="M-10 236C220 194 440 204 660 228S1080 200 1280 220S1420 212 1450 210V330H-10Z" fill="#86d366" stroke="${NAVY}" stroke-width="3"/>
${hillTree(90, 268, 1.1, "#4caf50")}${hillTree(500, 268, 0.95, "#66bb6a")}${hillTree(880, 262, 1.05, "#2e7d32")}${hillTree(1330, 262, 1.15, "#66bb6a")}
<path d="M-10 280C300 260 620 268 900 280S1300 266 1450 272V330H-10Z" fill="#6cc04e" stroke="${NAVY}" stroke-width="3"/>
</svg>`;

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

const HTML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const escapeHTML = (s) => String(s).replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);

/** Darken (amt < 0) or lighten (amt > 0) a #rrggbb color. */
function shade(hex, amt) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ""));
  if (!m) return NAVY;
  const n = parseInt(m[1], 16);
  const f = (c) => Math.round(amt < 0 ? c * (1 + amt) : c + (255 - c) * amt);
  const r = f(n >> 16), g = f((n >> 8) & 255), b = f(n & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

/** Rounded-rect path (works everywhere, unlike ctx.roundRect). */
function rrect(g, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** Run a Web Animation if the API exists (it does not in the Node smoke test). */
function play(node, frames, opts) {
  if (node && typeof node.animate === "function") {
    try {
      return node.animate(frames, opts);
    } catch {
      /* ignore */
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Minimap (canvas): static map pre-rendered once, dynamic layer <= 30 fps.
// ---------------------------------------------------------------------------

function createMinimap(canvas) {
  const ctx = canvas && canvas.getContext ? canvas.getContext("2d") : null;
  const hasPath2D = typeof Path2D === "function";
  let size = 0; // CSS px
  let dpr = 1;
  let R = 0; // center / outer radius
  let inner = 0; // radius of the map disc
  let k = 1; // CSS px per meter
  let ring = 14; // compass band width
  let cone = null; // camera view-cone gradient
  let town = null;
  let base = null; // { canvas, minX, maxZ, S }
  let landmarks = []; // { x, z, glyph, sprite }
  let spriteSize = 20;
  let compassFont = "700 11.5px Fredoka, system-ui, sans-serif";

  /** Pick the glyph for a landmark by keyword (icon first, then name). */
  function glyphFor(lm) {
    const key = `${lm.icon || ""} ${lm.name || ""}`.toLowerCase();
    return LANDMARK_GLYPHS.find((g) => g.match.test(key)) || LANDMARK_GLYPHS[LANDMARK_GLYPHS.length - 1];
  }

  function makeSprite(glyph) {
    const px = spriteSize;
    const c = document.createElement("canvas");
    c.width = c.height = Math.ceil(px * dpr);
    const g = c.getContext && c.getContext("2d");
    if (!g) return null;
    g.scale(dpr, dpr);
    const r = px / 2;
    g.beginPath();
    g.arc(r, r, r - 0.5, 0, TAU);
    g.fillStyle = NAVY;
    g.fill();
    g.beginPath();
    g.arc(r, r, r - 1.9, 0, TAU);
    g.fillStyle = glyph.color;
    g.fill();
    if (hasPath2D) {
      const s = (px * 0.62) / 24;
      g.translate(r - 12 * s, r - 12 * s);
      g.scale(s, s);
      g.fillStyle = "#fff";
      g.fill(new Path2D(glyph.path), glyph.evenodd ? "evenodd" : "nonzero");
    }
    return c;
  }

  /** Static-map resolution: ~1.25 texels per device pixel at the current zoom. */
  const wantedScale = () => Math.max(2, Math.min(6, Math.ceil(k * dpr * 1.25)));

  function buildBase() {
    base = null;
    if (!town) return;
    const feats = Array.isArray(town.mapFeatures) ? town.mapFeatures : [];
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    const grow = (x0, x1, z0, z1) => {
      if (x0 < minX) minX = x0;
      if (x1 > maxX) maxX = x1;
      if (z0 < minZ) minZ = z0;
      if (z1 > maxZ) maxZ = z1;
    };
    for (const f of feats) {
      if (!f || !Number.isFinite(f.x) || !Number.isFinite(f.z)) continue;
      const hw = f.rot ? Math.hypot(f.w || 0, f.d || 0) / 2 : (f.w || 0) / 2;
      const hd = f.rot ? hw : (f.d || 0) / 2;
      grow(f.x - hw, f.x + hw, f.z - hd, f.z + hd);
    }
    const b = town.bounds;
    if (b && Number.isFinite(b.minX)) grow(b.minX, b.maxX, b.minZ, b.maxZ);
    if (!Number.isFinite(minX)) {
      minX = minZ = -60;
      maxX = maxZ = 60;
    }
    const pad = MAP_VIEW_RADIUS + 8;
    minX -= pad;
    maxX += pad;
    minZ -= pad;
    maxZ += pad;
    const S = Math.min(wantedScale(), 4096 / Math.max(maxX - minX, maxZ - minZ));

    const c = document.createElement("canvas");
    c.width = Math.ceil((maxX - minX) * S);
    c.height = Math.ceil((maxZ - minZ) * S);
    const g = c.getContext && c.getContext("2d");
    if (!g) return;
    const px = (x) => (x - minX) * S;
    const pz = (z) => (maxZ - z) * S;

    g.fillStyle = MAP.outside;
    g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = MAP.ground;
    if (b && Number.isFinite(b.minX)) {
      rrect(g, px(b.minX), pz(b.maxZ), (b.maxX - b.minX) * S, (b.maxZ - b.minZ) * S, 6 * S);
      g.fill();
    } else {
      g.fillRect(0, 0, c.width, c.height);
    }

    g.lineJoin = "round";
    for (const kind of FEATURE_ORDER) {
      for (const f of feats) {
        if (!f || f.kind !== kind) continue;
        const w = (f.w || 0) * S;
        const d = (f.d || 0) * S;
        if (!(w > 0 && d > 0)) continue;
        g.save();
        g.translate(px(f.x), pz(f.z));
        if (f.rot) g.rotate(f.rot);
        drawFeature(g, kind, f, w, d, S);
        g.restore();
      }
    }
    base = { canvas: c, minX, maxZ, S };
  }

  function drawFeature(g, kind, f, w, d, S) {
    const x = -w / 2;
    const y = -d / 2;
    switch (kind) {
      case "park":
        rrect(g, x, y, w, d, 2.5 * S);
        g.fillStyle = MAP.park;
        g.fill();
        g.lineWidth = 0.5 * S;
        g.strokeStyle = MAP.parkEdge;
        g.stroke();
        break;
      case "water": {
        const r = f.shape === "circle" ? Math.min(w, d) / 2 : Math.min(w, d) * 0.42;
        rrect(g, x, y, w, d, r);
        g.fillStyle = MAP.water;
        g.fill();
        g.lineWidth = 0.7 * S;
        g.strokeStyle = MAP.waterEdge;
        g.stroke();
        rrect(g, x + 1.2 * S, y + 1.2 * S, w - 2.4 * S, d - 2.4 * S, Math.max(0, r - 1.2 * S));
        g.lineWidth = 0.35 * S;
        g.strokeStyle = MAP.waterShine;
        g.stroke();
        break;
      }
      case "plaza":
        rrect(g, x, y, w, d, f.shape === "circle" ? Math.min(w, d) / 2 : 1.5 * S);
        g.fillStyle = MAP.plaza;
        g.fill();
        g.lineWidth = 0.4 * S;
        g.strokeStyle = MAP.plazaEdge;
        g.stroke();
        break;
      case "sidewalk":
        g.fillStyle = MAP.sidewalk;
        g.fillRect(x, y, w, d);
        break;
      case "road": {
        g.fillStyle = MAP.road;
        g.fillRect(x, y, w, d);
        const long = Math.max(w, d);
        if (long >= 14 * S && Math.min(w, d) >= 5 * S) {
          g.setLineDash([2 * S, 2.2 * S]);
          g.lineWidth = 0.45 * S;
          g.strokeStyle = MAP.roadLine;
          g.beginPath();
          if (w >= d) {
            g.moveTo(x + 1.5 * S, 0);
            g.lineTo(-x - 1.5 * S, 0);
          } else {
            g.moveTo(0, y + 1.5 * S);
            g.lineTo(0, -y - 1.5 * S);
          }
          g.stroke();
          g.setLineDash([]);
        }
        break;
      }
      case "tree": {
        const r = Math.max(0.9 * S, (w + d) / 4);
        g.beginPath();
        g.arc(0, 0, r, 0, TAU);
        g.fillStyle = MAP.tree;
        g.fill();
        g.lineWidth = 0.35 * S;
        g.strokeStyle = MAP.treeEdge;
        g.stroke();
        break;
      }
      case "building": {
        const color = /^#[0-9a-f]{6}$/i.test(f.color || "") ? f.color : "#ffd1dc";
        rrect(g, x + 0.7 * S, y + 0.9 * S, w, d, 0.8 * S); // soft drop shadow
        g.fillStyle = "rgba(29, 43, 58, 0.22)";
        g.fill();
        rrect(g, x, y, w, d, 0.8 * S);
        g.fillStyle = color;
        g.fill();
        g.lineWidth = 0.7 * S;
        g.strokeStyle = shade(color, -0.42);
        g.stroke();
        break;
      }
      default:
        break;
    }
  }

  function buildLandmarks() {
    const list = town && Array.isArray(town.landmarks) ? town.landmarks : [];
    landmarks = list
      .filter((lm) => lm && Number.isFinite(lm.x) && Number.isFinite(lm.z))
      .map((lm) => {
        const glyph = glyphFor(lm);
        return { x: lm.x, z: lm.z, glyph, sprite: makeSprite(glyph) };
      });
  }

  /** Match the canvas backing store to its CSS size × DPR. */
  function resize(cssSize) {
    const css = Math.round(cssSize || canvas.clientWidth || 0) || 164;
    const d = Math.min(3, (typeof window !== "undefined" && window.devicePixelRatio) || 1);
    if (css === size && d === dpr) return;
    size = css;
    dpr = d;
    canvas.width = Math.round(css * d);
    canvas.height = Math.round(css * d);
    R = css / 2;
    ring = css < 140 ? 11 : 14;
    inner = R - ring;
    k = inner / MAP_VIEW_RADIUS;
    spriteSize = css < 140 ? 14 : 17;
    compassFont = `700 ${ring < 13 ? 9.5 : 11.5}px Fredoka, system-ui, sans-serif`;
    if (ctx) {
      cone = ctx.createRadialGradient(R, R, 0, R, R, inner);
      cone.addColorStop(0, "rgba(255, 255, 255, 0.5)");
      cone.addColorStop(1, "rgba(255, 255, 255, 0)");
    }
    if (town) {
      if (!base || base.S !== wantedScale()) buildBase();
      buildLandmarks();
    }
    // Resizing clears the canvas: repaint right away instead of flashing blank.
    if (lastState) draw(lastState, lastTime);
  }

  function setMap(t) {
    town = t || null;
    if (!size) resize();
    buildBase();
    buildLandmarks();
  }

  /** Rotate a world offset into minimap space (camera forward = up). */
  function project(out, wx, wz, s) {
    const dx = (wx - s.px) * k;
    const dy = (s.pz - wz) * k;
    out.x = R + dx * s.c - dy * s.s;
    out.y = R + dx * s.s + dy * s.c;
    const ox = out.x - R;
    const oy = out.y - R;
    return ox * ox + oy * oy;
  }
  const tmp = { x: 0, y: 0 };
  const view = { px: 0, pz: 0, c: 1, s: 0 };
  const placed = new Float32Array(128); // x,y of landmark icons drawn this frame (declutter)

  let lastState = null;
  let lastTime = 0;

  function draw(state, time) {
    if (!ctx || !size || !state) return;
    lastState = state;
    lastTime = time;
    const pos = state.playerPos;
    const yaw = Number.isFinite(state.cameraYaw) ? state.cameraYaw : 0;
    view.px = pos && Number.isFinite(pos.x) ? pos.x : 0;
    view.pz = pos && Number.isFinite(pos.z) ? pos.z : 0;
    view.c = Math.cos(-yaw);
    view.s = Math.sin(-yaw);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = CREAM;
    ctx.fillRect(0, 0, size, size);

    // --- map disc ---
    ctx.save();
    ctx.beginPath();
    ctx.arc(R, R, inner, 0, TAU);
    ctx.clip();
    if (base) {
      ctx.translate(R, R);
      ctx.rotate(-yaw);
      const sc = k / base.S;
      ctx.scale(sc, sc);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(base.canvas, -(view.px - base.minX) * base.S, -(base.maxZ - view.pz) * base.S);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    } else {
      ctx.fillStyle = MAP.ground;
      ctx.fillRect(0, 0, size, size);
    }

    // camera view cone (camera forward is always "up")
    if (cone) {
      ctx.fillStyle = cone;
      ctx.beginPath();
      ctx.moveTo(R, R);
      ctx.arc(R, R, inner, -Math.PI / 2 - 0.62, -Math.PI / 2 + 0.62);
      ctx.closePath();
      ctx.fill();
    }

    const lim = (inner - 3) * (inner - 3);
    // landmarks (upright icons); skip any that would overlap one already drawn
    const half = spriteSize / 2;
    const minGap2 = spriteSize * spriteSize * 0.81;
    let nPlaced = 0;
    for (let i = 0; i < landmarks.length && nPlaced < 64; i++) {
      const lm = landmarks[i];
      if (!lm.sprite || project(tmp, lm.x, lm.z, view) > lim) continue;
      let clash = false;
      for (let j = 0; j < nPlaced * 2; j += 2) {
        const dx = placed[j] - tmp.x;
        const dy = placed[j + 1] - tmp.y;
        if (dx * dx + dy * dy < minGap2) {
          clash = true;
          break;
        }
      }
      if (clash) continue;
      placed[nPlaced * 2] = tmp.x;
      placed[nPlaced * 2 + 1] = tmp.y;
      nPlaced++;
      ctx.drawImage(lm.sprite, tmp.x - half, tmp.y - half, spriteSize, spriteSize);
    }

    ctx.lineWidth = 1.5;
    ctx.strokeStyle = NAVY;
    // NPCs
    const npcs = state.npcPositions;
    if (npcs && npcs.length) {
      ctx.fillStyle = "#ffffff";
      for (let i = 0; i < npcs.length; i++) {
        const n = npcs[i];
        if (!n || project(tmp, n.x, n.z, view) > lim) continue;
        ctx.beginPath();
        ctx.arc(tmp.x, tmp.y, 3.2, 0, TAU);
        ctx.fill();
        ctx.stroke();
      }
    }
    // coins (gently pulsing)
    const coins = state.coinPositions;
    if (coins && coins.length) {
      for (let i = 0; i < coins.length; i++) {
        const c = coins[i];
        if (!c || project(tmp, c.x, c.z, view) > lim) continue;
        const r = 3.3 + 0.75 * Math.sin(time * 4.2 + i * 1.7);
        ctx.beginPath();
        ctx.arc(tmp.x, tmp.y, r, 0, TAU);
        ctx.fillStyle = "#ffcc33";
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(tmp.x - r * 0.3, tmp.y - r * 0.3, r * 0.32, 0, TAU);
        ctx.fillStyle = "#fff6d0";
        ctx.fill();
      }
    }

    // player arrow (heading relative to the camera)
    const heading = Number.isFinite(state.heading) ? state.heading : 0;
    ctx.translate(R, R);
    ctx.rotate(heading - yaw);
    ctx.beginPath();
    ctx.moveTo(0, -9.5);
    ctx.lineTo(7, 7.5);
    ctx.lineTo(0, 3.6);
    ctx.lineTo(-7, 7.5);
    ctx.closePath();
    ctx.lineJoin = "round";
    ctx.lineWidth = 6;
    ctx.strokeStyle = "#ffffff";
    ctx.stroke();
    ctx.lineWidth = 3;
    ctx.strokeStyle = NAVY;
    ctx.stroke();
    ctx.fillStyle = "#fb8500";
    ctx.fill();
    ctx.restore(); // drops clip + transform

    // --- rim + compass band ---
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.beginPath();
    ctx.arc(R, R, inner, 0, TAU);
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = NAVY;
    ctx.stroke();

    const rr = inner + ring / 2;
    const c = view.c;
    const s = view.s;
    // tick marks every 30° (letters sit on the 90° ones)
    ctx.strokeStyle = "rgba(29, 43, 58, 0.28)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < 12; i++) {
      if (i % 3 === 0) continue;
      const a = (i / 12) * TAU; // bearing clockwise from north
      const bx = Math.sin(a);
      const by = -Math.cos(a);
      const ux = bx * c - by * s;
      const uy = bx * s + by * c;
      ctx.moveTo(R + ux * (rr - 2.5), R + uy * (rr - 2.5));
      ctx.lineTo(R + ux * (rr + 2.5), R + uy * (rr + 2.5));
    }
    ctx.stroke();

    ctx.font = compassFont;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    // north = (0,-1), east = (1,0), south = (0,1), west = (-1,0), rotated by -yaw
    ctx.fillStyle = "#e85d04";
    ctx.fillText("N", R + s * rr, R - c * rr + 0.5);
    ctx.fillStyle = NAVY;
    ctx.fillText("E", R + c * rr, R + s * rr + 0.5);
    ctx.fillText("S", R - s * rr, R + c * rr + 0.5);
    ctx.fillText("W", R - c * rr, R - s * rr + 0.5);
  }

  return { resize, setMap, draw };
}

// ---------------------------------------------------------------------------
// createHUD
// ---------------------------------------------------------------------------

/**
 * Build the whole DOM UI.
 * @param {{ root?: HTMLElement, events: { on: Function, emit: Function }, quality?: "low"|"medium"|"high" }} opts
 */
export function createHUD({ root, events, quality = "high" } = {}) {
  const host = root || document.body;
  const coarse = typeof matchMedia === "function" && !!matchMedia("(pointer: coarse)").matches;

  const settings = {
    muted: false,
    music: true,
    quality: QUALITY_LEVELS.includes(quality) ? quality : "high",
    daynight: "cycle",
  };
  let phase = "loading"; // loading → title → game
  let paused = false;
  let selected = 0;
  let isTouch = coarse;
  let fpsVisible = false;
  let helpOpen = false;
  let resolveTitle = null;
  const timers = {};
  const later = (name, ms, fn) => {
    clearTimeout(timers[name]);
    timers[name] = setTimeout(fn, ms);
  };

  // ---- DOM ---------------------------------------------------------------
  const hud = el("div", "tt-hud");
  hud.classList.toggle("is-touch", isTouch);
  hud.classList.toggle("tt-low", settings.quality === "low");

  // Loading + title share one layer so the logo never jumps between them.
  const front = el(
    "div",
    "tt-front",
    `<div class="tt-sky"><div class="tt-sun"></div>
      ${CLOUDS.map((c) => `<div class="tt-cloud" style="--y:${c.y};--s:${c.s};--d:${c.d}s;--o:${c.o}s;--a:${c.a ?? 0.96}">${CLOUD_SVG}</div>`).join("")}
      <div class="tt-hills">${HILLS_SVG}</div></div>
    <div class="tt-veil"></div>
    <div class="tt-front-main">
      <h1 class="tt-logo" aria-label="Toon Town">${logoHTML(["TOON", "TOWN"], LOGO_COLORS, LOGO_TILT)}</h1>
      <div class="tt-tagline">A tiny cozy adventure</div>
      <div class="tt-stage">
        <div class="tt-load" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
          <div class="tt-bar"><div class="tt-bar-fill"></div></div>
          <div class="tt-load-msg"><span class="tt-load-text">Loading…</span><span class="tt-load-pct">0%</span></div>
        </div>
        <div class="tt-start">
          <button type="button" class="tt-play" data-action="play" aria-label="Play">${ICONS.play}<span>PLAY</span></button>
          <div class="tt-press">Click, tap or press any key</div>
        </div>
      </div>
    </div>
    <div class="tt-front-foot">
      <div class="tt-tip">${ICONS.bulb}<span class="tt-tip-text"></span></div>
      <div class="tt-controls-card">
        <div class="tt-ctl-grid tt-only-keys">${CONTROLS_KEYS.map(ctlHTML).join("")}</div>
        <div class="tt-ctl-grid tt-only-touch">${CONTROLS_TOUCH.map(ctlHTML).join("")}</div>
      </div>
    </div>
    <div class="tt-credit">Made with <b>Babylon.js</b></div>`,
  );
  front.dataset.phase = "loading";

  const game = el(
    "div",
    "tt-game",
    `<div class="tt-tl">
      <div class="tt-player">
        <div class="tt-portrait">${PIP_PORTRAIT}</div>
        <div class="tt-player-info">
          <div class="tt-player-name">Pip <span class="tt-lv">Lv 1</span></div>
          <div class="tt-hearts" aria-label="5 of 5 hearts">${`<span class="tt-heart">${ICONS.heart}</span>`.repeat(5)}</div>
          <div class="tt-energy"><span class="tt-energy-icon">${ICONS.bolt}</span>
            <div class="tt-energy-bar"><div class="tt-energy-fill"><div class="tt-energy-low"></div></div></div></div>
        </div>
      </div>
      <div class="tt-fps" hidden>60 FPS</div>
    </div>
    <div class="tt-tc">
      <div class="tt-coins" aria-label="Coins"><span class="tt-coin-icon">${ICONS.coin}</span><span class="tt-coin-count">0</span><span class="tt-coin-total">/ 0</span><span class="tt-coin-plus">+1</span></div>
    </div>
    <div class="tt-zone" aria-live="polite"><span class="tt-zone-kicker">Now entering</span>
      <span class="tt-zone-name"><span class="tt-tilde">~</span><span class="tt-zone-text"></span><span class="tt-tilde">~</span></span><span class="tt-zone-rule"></span></div>
    <div class="tt-toasts" aria-live="polite"></div>
    <div class="tt-tr">
      <div class="tt-minimap"><canvas class="tt-minimap-canvas" aria-label="Minimap"></canvas></div>
      <div class="tt-tr-info">
        <div class="tt-clock"><span class="tt-clock-icon"><span class="is-sun">${ICONS.sun}</span><span class="is-moon">${ICONS.moon}</span></span><span class="tt-clock-text">4:00 PM</span></div>
        <div class="tt-buttons">
          <button type="button" class="tt-round" data-action="mute" title="Sound (M)" aria-label="Toggle sound">${ICONS.soundOn}</button>
          <button type="button" class="tt-round" data-action="music" title="Music" aria-label="Toggle music">${ICONS.musicOn}</button>
          <button type="button" class="tt-round tt-daynight" data-action="cycle-daynight" title="Time of day (N)" aria-label="Change time of day">${ICONS.cycle}</button>
          <button type="button" class="tt-round" data-action="menu" title="Menu (Esc)" aria-label="Open menu">${ICONS.menu}</button>
        </div>
      </div>
    </div>
    <div class="tt-bottom">
      <div class="tt-item-label" aria-live="polite"><span class="tt-item-name"></span><span class="tt-rarity-pill"></span><span class="tt-use-hint">${kbd("F", "tt-key--sm")}Use</span></div>
      <div class="tt-hotbar" role="toolbar" aria-label="Items"></div>
    </div>
    <div class="tt-help">
      <div class="tt-help-card">
        <div class="tt-help-head"><span class="tt-help-title">Controls</span>
          <button type="button" class="tt-help-close" data-action="help" aria-label="Hide controls">${ICONS.close}</button></div>
        ${HELP_ROWS.map(rowHTML).join("")}
      </div>
      <button type="button" class="tt-help-chip" data-action="help">${kbd("H", "tt-key--sm")}Help</button>
    </div>`,
  );

  const seg = (action, options) =>
    `<div class="tt-seg" role="radiogroup">${options
      .map(([v, label]) => `<button type="button" data-action="${action}" data-value="${v}" role="radio">${label}</button>`)
      .join("")}</div>`;
  const toggle = (action, label) =>
    `<button type="button" class="tt-switch" data-action="${action}" role="switch" aria-label="${label}"><span class="tt-switch-on"></span><span class="tt-switch-knob"></span></button>`;

  const pauseEl = el(
    "div",
    "tt-pause",
    `<div class="tt-pause-card" role="dialog" aria-modal="true" aria-label="Paused">
      <div class="tt-pause-head"><span class="tt-pause-badge">${ICONS.pause}</span><h2>Paused</h2>
        <p>Take a breather. Toon Town will wait for you!</p></div>
      <div class="tt-pause-resume"><button type="button" class="tt-btn tt-btn-primary" data-action="resume">${ICONS.play}<span>Resume</span></button></div>
      <div class="tt-pause-body">
        <section class="tt-settings">
          <h3>Settings</h3>
          <div class="tt-row"><span class="tt-row-label">${ICONS.gear}Graphics</span>${seg("quality", [["low", "Low"], ["medium", "Medium"], ["high", "High"]])}</div>
          <div class="tt-row"><span class="tt-row-label">${ICONS.soundOn}Sound</span>${toggle("mute", "Sound")}</div>
          <div class="tt-row"><span class="tt-row-label">${ICONS.musicOn}Music</span>${toggle("music", "Music")}</div>
          <div class="tt-row"><span class="tt-row-label">${ICONS.sunset}Time of day</span>${seg("mode", DAYNIGHT_MODES.map((m) => [m, DAYNIGHT[m].label]))}</div>
        </section>
        <div class="tt-progress">
          <span class="tt-progress-coin">${ICONS.coin}</span>
          <div class="tt-progress-info">
            <div class="tt-progress-top"><span>Coins found</span><span class="tt-progress-count">0 / 0</span></div>
            <div class="tt-progress-bar"><div class="tt-progress-fill"></div></div>
          </div>
        </div>
        <section class="tt-ref">
          <h3>Controls</h3>
          <div class="tt-only-keys">${[...HELP_ROWS, ...REF_EXTRA_ROWS].map(rowHTML).join("")}</div>
          <div class="tt-only-touch">${TOUCH_ROWS.map(rowHTML).join("")}</div>
        </section>
      </div>
      <div class="tt-pause-foot tt-only-keys">Press ${kbd("Esc", "tt-key--sm")} or ${kbd("P", "tt-key--sm")} to resume</div>
    </div>`,
  );
  pauseEl.setAttribute("aria-hidden", "true");

  const confettiRng = makeRng(77);
  const confetti = Array.from({ length: 44 }, (_, i) => {
    const r = confettiRng;
    const color = LOGO_COLORS[i % LOGO_COLORS.length];
    return `<i style="--x:${(r() * 100).toFixed(1)}%;--c:${color};--d:${(2.6 + r() * 1.8).toFixed(2)}s;--w:${(r() * 1.4).toFixed(2)}s;--sx:${((r() - 0.5) * 30).toFixed(1)}vw;--rot:${Math.round(360 + r() * 720)}deg"></i>`;
  }).join("");
  const celebrateEl = el(
    "div",
    "tt-celebrate",
    `<div class="tt-burst"></div><div class="tt-confetti">${confetti}</div>
    <div class="tt-celebrate-card">
      <div class="tt-trophy">${ICONS.trophy}</div>
      <div class="tt-logo" role="img" aria-label="All coins found!">${logoHTML(["ALL", "COINS", "FOUND!"], GOLD_COLORS, LOGO_TILT)}</div>
      <div class="tt-celebrate-sub">You found every coin in Toon Town!</div>
    </div>`,
  );

  hud.append(game, celebrateEl, pauseEl, front);
  host.appendChild(hud);

  // Hide the logo until the bundled Fredoka font is ready (no font-swap flash).
  if (typeof document !== "undefined" && document.fonts && typeof document.fonts.load === "function") {
    hud.classList.add("tt-fonts-wait");
    const ready = () => {
      hud.classList.remove("tt-fonts-wait");
      queueFit(); // Fredoka metrics differ from the fallback font
    };
    Promise.race([
      Promise.all(["700 64px Fredoka", "600 18px Fredoka"].map((f) => document.fonts.load(f))),
      new Promise((r) => setTimeout(r, 1200)),
    ]).then(ready, ready);
  }

  // ---- element references ---------------------------------------------
  const $ = (scope, sel) => scope.querySelector(sel);
  const barFill = $(front, ".tt-bar-fill");
  const loadBox = $(front, ".tt-load");
  const loadText = $(front, ".tt-load-text");
  const loadPct = $(front, ".tt-load-pct");
  const tipText = $(front, ".tt-tip-text");
  const pressHint = $(front, ".tt-press");
  const controlsCard = $(front, ".tt-controls-card");
  const credit = $(front, ".tt-credit");
  const coinsPill = $(game, ".tt-coins");
  const coinCount = $(game, ".tt-coin-count");
  const coinTotal = $(game, ".tt-coin-total");
  const coinPlus = $(game, ".tt-coin-plus");
  const zoneEl = $(game, ".tt-zone");
  const zoneText = $(game, ".tt-zone-text");
  const zoneRule = $(game, ".tt-zone-rule");
  const toastStack = $(game, ".tt-toasts");
  const mapCanvas = $(game, ".tt-minimap-canvas");
  const clockEl = $(game, ".tt-clock");
  const clockText = $(game, ".tt-clock-text");
  const dayNightBtn = $(game, ".tt-daynight");
  const hotbar = $(game, ".tt-hotbar");
  const bottomBar = $(game, ".tt-bottom");
  const itemLabel = $(game, ".tt-item-label");
  const itemName = $(game, ".tt-item-name");
  const rarityPill = $(game, ".tt-rarity-pill");
  const helpEl = $(game, ".tt-help");
  const fpsEl = $(game, ".tt-fps");
  const energyBox = $(game, ".tt-energy");
  const energyFill = $(game, ".tt-energy-fill");
  const celebrateCard = $(celebrateEl, ".tt-celebrate-card");
  const progressCount = $(pauseEl, ".tt-progress-count");
  const progressFill = $(pauseEl, ".tt-progress-fill");

  const minimap = createMinimap(mapCanvas);

  // ---- hotbar slots ----------------------------------------------------
  const slots = HOTBAR_ITEMS.map((item, i) => {
    const b = el(
      "button",
      "tt-slot",
      `<span class="tt-slot-fill"></span><span class="tt-slot-shine"></span>` +
        `<span class="tt-slot-icon">${ITEM_ICONS[item.id] || ""}</span><span class="tt-slot-flash"></span>` +
        `<span class="tt-slot-num">${i + 1}</span>${item.qty > 1 ? `<span class="tt-slot-qty">×${item.qty}</span>` : ""}`,
    );
    b.type = "button";
    b.dataset.action = "slot";
    b.dataset.value = String(i);
    b.dataset.rarity = item.rarity;
    b.setAttribute("aria-label", `${i + 1}: ${item.name} (${RARITY[item.rarity].label})`);
    hotbar.appendChild(b);
    return { el: b, icon: $(b, ".tt-slot-icon"), flash: $(b, ".tt-slot-flash") };
  });
  slots[selected].el.classList.add("is-selected");

  // ---- loading screen ---------------------------------------------------
  let tipIndex = 0;
  const tips = () => (isTouch ? TIPS_TOUCH : TIPS_KEYS);
  tipText.innerHTML = tips()[0];
  let tipTimer = setInterval(() => {
    tipText.classList.add("is-swap");
    later("tip", 320, () => {
      tipIndex = (tipIndex + 1) % tips().length;
      tipText.innerHTML = tips()[tipIndex];
      tipText.classList.remove("is-swap");
    });
  }, 3800);
  const stopTips = () => {
    clearInterval(tipTimer);
    tipTimer = null;
  };

  function setLoading(progress, message) {
    const p = clamp01(Number(progress) || 0);
    barFill.style.transform = `translateX(${((p - 1) * 100).toFixed(2)}%)`;
    const pct = Math.round(p * 100);
    loadPct.textContent = `${pct}%`;
    loadBox.setAttribute("aria-valuenow", String(pct));
    if (message != null) loadText.textContent = String(message);
  }

  // ---- title / game phases ---------------------------------------------
  function enterGame() {
    phase = "game";
    hud.dataset.phase = "game";
    stopTips();
    syncTouch();
    game.classList.add("is-on");
    minimap.resize(mapCanvas.clientWidth);
    // Help card: open on roomy keyboard screens, then tuck away into a chip.
    const roomy = typeof innerWidth === "number" ? innerWidth >= 1100 : true;
    setHelp(!isTouch && roomy);
    if (helpOpen) later("help", 12000, () => setHelp(false));
    // After the 3 s "Now entering" banner, so the two don't stack up on arrival.
    later("welcome", 3200, () => {
      if (last.total > 0 && last.coins < last.total) toast(`Find all ${last.total} coins hidden around town!`, "coin");
    });
  }

  function dismissTitle() {
    if (phase !== "title") return;
    front.dataset.phase = "out";
    enterGame();
    later("front", 900, () => {
      front.hidden = true;
    });
    const resolve = resolveTitle;
    resolveTitle = null;
    if (resolve) resolve();
  }

  function showStartScreen(opts = {}) {
    if (phase === "game") return Promise.resolve();
    if (opts && opts.auto) {
      front.dataset.phase = "out";
      front.hidden = true;
      game.classList.add("no-intro"); // debug/screenshot start: no slide-in
      enterGame();
      return Promise.resolve();
    }
    syncTouch();
    stopTips();
    phase = "title";
    hud.dataset.phase = "title";
    front.dataset.phase = "title";
    queueFit();
    return new Promise((resolve) => {
      resolveTitle = resolve;
    });
  }

  // ---- touch detection ---------------------------------------------------
  const pressText = () => (isTouch ? "Tap anywhere to play" : "Click, tap or press any key");
  pressHint.textContent = pressText();
  function syncTouch() {
    const body = typeof document !== "undefined" ? document.body : null;
    const t = !!(body && body.classList && body.classList.contains("touch-ui")) || coarse;
    if (t === isTouch) return;
    isTouch = t;
    hud.classList.toggle("is-touch", t);
    pressHint.textContent = pressText();
    if (t && helpOpen) setHelp(false);
    queueFit(); // the touch controls card has a different size
  }

  // ---- front-screen fit ----------------------------------------------------
  // The loading/title screen stacks logo → PLAY → controls card in a flex
  // column (see .tt-front in hud.css), so nothing can overlap. When a window
  // is too short or narrow for all of it, first drop the "press any key" hint
  // (is-snug), then the controls card (is-cramped; the same list is in the
  // pause menu) rather than letting anything run off-screen.
  let fitQueued = false;
  function fitFront() {
    fitQueued = false;
    if (front.hidden || typeof innerHeight !== "number") return;
    try {
      const fits = () => {
        const card = controlsCard.getBoundingClientRect();
        if (!(card.width > 0)) return true; // not laid out (hidden / headless shim)
        const pad = parseFloat(getComputedStyle(front).paddingBottom) || 0;
        let bottom = card.bottom;
        if (getComputedStyle(credit).position === "static") bottom = Math.max(bottom, credit.getBoundingClientRect().bottom);
        return bottom <= innerHeight - pad + 1 && card.left >= -1 && card.right <= innerWidth + 1;
      };
      front.classList.remove("is-snug", "is-cramped");
      if (fits()) return;
      front.classList.add("is-snug");
      if (fits()) return;
      front.classList.add("is-cramped");
    } catch {
      /* layout APIs unavailable: keep the default layout */
    }
  }
  function queueFit() {
    if (fitQueued || front.hidden) return;
    fitQueued = true;
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(fitFront);
    else fitFront();
  }

  // ---- toasts ------------------------------------------------------------
  const toastList = []; // { el, out, gap }
  const MAX_TOASTS = 4;

  function layoutToasts(entering) {
    let y = 0;
    for (const t of toastList) {
      if (t.out) continue;
      const h = t.el.offsetHeight || 56;
      const to = `translate(-50%, ${y}px)`;
      t.el.style.transform = to;
      if (t === entering) {
        play(t.el, [
          { opacity: 0, transform: `translate(-50%, ${y - 18}px) scale(0.86)` },
          { opacity: 1, transform: to },
        ], { duration: 420, easing: "cubic-bezier(0.2, 1.4, 0.4, 1)" });
      }
      y += h + t.gap;
    }
  }

  function dismissToast(t) {
    if (t.out) return;
    t.out = true;
    clearTimeout(t.timer);
    t.el.classList.add("is-out");
    t.el.style.transform = `${t.el.style.transform} translateY(-10px) scale(0.94)`;
    layoutToasts(null);
    setTimeout(() => {
      t.el.remove();
      const i = toastList.indexOf(t);
      if (i >= 0) toastList.splice(i, 1);
    }, 360);
  }

  /** Vertical px the toast stack may use before it would reach the hotbar. */
  function toastRoom() {
    try {
      // hotbar hidden (tiny phones) or no room left: just the newest toast
      return Math.max(0, bottomBar.getBoundingClientRect().top - toastStack.getBoundingClientRect().top - 8);
    } catch {
      return Infinity;
    }
  }

  function pushToast(node, ttl, gap = 10) {
    toastStack.appendChild(node);
    const t = { el: node, out: false, gap, timer: 0 };
    toastList.push(t);
    // Drop the oldest toasts beyond MAX_TOASTS, or once the stack would run
    // into the hotbar (short screens: phones in landscape, small portrait).
    const room = toastRoom();
    let live = 0;
    let height = 0;
    for (const x of toastList) {
      if (x.out) continue;
      live++;
      height += (x.el.offsetHeight || 56) + x.gap;
    }
    for (const x of toastList) {
      if (x === t || (live <= MAX_TOASTS && height <= room)) break;
      if (!x.out) {
        height -= (x.el.offsetHeight || 56) + x.gap;
        dismissToast(x);
        live--;
      }
    }
    layoutToasts(t);
    t.timer = setTimeout(() => dismissToast(t), ttl);
  }

  /** Resolve a toast icon: item id, UI icon name, raw SVG, or a short text/emoji. */
  function iconHTML(icon) {
    if (!icon) return ICONS.info;
    if (ITEM_ICONS[icon]) return ITEM_ICONS[icon];
    if (ICONS[icon]) return ICONS[icon];
    const s = String(icon);
    if (s.trim().startsWith("<svg")) return s;
    return `<span class="tt-emoji">${escapeHTML([...s].slice(0, 2).join(""))}</span>`;
  }

  function toast(text, icon) {
    const node = el("div", "tt-toast");
    const ic = el("span", "tt-toast-icon", iconHTML(icon));
    const body = el("span", "tt-toast-body");
    const tx = el("span", "tt-toast-text");
    tx.textContent = String(text ?? "");
    body.appendChild(tx);
    node.append(ic, body);
    pushToast(node, 3200);
  }

  function speech(name, text) {
    const who = String(name || "Neighbour");
    let hash = 0;
    for (let i = 0; i < who.length; i++) hash = (hash * 31 + who.charCodeAt(i)) | 0;
    const node = el("div", "tt-toast tt-toast--speech");
    const av = el("span", "tt-avatar");
    av.textContent = who.trim().charAt(0).toUpperCase() || "?";
    av.style.setProperty("--c", AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]);
    const body = el("span", "tt-toast-body");
    const nm = el("span", "tt-toast-name");
    nm.textContent = who;
    const tx = el("span", "tt-toast-text");
    tx.textContent = String(text ?? "");
    body.append(nm, tx);
    node.append(av, body);
    pushToast(node, 4300, 18);
  }

  // ---- zone banner -------------------------------------------------------
  let zoneAnim = null;
  function showZone(name) {
    if (!name) return;
    zoneText.textContent = String(name);
    if (zoneAnim) zoneAnim.cancel();
    zoneAnim = play(zoneEl, [
      { opacity: 0, transform: "translateY(-16px)" },
      { opacity: 1, transform: "translateY(0)", offset: 0.14 },
      { opacity: 1, transform: "translateY(0)", offset: 0.82 },
      { opacity: 0, transform: "translateY(-8px)" },
    ], { duration: 3000, easing: "ease-out" });
    play(zoneRule, [
      { transform: "scaleX(0)" },
      { transform: "scaleX(1)", offset: 0.3 },
      { transform: "scaleX(1)" },
    ], { duration: 3000, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" });
  }

  // ---- hotbar --------------------------------------------------------------
  function showItemLabel(item) {
    itemName.textContent = item.name;
    rarityPill.textContent = RARITY[item.rarity].label;
    rarityPill.style.setProperty("--rar", RARITY[item.rarity].color);
    itemLabel.classList.add("is-on");
    later("label", 2000, () => itemLabel.classList.remove("is-on"));
  }

  function selectSlot(index) {
    const i = ((index % 8) + 8) % 8;
    const changed = i !== selected;
    slots[selected].el.classList.remove("is-selected");
    selected = i;
    const slot = slots[i];
    slot.el.classList.add("is-selected");
    play(slot.icon, [
      { transform: "translateY(0) scale(1)" },
      { transform: "translateY(-7px) scale(1.14)", offset: 0.35 },
      { transform: "translateY(1px) scale(0.95)", offset: 0.7 },
      { transform: "translateY(0) scale(1)" },
    ], { duration: 420, easing: "ease-out" });
    showItemLabel(HOTBAR_ITEMS[i]);
    if (changed) events.emit("hud:slotSelected", { index: i, item: HOTBAR_ITEMS[i] });
  }

  function useItem() {
    const item = HOTBAR_ITEMS[selected];
    const slot = slots[selected];
    play(slot.icon, [
      { transform: "scale(1) rotate(0deg)" },
      { transform: "scale(0.72) rotate(-12deg)", offset: 0.25 },
      { transform: "scale(1.24) rotate(8deg)", offset: 0.6 },
      { transform: "scale(1) rotate(0deg)" },
    ], { duration: 480, easing: "ease-out" });
    play(slot.flash, [
      { opacity: 0.95, transform: "scale(0.85)" },
      { opacity: 0, transform: "scale(1.3)" },
    ], { duration: 450, easing: "ease-out" });
    toast(`${item.name} — coming soon!`, item.id);
    events.emit("hud:useItem", { index: selected, item });
  }

  // ---- settings ------------------------------------------------------------
  const each = (sel, fn) => {
    const list = hud.querySelectorAll(sel);
    for (let i = 0; i < list.length; i++) fn(list[i]);
  };
  function markGroup(action, value) {
    each(`[data-action="${action}"]`, (b) => {
      const on = b.dataset.value === value;
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-checked", String(on));
    });
  }
  function setSwitches(action, on, offIcon, onIcon) {
    each(`[data-action="${action}"]`, (b) => {
      if (b.classList.contains("tt-switch")) {
        b.classList.toggle("is-on", on);
        b.setAttribute("aria-checked", String(on));
      } else {
        b.innerHTML = on ? onIcon : offIcon;
        b.classList.toggle("is-off", !on);
      }
    });
  }

  function setMuted(muted, { emit = true, announce = false } = {}) {
    settings.muted = !!muted;
    setSwitches("mute", !settings.muted, ICONS.soundOff, ICONS.soundOn);
    if (emit) events.emit("settings:mute", { muted: settings.muted });
    if (announce) toast(settings.muted ? "Sound off" : "Sound on", settings.muted ? "soundOff" : "soundOn");
  }
  function setMusic(on, { emit = true, announce = false } = {}) {
    settings.music = !!on;
    setSwitches("music", settings.music, ICONS.musicOff, ICONS.musicOn);
    if (emit) events.emit("settings:music", { on: settings.music });
    if (announce) toast(settings.music ? "Music on" : "Music off", settings.music ? "musicOn" : "musicOff");
  }
  function setQuality(level, { emit = true } = {}) {
    if (!QUALITY_LEVELS.includes(level)) return;
    const changed = level !== settings.quality;
    settings.quality = level;
    markGroup("quality", level);
    hud.classList.toggle("tt-low", level === "low");
    if (emit && changed) events.emit("settings:quality", { level });
  }
  function setDaynight(mode, { emit = true, announce = false } = {}) {
    if (!DAYNIGHT[mode]) return;
    settings.daynight = mode;
    markGroup("mode", mode);
    const info = DAYNIGHT[mode];
    dayNightBtn.innerHTML = ICONS[info.icon];
    dayNightBtn.title = `Time of day: ${info.label} (N)`;
    if (emit) events.emit("settings:daynight", { mode });
    if (announce) toast(info.toast, info.icon);
  }
  const cycleDaynight = () =>
    setDaynight(DAYNIGHT_MODES[(DAYNIGHT_MODES.indexOf(settings.daynight) + 1) % DAYNIGHT_MODES.length], { announce: true });

  function setHelp(open) {
    helpOpen = !!open;
    helpEl.classList.toggle("is-open", helpOpen);
    game.classList.toggle("help-open", helpOpen); // narrow screens move toasts aside (hud.css)
    if (!helpOpen) clearTimeout(timers.help);
  }

  function setPaused(p) {
    p = !!p;
    if (phase !== "game" || p === paused) return;
    paused = p;
    hud.classList.toggle("is-paused", p);
    pauseEl.setAttribute("aria-hidden", String(!p));
    events.emit("game:pause", { paused: p });
  }

  function toggleFps() {
    fpsVisible = !fpsVisible;
    fpsEl.hidden = !fpsVisible;
    last.fps = -1;
  }

  // ---- celebration -------------------------------------------------------
  function celebrate() {
    if (zoneAnim) zoneAnim.cancel(); // keep the centre of the screen for the banner
    coinsPill.classList.add("is-complete");
    celebrateEl.classList.add("is-on");
    play(celebrateCard, [
      { opacity: 0, transform: "scale(0.3) rotate(-8deg)" },
      { opacity: 1, transform: "scale(1.12) rotate(2deg)", offset: 0.6 },
      { opacity: 1, transform: "scale(1) rotate(0deg)" },
    ], { duration: 750, easing: "cubic-bezier(0.2, 0.9, 0.3, 1)", fill: "forwards" });
    later("celebrate", 5600, () => {
      play(celebrateCard, [
        { opacity: 1, transform: "scale(1)" },
        { opacity: 0, transform: "translateY(-24px) scale(0.9)" },
      ], { duration: 500, easing: "ease-in", fill: "forwards" });
      later("celebrateOff", 520, () => celebrateEl.classList.remove("is-on"));
    });
  }

  // ---- input -------------------------------------------------------------
  function onKeyDown(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (phase === "title") {
      if (!MODIFIER_KEYS.has(e.key)) dismissTitle();
      return;
    }
    if (phase !== "game" || e.repeat) return;
    const code = e.code || "";
    if (code === "Escape" || code === "KeyP") return setPaused(!paused);
    if (code === "KeyM") return setMuted(!settings.muted, { announce: true });
    if (code === "Backquote" || e.key === "`") return toggleFps();
    if (paused) return;
    if (code in SLOT_CODES) return selectSlot(SLOT_CODES[code]);
    switch (code) {
      case "KeyQ": return selectSlot(selected - 1);
      case "KeyE": return selectSlot(selected + 1);
      case "KeyF": return useItem();
      case "KeyN": return cycleDaynight();
      case "KeyH": return isTouch ? undefined : setHelp(!helpOpen);
      case "KeyC": return events.emit("camera:reset");
      default: return undefined;
    }
  }

  function onClick(e) {
    if (phase === "title") return dismissTitle();
    const target = e.target && e.target.closest ? e.target.closest("[data-action]") : null;
    if (!target) {
      if (paused && e.target === pauseEl) setPaused(false); // click on the dimmed backdrop
      return undefined;
    }
    const { action, value } = target.dataset;
    switch (action) {
      case "slot": {
        const i = Number(value);
        return i === selected ? useItem() : selectSlot(i);
      }
      case "mute": return setMuted(!settings.muted);
      case "music": return setMusic(!settings.music);
      case "cycle-daynight": return cycleDaynight();
      case "mode": return setDaynight(value);
      case "quality": return setQuality(value);
      case "menu": return setPaused(true);
      case "resume": return setPaused(false);
      case "help": return setHelp(!helpOpen);
      default: return undefined;
    }
  }

  // Buttons must never keep keyboard focus, or Space (jump) would "click" them.
  hud.addEventListener("mousedown", (e) => {
    if (e.target && e.target.closest && e.target.closest("button")) e.preventDefault();
  });
  hud.addEventListener("click", onClick);
  window.addEventListener("keydown", onKeyDown);
  if (typeof document !== "undefined" && document.addEventListener) {
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) setPaused(true); // tabbing away pauses the game
    });
  }
  window.addEventListener("resize", () => {
    minimap.resize(mapCanvas.clientWidth);
    queueFit();
  });
  if (typeof ResizeObserver === "function") {
    new ResizeObserver((entries) => {
      const box = entries[0] && entries[0].contentRect;
      if (box && box.width > 0) minimap.resize(box.width);
    }).observe(mapCanvas);
  }

  events.on("npc:greet", (p) => {
    if (phase === "game" && !paused && p) speech(p.name, p.text);
  });
  events.on("coin:all", () => {
    if (phase === "game") celebrate();
  });
  events.on("hud:cycle", (p) => {
    if (phase === "game" && !paused) selectSlot(selected + ((p && p.dir) < 0 ? -1 : 1));
  });
  events.on("hud:use", () => {
    if (phase === "game" && !paused) useItem();
  });
  events.on("game:togglePause", () => (phase === "title" ? dismissTitle() : setPaused(!paused)));
  // Stay in sync if another system changes a setting.
  events.on("settings:mute", (p) => p && p.muted !== settings.muted && setMuted(p.muted, { emit: false }));
  events.on("settings:music", (p) => p && p.on !== settings.music && setMusic(p.on, { emit: false }));
  events.on("settings:quality", (p) => p && p.level !== settings.quality && setQuality(p.level, { emit: false }));
  events.on("settings:daynight", (p) => p && p.mode !== settings.daynight && setDaynight(p.mode, { emit: false }));

  // initial UI state
  queueFit();
  markGroup("quality", settings.quality);
  markGroup("mode", settings.daynight);
  setMuted(false, { emit: false });
  setMusic(true, { emit: false });

  // ---- per-frame update ----------------------------------------------------
  const last = { coins: -1, total: -1, clock: -1, night: null, fps: -1, energy: -1, low: false, drain: false };
  let energy = 1;
  let elapsed = 0;
  let mapClock = 0;
  let fpsClock = 0;
  let touchClock = 0;
  let warned = false;

  function update(dt, s) {
    if (!s) return;
    try {
      dt = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.25) : 0;
      elapsed += dt;

      // coins
      const coins = s.coins | 0;
      const total = s.coinsTotal | 0;
      if (coins !== last.coins || total !== last.total) {
        const gained = last.coins >= 0 && coins > last.coins;
        last.coins = coins;
        last.total = total;
        coinCount.textContent = String(coins);
        coinTotal.textContent = `/ ${total}`;
        progressCount.textContent = `${coins} / ${total}`;
        progressFill.style.transform = `translateX(${(total > 0 ? Math.min(1, coins / total) * 100 : 0) - 100}%)`;
        if (gained && phase === "game") {
          play(coinsPill, [
            { transform: "scale(1)" },
            { transform: "scale(1.2)", offset: 0.3 },
            { transform: "scale(0.95)", offset: 0.65 },
            { transform: "scale(1)" },
          ], { duration: 450, easing: "ease-out" });
          play(coinPlus, [
            { opacity: 0, transform: "translateY(8px) scale(0.7)" },
            { opacity: 1, transform: "translateY(-4px) scale(1.1)", offset: 0.25 },
            { opacity: 1, transform: "translateY(-10px) scale(1)", offset: 0.7 },
            { opacity: 0, transform: "translateY(-22px) scale(1)" },
          ], { duration: 950, easing: "ease-out" });
        }
      }

      // energy: drains while running on the ground (visual only)
      const running = s.speed > 5.5 && !!s.grounded;
      energy = clamp01(energy + (running ? -0.2 : 0.32) * dt);
      const eq = Math.round(energy * 200);
      if (eq !== last.energy) {
        last.energy = eq;
        energyFill.style.transform = `translateX(${eq / 2 - 100}%)`;
        const low = energy < 0.25;
        if (low !== last.low) energyBox.classList.toggle("is-low", (last.low = low));
      }
      if (running !== last.drain) energyBox.classList.toggle("is-draining", (last.drain = running));

      // clock (5-minute steps) + sun/moon
      if (Number.isFinite(s.timeOfDay)) {
        const mins = Math.floor(((((s.timeOfDay % 24) + 24) % 24) * 60) / 5) * 5;
        if (mins !== last.clock) {
          last.clock = mins;
          const h24 = Math.floor(mins / 60) % 24;
          const m = mins % 60;
          clockText.textContent = `${h24 % 12 || 12}:${m < 10 ? "0" : ""}${m} ${h24 < 12 ? "AM" : "PM"}`;
        }
      }
      const night = (s.nightFactor || 0) > 0.5;
      if (night !== last.night) clockEl.classList.toggle("is-night", (last.night = night));

      // FPS counter (4 Hz)
      if (fpsVisible) {
        fpsClock += dt;
        if (fpsClock >= 0.25 || last.fps < 0) {
          fpsClock = 0;
          const f = Math.round(s.fps || 0);
          if (f !== last.fps) {
            last.fps = f;
            fpsEl.textContent = `${f} FPS`;
            fpsEl.classList.toggle("is-warn", f < 50 && f >= 30);
            fpsEl.classList.toggle("is-bad", f < 30);
          }
        }
      }

      // touch-ui class may be added by the input module at any time
      touchClock += dt;
      if (touchClock > 0.5) {
        touchClock = 0;
        syncTouch();
      }

      // minimap (<= 30 fps, only while visible)
      if (phase === "game" && !paused) {
        mapClock += dt;
        if (mapClock >= MAP_FRAME_TIME) {
          mapClock %= MAP_FRAME_TIME;
          minimap.draw(s, elapsed);
        }
      }
    } catch (err) {
      if (!warned) {
        warned = true;
        console.warn("[hud] update failed", err);
      }
    }
  }

  return {
    setLoading,
    showStartScreen,
    setMap(town) {
      try {
        minimap.setMap(town);
      } catch (err) {
        console.warn("[hud] minimap setup failed", err);
      }
    },
    update,
    toast,
    showZone,
    get paused() {
      return paused;
    },
  };
}

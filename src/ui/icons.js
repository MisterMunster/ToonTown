// Hand-authored SVG icons for the HUD: hotbar items, UI glyphs, the hero
// portrait and minimap landmark glyphs. Everything is inline markup (no
// external assets) in a consistent "sticker" style: flat fills, a lighter
// highlight, and a rounded dark-navy outline. No gradients/ids are used, so
// any number of copies can live in the document without id clashes.

const N = "#1d2b3a"; // outline navy (matches --ui-dark)

/** Rounded navy outline attributes. */
const o = (w = 3) => `stroke="${N}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"`;

/** Wrap SVG body markup in a square, decorative <svg>. */
const svg = (body, vb = 64) =>
  `<svg viewBox="0 0 ${vb} ${vb}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">${body}</svg>`;

/** 4-point sparkle centred on (x, y) with arm length r. */
const sparkle = (x, y, r, fill = "#fffbe6", w = 1.6) => {
  const k = r * 0.22;
  return `<path d="M${x} ${y - r} Q${x + k} ${y - k} ${x + r} ${y} Q${x + k} ${y + k} ${x} ${y + r} Q${x - k} ${y + k} ${x - r} ${y} Q${x - k} ${y - k} ${x} ${y - r}Z" fill="${fill}" ${o(w)}/>`;
};

// ---------------------------------------------------------------------------
// Hotbar items (64×64)
// ---------------------------------------------------------------------------

const sword = svg(`
<g transform="rotate(45 32 32)">
  <path d="M26 44V13l6-9 6 9v31z" fill="#f2cf94" ${o()}/>
  <path d="M32 11v30" stroke="#c99256" stroke-width="2.4" stroke-linecap="round"/>
  <path d="M28.9 15v25" stroke="#fff4dc" stroke-width="2" stroke-linecap="round"/>
  <rect x="16" y="42" width="32" height="8" rx="4" fill="#a8693a" ${o()}/>
  <path d="M19.8 44.6h9.5" stroke="#d39a63" stroke-width="2" stroke-linecap="round"/>
  <rect x="28" y="50" width="8" height="9" rx="2" fill="#7a4a28" ${o()}/>
  <path d="M29 53.6l6-1.4M29 57l6-1.4" stroke="${N}" stroke-width="1.4" stroke-linecap="round" opacity=".55"/>
  <circle cx="32" cy="61" r="4" fill="#a8693a" ${o()}/>
</g>`);

const RIVETS = [
  [54.75, 33], [48.09, 49.09], [32, 55.75], [15.91, 49.09],
  [9.25, 33], [15.91, 16.91], [32, 10.25], [48.09, 16.91],
]
  .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.8" fill="#e3e8ef" ${o(1.3)}/>`)
  .join("");

const shield = svg(`
<circle cx="32" cy="33" r="26" fill="#aab4c3" ${o()}/>
<path d="M10.6 25.6A23 23 0 0 1 24.4 11.4" stroke="#eef2f7" stroke-width="3" fill="none" stroke-linecap="round"/>
<circle cx="32" cy="33" r="19.5" fill="#d9a066" ${o(2.5)}/>
<path d="M25 16.4v33.2M39 16.4v33.2" stroke="#b07a45" stroke-width="2.2"/>
<path d="M17.5 28A15 15 0 0 1 26.5 18.6" stroke="#f1c48d" stroke-width="2.6" fill="none" stroke-linecap="round"/>
${RIVETS}
<circle cx="32" cy="33" r="7.5" fill="#e3e8ef" ${o(2.5)}/>
<circle cx="29.6" cy="30.6" r="2.2" fill="#fff"/>`);

const potion = svg(`
<path d="M27 21v-8h10v8a18.5 18.5 0 1 1-10 0z" fill="#e6f5ff" ${o()}/>
<path d="M18.6 31q6.7-3.5 13.4 0t13.4 0a15.5 15.5 0 1 1-26.8 0z" fill="#ff4d6d"/>
<path d="M20.5 45a13 13 0 0 0 23 0" fill="none" stroke="#d92e55" stroke-width="3.5" stroke-linecap="round"/>
<path d="M32 46.5c-5-3.3-6.8-5.9-6.4-8.3.4-2.3 3.8-3.2 6.4-.6 2.6-2.6 6-1.7 6.4.6.4 2.4-1.4 5-6.4 8.3z" fill="#fff" opacity=".92"/>
<circle cx="23.5" cy="35.5" r="1.8" fill="#fff" opacity=".8"/>
<circle cx="41.5" cy="37" r="1.3" fill="#fff" opacity=".8"/>
<path d="M17.6 36a15 15 0 0 1 4.6-8.4" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"/>
<path d="M29.6 15.5v5" stroke="#fff" stroke-width="2" stroke-linecap="round"/>
<rect x="25.5" y="4.5" width="13" height="10" rx="3" fill="#c8a26b" ${o()}/>
<path d="M28.6 8.2h6.8" stroke="#a37f4b" stroke-width="2" stroke-linecap="round"/>
<rect x="24" y="13" width="16" height="5.5" rx="2.75" fill="#cfe9fb" ${o(2.5)}/>`);

const bubbles = svg(`
<path d="M15 55l20.6-26.1" stroke="${N}" stroke-width="8.5" stroke-linecap="round"/>
<path d="M15 55l20.6-26.1" stroke="#c77dff" stroke-width="4" stroke-linecap="round"/>
<path d="M15 55l5.3-6.7" stroke="#8e5de0" stroke-width="4" stroke-linecap="round"/>
<circle cx="42" cy="21" r="10.5" fill="#cdeeff" fill-opacity=".6" stroke="${N}" stroke-width="8"/>
<circle cx="42" cy="21" r="10.5" fill="none" stroke="#ff8fd0" stroke-width="4"/>
<path d="M36.6 18.4a6 6 0 0 1 3.6-3.6" stroke="#fff" stroke-width="2.2" fill="none" stroke-linecap="round"/>
<circle cx="17.5" cy="17.5" r="8.5" fill="#e3f6ff" fill-opacity=".85" ${o(2.5)}/>
<path d="M12.6 16a5.5 5.5 0 0 1 3.8-3.8" stroke="#fff" stroke-width="2.4" fill="none" stroke-linecap="round"/>
<path d="M22.6 20a5.5 5.5 0 0 1-3 3.2" stroke="#ff9bd6" stroke-width="2" fill="none" stroke-linecap="round"/>
<circle cx="52" cy="45" r="5.8" fill="#e3f6ff" fill-opacity=".85" ${o(2.5)}/>
<circle cx="50.2" cy="43.2" r="1.5" fill="#fff"/>
<circle cx="8.5" cy="35" r="3.2" fill="#e3f6ff" fill-opacity=".85" ${o(2)}/>
${sparkle(30, 7, 4.5, "#fff3b0", 1.5)}`);

const key = svg(`
<g transform="rotate(-45 32 33)">
  <rect x="35" y="45" width="9" height="5.5" rx="1.8" fill="#ffc93c" ${o(2.5)}/>
  <rect x="35" y="52" width="7" height="5.5" rx="1.8" fill="#ffc93c" ${o(2.5)}/>
  <rect x="28.5" y="27" width="8" height="33" rx="3.5" fill="#ffc93c" ${o()}/>
  <path d="M31.3 33v22" stroke="#fff3c4" stroke-width="2" stroke-linecap="round"/>
  <path fill-rule="evenodd" d="M32.5 4a13 13 0 1 1 0 26a13 13 0 1 1 0-26zM32.5 11.5a5.5 5.5 0 1 0 0 11a5.5 5.5 0 1 0 0-11z" fill="#ffc93c" ${o()}/>
  <path d="M23.4 13.4a10 10 0 0 1 5.6-5.6" stroke="#fff3c4" stroke-width="2.4" fill="none" stroke-linecap="round"/>
  <path d="M41.8 22.6a10 10 0 0 1-4.6 4.4" stroke="#e39b00" stroke-width="2.4" fill="none" stroke-linecap="round"/>
  <rect x="26.5" y="27.5" width="12" height="5" rx="2.5" fill="#f2a900" ${o(2.5)}/>
</g>
${sparkle(51, 13, 6)}
${sparkle(13, 51, 4.2)}`);

const treasureMap = svg(`
<path d="M13 16l38-4v38l-38 4z" fill="#f8e8bd" ${o()}/>
<path d="M14.5 44.5q4-9 12-6 7-5 11 2 2 6-5 7-6 4-11 1-6 2-7-4z" fill="#a6dd7f" stroke="#6fb150" stroke-width="1.8" stroke-linejoin="round"/>
<path d="M18 30.5q2-1.6 4 0t4 0M36 23q2-1.6 4 0t4 0" stroke="#6ab8e8" stroke-width="1.8" fill="none" stroke-linecap="round"/>
<path d="M20 22.5q8-6 11 2t9.5 11" fill="none" stroke="#e05d5d" stroke-width="2.6" stroke-dasharray="3.2 3.4" stroke-linecap="round"/>
<circle cx="20" cy="22.5" r="2.4" fill="#e05d5d"/>
<path d="M38.5 35.5l7 7M45.5 35.5l-7 7" stroke="#d63b3b" stroke-width="3.6" stroke-linecap="round"/>
<rect x="8" y="14" width="9" height="42" rx="4.5" fill="#e5c482" ${o()}/>
<path d="M11 18.5v33" stroke="#f6dfa8" stroke-width="2" stroke-linecap="round"/>
<rect x="47" y="9" width="9" height="42" rx="4.5" fill="#e5c482" ${o()}/>
<path d="M50 13.5v33" stroke="#f6dfa8" stroke-width="2" stroke-linecap="round"/>`);

const camera = svg(`
<rect x="21" y="12" width="17" height="10" rx="3" fill="#dfe5ec" ${o()}/>
<rect x="42" y="13.5" width="9" height="7" rx="2" fill="#ff5d5d" ${o(2.5)}/>
<rect x="7" y="19" width="50" height="35" rx="8" fill="#ff7b6b" ${o()}/>
<path d="M8.5 29v-3.5a5 5 0 0 1 5-5h37a5 5 0 0 1 5 5V29z" fill="#e7ecf2"/>
<path d="M8.5 29h47" stroke="${N}" stroke-width="2.2"/>
<path d="M12 33.5v14" stroke="#ffb0a6" stroke-width="2.4" stroke-linecap="round"/>
<rect x="12" y="22.6" width="8" height="4" rx="1.5" fill="#fff6c2" ${o(1.8)}/>
<circle cx="50" cy="34" r="2.2" fill="#ffd93d" ${o(1.6)}/>
<circle cx="32" cy="38" r="13" fill="#e7ecf2" ${o()}/>
<circle cx="32" cy="38" r="8.5" fill="#2b4d7e" ${o(2.5)}/>
<circle cx="32" cy="38" r="4.6" fill="#4d96ff"/>
<circle cx="29" cy="35" r="2.3" fill="#fff"/>
<path d="M22.6 33.5a10.5 10.5 0 0 1 5-5" stroke="#fff" stroke-width="2.2" fill="none" stroke-linecap="round"/>`);

const rod = svg(`
<path d="M44 51.5q4-2 8 0t8 0" stroke="#4fc3f7" stroke-width="2.2" fill="none" stroke-linecap="round"/>
<path d="M52 8q3.8 14 0 27" fill="none" stroke="#5b6475" stroke-width="1.6"/>
<path d="M13 55Q28 30 52 8" fill="none" stroke="${N}" stroke-width="6.5" stroke-linecap="round"/>
<path d="M13 55Q28 30 52 8" fill="none" stroke="#b07a45" stroke-width="3" stroke-linecap="round"/>
<path d="M13 55l5.5-9" stroke="${N}" stroke-width="9.5" stroke-linecap="round"/>
<path d="M13 55l5.5-9" stroke="#e0c27e" stroke-width="5.5" stroke-linecap="round"/>
<circle cx="25.5" cy="46.5" r="6" fill="#aab4c3" ${o(2.5)}/>
<path d="M25.5 46.5l4.6 4.6" stroke="${N}" stroke-width="2.2" stroke-linecap="round"/>
<circle cx="25.5" cy="46.5" r="2" fill="${N}"/>
<path d="M46 41a6 6 0 0 1 12 0z" fill="#ff5d5d"/>
<path d="M46 41a6 6 0 0 0 12 0z" fill="#fff"/>
<circle cx="52" cy="41" r="6" fill="none" ${o(2.5)}/>
<path d="M46.5 41h11" stroke="${N}" stroke-width="1.8"/>
<circle cx="49.8" cy="38.4" r="1.4" fill="#fff"/>`);

/** Hotbar item icons keyed by item id. */
export const ITEM_ICONS = {
  sword,
  shield,
  potion,
  bubbles,
  key,
  map: treasureMap,
  camera,
  rod,
};

// ---------------------------------------------------------------------------
// UI glyphs (24×24)
// ---------------------------------------------------------------------------

const ui = (body) => svg(body, 24);

const HEART_PATH =
  "M12 21C5 16.2 2 12.6 2 8.7 2 5.6 4.4 3.2 7.3 3.2c2 0 3.7 1.1 4.7 2.8 1-1.7 2.7-2.8 4.7-2.8 2.9 0 5.3 2.4 5.3 5.5 0 3.9-3 7.5-10 12.3z";

const SUN_RAYS =
  "M12 4.6V2M17.2 6.8l1.9-1.9M19.4 12H22M17.2 17.2l1.9 1.9M12 19.4V22M6.8 17.2l-1.9 1.9M4.6 12H2M6.8 6.8L4.9 4.9";

const STAR_PATH =
  "M12 2.8l2.75 5.6 6.15.9-4.45 4.33 1.05 6.12L12 16.85l-5.5 2.9 1.05-6.12L3.1 9.3l6.15-.9z";

const SPEAKER = `<path d="M3.5 9.2h3.7l5-4.2v14l-5-4.2H3.5z" fill="${N}" ${o(1.6)}/>`;
const NOTES = `<path d="M9 17.5V7l10-2.2v10.7" fill="none" ${o(2.2)}/><path d="M9 7l10-2.2v3.4L9 10.4z" fill="${N}" ${o(1.4)}/><circle cx="6.6" cy="17.6" r="2.7" fill="${N}"/><circle cx="16.6" cy="15.6" r="2.7" fill="${N}"/>`;
const SLASH = `<path d="M4 4l16 16" stroke="#fffaf0" stroke-width="5" stroke-linecap="round"/><path d="M4 4l16 16" stroke="#e04848" stroke-width="2.4" stroke-linecap="round"/>`;

/** UI glyphs keyed by name. Also accepted as `icon` names by hud.toast(). */
export const ICONS = {
  heart: ui(`<path d="${HEART_PATH}" fill="#ff5d5d" ${o(2)}/><ellipse cx="7.4" cy="8.4" rx="2.1" ry="1.5" transform="rotate(-35 7.4 8.4)" fill="#fff" opacity=".85"/>`),
  heartEmpty: ui(`<path d="${HEART_PATH}" fill="#d9d2c3" ${o(2)}/>`),
  coin: ui(
    `<circle cx="12" cy="12" r="10" fill="#ffcc33" ${o(2)}/><circle cx="12" cy="12" r="6.6" fill="#ffdb5c" stroke="#e8a317" stroke-width="1.6"/>` +
      `<path d="M12 8.2l1.15 2.35 2.6.38-1.88 1.83.44 2.58L12 14.12l-2.31 1.22.44-2.58-1.88-1.83 2.6-.38z" fill="#f0a500"/>` +
      `<path d="M5.6 9.4a6.9 6.9 0 0 1 3.5-3.9" stroke="#fff6d0" stroke-width="1.7" fill="none" stroke-linecap="round"/>`,
  ),
  sun: ui(`<path d="${SUN_RAYS}" stroke="#fb8500" stroke-width="2.2" stroke-linecap="round"/><circle cx="12" cy="12" r="4.8" fill="#ffcc33" ${o(1.8)}/>`),
  moon: ui(`<path d="M20.5 13.6A8.6 8.6 0 1 1 10.4 3.5a6.7 6.7 0 0 0 10.1 10.1z" fill="#ffe08a" ${o(1.8)}/>${sparkle(17.6, 5.6, 2.6, "#ffe08a", 1.2)}`),
  sunset: ui(
    `<path d="M12 4.2V2.2M6.5 6.6L5 5.1M17.5 6.6L19 5.1M3.6 11.4H2M22 11.4h-1.6" stroke="#fb8500" stroke-width="2" stroke-linecap="round"/>` +
      `<path d="M5.2 15a6.8 6.8 0 0 1 13.6 0z" fill="#ff9f43" ${o(1.8)}/><path d="M2.5 15.2h19" ${o(2)}/>` +
      `<path d="M7 18.6h10M9.5 21.4h5" stroke="#fb8500" stroke-width="2" stroke-linecap="round"/>`,
  ),
  cycle: ui(
    `<path d="M19.3 9.3A8 8 0 0 0 5.2 7.6" fill="none" ${o(2.2)}/><path d="M4.2 3.8l.8 4.3 4.2-.9" fill="none" ${o(2.2)}/>` +
      `<path d="M4.7 14.7a8 8 0 0 0 14.1 1.7" fill="none" ${o(2.2)}/><path d="M19.8 20.2l-.8-4.3-4.2.9" fill="none" ${o(2.2)}/>` +
      `<path d="M12 8.2a3.8 3.8 0 0 0 0 7.6z" fill="#ffcc33"/><path d="M12 8.2a3.8 3.8 0 0 1 0 7.6z" fill="#5d6fb5"/><circle cx="12" cy="12" r="3.8" fill="none" ${o(1.6)}/>`,
  ),
  soundOn: ui(`${SPEAKER}<path d="M15.4 9.2a4 4 0 0 1 0 5.6M18.2 6.4a8 8 0 0 1 0 11.2" fill="none" ${o(2.2)}/>`),
  soundOff: ui(`${SPEAKER}<path d="M15.6 9.4l5 5M20.6 9.4l-5 5" stroke="#e04848" stroke-width="2.4" stroke-linecap="round"/>`),
  musicOn: ui(NOTES),
  musicOff: ui(NOTES + SLASH),
  menu: ui(`<path d="M5 7h14M5 12h14M5 17h14" ${o(2.6)}/>`),
  pause: ui(`<rect x="6" y="4.5" width="4" height="15" rx="1.6" fill="${N}"/><rect x="14" y="4.5" width="4" height="15" rx="1.6" fill="${N}"/>`),
  play: ui(`<path d="M8 5.6v12.8a1.1 1.1 0 0 0 1.7.9l10-6.4a1.1 1.1 0 0 0 0-1.8l-10-6.4A1.1 1.1 0 0 0 8 5.6z" fill="currentColor"/>`),
  bolt: ui(`<path d="M13.6 2L5 13.4h6L9.6 22 19 9.6h-6.2z" fill="#ffd93d" ${o(1.8)}/>`),
  chat: ui(
    `<path d="M4.5 4.5h15a2.5 2.5 0 0 1 2.5 2.5v8a2.5 2.5 0 0 1-2.5 2.5h-8.5l-4.5 3.6v-3.6h-2a2.5 2.5 0 0 1-2.5-2.5V7a2.5 2.5 0 0 1 2.5-2.5z" fill="#fff" ${o(1.8)}/>` +
      `<circle cx="8" cy="11" r="1.4" fill="${N}"/><circle cx="12" cy="11" r="1.4" fill="${N}"/><circle cx="16" cy="11" r="1.4" fill="${N}"/>`,
  ),
  star: ui(`<path d="${STAR_PATH}" fill="#ffcc33" ${o(1.8)}/><path d="M9 9.6l-2.4.4" stroke="#fff6d0" stroke-width="1.5" stroke-linecap="round"/>`),
  trophy: ui(
    `<path d="M7 5.5H3.6v2.2c0 2.6 1.8 4.2 4.4 4.4M17 5.5h3.4v2.2c0 2.6-1.8 4.2-4.4 4.4" fill="none" ${o(1.8)}/>` +
      `<path d="M6.6 3.2h10.8v5.4a5.4 5.4 0 0 1-10.8 0z" fill="#ffcc33" ${o(1.8)}/><path d="M12 14v3.4" ${o(2.4)}/>` +
      `<rect x="7.4" y="17.4" width="9.2" height="3.6" rx="1.2" fill="#c98b4f" ${o(1.8)}/><path d="M9.2 5.6v3" stroke="#fff6d0" stroke-width="1.6" stroke-linecap="round"/>`,
  ),
  info: ui(`<circle cx="12" cy="12" r="9.5" fill="#4d96ff" ${o(1.8)}/><path d="M12 11v5.5" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/><circle cx="12" cy="7.6" r="1.6" fill="#fff"/>`),
  bulb: ui(
    `<path d="M12 2.8a6.6 6.6 0 0 0-3.9 11.9c.6.5.9 1.1.9 1.8v.8h6v-.8c0-.7.3-1.3.9-1.8A6.6 6.6 0 0 0 12 2.8z" fill="#ffe066" ${o(1.8)}/>` +
      `<path d="M9.4 19.6h5.2M10.2 21.8h3.6" ${o(1.8)}/><path d="M9 8.4a3.4 3.4 0 0 1 2.4-2.4" stroke="#fff" stroke-width="1.6" fill="none" stroke-linecap="round"/>`,
  ),
  sparkle: ui(sparkle(12, 12, 9, "#fff3b0", 1.8)),
  close: ui(`<path d="M6.5 6.5l11 11M17.5 6.5l-11 11" ${o(2.8)}/>`),
  check: ui(`<path d="M5 12.5l4.5 4.5L19 7.5" fill="none" ${o(2.8)}/>`),
  gear: ui(
    `<path d="M10.3 2.5h3.4l.5 2.6 1.6.7 2.2-1.5 2.4 2.4-1.5 2.2.7 1.6 2.6.5v3.4l-2.6.5-.7 1.6 1.5 2.2-2.4 2.4-2.2-1.5-1.6.7-.5 2.6h-3.4l-.5-2.6-1.6-.7-2.2 1.5-2.4-2.4 1.5-2.2-.7-1.6-2.6-.5v-3.4l2.6-.5.7-1.6-1.5-2.2 2.4-2.4 2.2 1.5 1.6-.7z" fill="#aab4c3" ${o(1.6)}/>` +
      `<circle cx="12" cy="12" r="3.2" fill="#fffaf0" ${o(1.6)}/>`,
  ),
  camera: ui(
    `<path d="M3 8.5a2 2 0 0 1 2-2h2.4l1.4-2h6.4l1.4 2H19a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" fill="#aab4c3" ${o(1.8)}/>` +
      `<circle cx="12" cy="13" r="4" fill="#4d96ff" ${o(1.8)}/>`,
  ),
  mouse: ui(
    `<rect x="6" y="2.5" width="12" height="19" rx="6" fill="#fffaf0" ${o(1.8)}/><path d="M12 2.8v6.4M6.2 9.2h11.6" ${o(1.6)}/>` +
      `<path d="M6.9 8.4V8a5.1 5.1 0 0 1 4.2-5v5.4z" fill="#ffb703"/>`,
  ),
  hand: ui(
    `<path d="M9 11.5V5a1.6 1.6 0 0 1 3.2 0v5.2V8.6a1.6 1.6 0 0 1 3.2 0v2.2a1.6 1.6 0 0 1 3.2 0v4.4c0 3.8-2.6 6.8-6.4 6.8-2.4 0-4-1-5.4-3l-2.6-3.6a1.6 1.6 0 0 1 2.4-2.1L9 15z" fill="#ffd9ae" ${o(1.6)}/>`,
  ),
  dpad: ui(
    `<path d="M9 2.5h6v6.5h6.5v6H15v6.5H9V15H2.5V9H9z" fill="#fffaf0" ${o(1.8)}/>` +
      `<path d="M12 4.6l1.6 2.2h-3.2zM12 19.4l1.6-2.2h-3.2zM4.6 12l2.2-1.6v3.2zM19.4 12l-2.2-1.6v3.2z" fill="${N}"/>`,
  ),
  arrowUp: ui(`<path d="M12 6.5l6 8H6z" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>`),
  arrowDown: ui(`<path d="M12 17.5l6-8H6z" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>`),
  arrowLeft: ui(`<path d="M6.5 12l8-6v12z" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>`),
  arrowRight: ui(`<path d="M17.5 12l-8-6v12z" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>`),
  map: ui(
    `<path d="M3 6l5.5-2 7 2 5.5-2v14l-5.5 2-7-2L3 20z" fill="#f8e8bd" ${o(1.8)}/><path d="M8.5 4v14M15.5 6v14" ${o(1.6)}/>`,
  ),
};

// ---------------------------------------------------------------------------
// Hero portrait: Pip — warm skin, chestnut hair, red backwards cap, big eyes.
// ---------------------------------------------------------------------------

const SKIN = "#ffd6a8";
const SKIN_SHADE = "#f0b98a";
const HAIR = "#7b4424";
const CAP = "#e63946";
const CAP_DARK = "#b52a36";

export const PIP_PORTRAIT = svg(
  `
<rect width="80" height="80" fill="#9ad8ff"/>
<circle cx="64" cy="14" r="22" fill="#c4ebff"/>
<path d="M6 82c2-14 14-21 34-21s32 7 34 21z" fill="#4d96ff" ${o(2.5)}/>
<path d="M30 61.6l10 7.4 10-7.4" fill="#fffaf0" ${o(2.2)}/>
<rect x="34" y="50" width="12" height="12" rx="4" fill="${SKIN_SHADE}" ${o(2.2)}/>
<path d="M56.5 17.5c7-2.6 14.6-2.4 18 1.6-3 3.4-9.6 5.6-16.4 5.4z" fill="${CAP_DARK}" ${o(2.5)}/>
<circle cx="18.5" cy="43" r="6" fill="${SKIN}" ${o(2.5)}/>
<circle cx="61.5" cy="43" r="6" fill="${SKIN}" ${o(2.5)}/>
<path d="M17.6 43.4a2.4 2.4 0 0 1 2.4-2.6M62.4 43.4a2.4 2.4 0 0 0-2.4-2.6" stroke="${SKIN_SHADE}" stroke-width="2" fill="none" stroke-linecap="round"/>
<ellipse cx="40" cy="41" rx="21.5" ry="20.5" fill="${SKIN}" ${o(2.5)}/>
<path d="M18.6 35.6c-1.4 4.6-.6 8.6 2.6 11 .2-4.4 1.4-7.6 4-9.6zM61.4 35.6c1.4 4.6.6 8.6-2.6 11-.2-4.4-1.4-7.6-4-9.6z" fill="${HAIR}" ${o(2)}/>
<path d="M16.6 35.4C16.4 20 26.6 11.6 40 11.6S63.6 20 63.4 35.4c-6.8-3.4-14.6-5-23.4-5s-16.6 1.6-23.4 5z" fill="${CAP}" ${o(2.5)}/>
<path d="M32.6 31.4c.8-5 3.6-7.6 7.4-7.6s6.6 2.6 7.4 7.6c-2.4-.4-4.8-.6-7.4-.6s-5 .2-7.4.6z" fill="${HAIR}" ${o(2)}/>
<path d="M36.4 30.6c.6-2 1.8-3.2 3.6-3.6M41.6 27.6c1.4.6 2.4 1.8 2.8 3.2" stroke="#a0603a" stroke-width="1.6" fill="none" stroke-linecap="round"/>
<path d="M22.6 24.6c2.6-5.4 7.4-8.6 13-9.4" stroke="#ff8a93" stroke-width="2.6" fill="none" stroke-linecap="round"/>
<circle cx="40" cy="11.8" r="2.6" fill="${CAP_DARK}" ${o(2)}/>
<path d="M27.4 37.2q3.8-2.4 7.6-.4M45 36.8q3.8-2 7.6.4" stroke="${HAIR}" stroke-width="2.4" fill="none" stroke-linecap="round"/>
<ellipse cx="31.8" cy="44" rx="5.2" ry="6.4" fill="#fff" ${o(2)}/>
<ellipse cx="48.2" cy="44" rx="5.2" ry="6.4" fill="#fff" ${o(2)}/>
<ellipse cx="32.6" cy="45" rx="3.5" ry="4.4" fill="#2b2238"/>
<ellipse cx="49" cy="45" rx="3.5" ry="4.4" fill="#2b2238"/>
<circle cx="31.2" cy="43.2" r="1.6" fill="#fff"/>
<circle cx="47.6" cy="43.2" r="1.6" fill="#fff"/>
<circle cx="33.9" cy="47" r=".8" fill="#fff"/>
<circle cx="50.3" cy="47" r=".8" fill="#fff"/>
<ellipse cx="24.4" cy="51.6" rx="4" ry="2.6" fill="#ff8fa3" opacity=".65"/>
<ellipse cx="55.6" cy="51.6" rx="4" ry="2.6" fill="#ff8fa3" opacity=".65"/>
<ellipse cx="40" cy="49.6" rx="2.1" ry="1.5" fill="${SKIN_SHADE}"/>
<path d="M35.2 53.4q4.8 5.6 9.6 0z" fill="#8c2f39" ${o(2)}/>
<path d="M37.6 55.6q2.4-1.6 4.8 0q-2.4 1.6-4.8 0z" fill="#ff7b8a"/>`,
  80,
);

// ---------------------------------------------------------------------------
// Minimap landmark glyphs: SVG path data in a 24×24 box, drawn with Path2D.
// The HUD picks one by keyword (landmark.icon first, then its name).
// ---------------------------------------------------------------------------

export const LANDMARK_GLYPHS = [
  { match: /hall|city|museum|capitol|castle|tower|clock/, color: "#e05d5d",
    path: "M12 2.5l9 5v2H3v-2zM4.5 11h3v7h-3zM10.5 11h3v7h-3zM16.5 11h3v7h-3zM3 19.5h18v2.5H3z" },
  { match: /fountain|well|water|pond|lake|river|harbou?r|dock|pier|beach/, color: "#2196c9",
    path: "M12 3c3.6 4.6 6 8.2 6 11a6 6 0 0 1-12 0c0-2.8 2.4-6.4 6-11z" },
  { match: /bak|bread|cake|pastr|donut/, color: "#c0702e",
    path: "M4 11.5C4 7.4 7.6 5 12 5s8 2.4 8 6.5c0 1.6-1.2 2.5-2.5 2.5V19H6.5v-5C5.2 14 4 13.1 4 11.5z" },
  { match: /caf|coffee|tea|diner|restaurant|food|ice ?cream|pizza/, color: "#8a5a3b",
    path: "M4 7h13v6.5A5.5 5.5 0 0 1 11.5 19h-2A5.5 5.5 0 0 1 4 13.5zM17 8.5h1.5a2.6 2.6 0 0 1 0 5.2H17v-1.8h1.4a.8.8 0 0 0 0-1.6H17zM3 20h15v2H3z" },
  { match: /post|mail|letter/, color: "#e05d5d", evenodd: true,
    path: "M3 6h18v12H3zM5 8v.4l7 5 7-5V8zM5 10.8V16h14v-5.2l-7 5z" },
  { match: /shop|store|market|mart|grocer|boutique|toy|flower|florist/, color: "#c77dff",
    path: "M5 8h14l-1 13H6zM8.5 8V6.5a3.5 3.5 0 0 1 7 0V8h-1.8V6.5a1.7 1.7 0 0 0-3.4 0V8z" },
  { match: /band|music|stage|theat|concert/, color: "#ff6b9d",
    path: "M9 6.5l11-2.5v12a3 3 0 1 1-2-2.8V8.3l-7 1.6v8.6a3 3 0 1 1-2-2.8z" },
  { match: /bus|station|stop|train|rail/, color: "#ffb703", evenodd: true,
    path: "M6.5 3h11A2.5 2.5 0 0 1 20 5.5V18h-1.5v2.5h-3V18h-7v2.5h-3V18H4V5.5A2.5 2.5 0 0 1 6.5 3zM6 6v5.5h12V6zM7.5 14a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6zM16.5 14a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6z" },
  { match: /park|garden|tree|forest|grove|meadow|playground|maple/, color: "#2e9d52",
    path: "M12 2.5a6 6 0 0 1 5.6 8.2A5 5 0 0 1 15 19.5h-1.6V22h-2.8v-2.5H9A5 5 0 0 1 6.4 10.7 6 6 0 0 1 12 2.5z" },
  { match: /school|library|book|academy|office/, color: "#4d96ff", evenodd: true,
    path: "M3 5.5c3.4-.8 6.4-.4 9 1.4 2.6-1.8 5.6-2.2 9-1.4v13c-3.4-.8-6.4-.4-9 1.4-2.6-1.8-5.6-2.2-9-1.4zM11.1 8.4v9.4h1.8V8.4z" },
  { match: /mill|wind|farm|barn/, color: "#e0915d",
    path: "M11 11.2L4 4.2 6.2 2l7 7zM12.8 11L19.8 4l2.2 2.2-7 7zM13 12.8l7 7-2.2 2.2-7-7zM11.2 13l-7 7L2 17.8l7-7zM12 9.6a2.4 2.4 0 1 1 0 4.8 2.4 2.4 0 0 1 0-4.8z" },
  { match: /home|house|cottage|inn|hotel/, color: "#e0915d",
    path: "M12 3l9 8h-2.5v9.5h-5v-6h-3v6h-5V11H3z" },
  { match: /./, color: "#ffb703", path: STAR_PATH }, // fallback: star
];

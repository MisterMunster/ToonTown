// Time of day: the clock (cycle / fixed modes with smooth transitions), the
// sun and moon paths, and keyframed colour palettes. `evaluateSky(hours, out)`
// fills a pre-allocated state object every frame, so there are no per-frame
// allocations. All colours are authored as hex for easy art tweaking.
import { Color3, Vector3 } from "@babylonjs/core";

/** Real seconds for one full in-game day (24 h ≈ 8 minutes). */
export const DAY_SECONDS = 8 * 60;
export const SUNRISE = 6.0;
export const SUNSET = 18.5;
/** Fixed times used by the `settings:daynight` modes. */
export const MODE_TIMES = { day: 13.0, sunset: 18.25, night: 22.5 };
const TRANSITION_SECONDS = 1.5;

const DEG = Math.PI / 180;
const SUN_MAX_ELEVATION = 62 * DEG;
const MOON_MAX_ELEVATION = 18 * DEG; // a big low moon, visible from the follow camera
const MOONRISE = 17.5; // the moon is up 17:30 → 06:30, highest around midnight
const MOON_SPAN = 13.0;

/** Moonlight colour/intensity (the key light at night): a cool blue key that
 * picks out moon-facing walls while the deep-blue ambient keeps the rest dim,
 * so warm lamps, lit windows and string lights carry the night. */
const MOON_LIGHT = Color3.FromHexString("#92afff");
const MOON_INTENSITY = 0.36;

// ---- palettes -------------------------------------------------------------
// zenith/mid/horizon/below: sky gradient (mid = sky just above the horizon).
// fog matches the horizon so distant ground melts into the sky.
// glow: warm halo around the sun near the horizon (premultiplied by glowAmt).
// light/lightI: sun colour & intensity. hemi*: soft sky fill + ground bounce.
// cloudLit/cloudShade: two-tone cartoon clouds.
const NIGHT = {
  zenith: "#070f2e", mid: "#15215a", horizon: "#2b3a78", below: "#141d44", fog: "#1d2a5e",
  glow: "#4a5aa0", glowAmt: 0.0, light: "#92afff", lightI: 0.0,
  hemiSky: "#4c6ee0", hemiGround: "#1c2a48", hemiI: 0.46,
  cloudLit: "#56679e", cloudShade: "#28336a",
};
const PREDAWN = {
  zenith: "#18215a", mid: "#3e4189", horizon: "#9a75aa", below: "#3d3866", fog: "#6a5f96",
  glow: "#d991b0", glowAmt: 0.45, light: "#ff9e9a", lightI: 0.3,
  hemiSky: "#8d88c8", hemiGround: "#3a3e48", hemiI: 0.48,
  cloudLit: "#b693c2", cloudShade: "#4f4f86",
};
const DAWN = {
  zenith: "#5a7cc8", mid: "#eaaac4", horizon: "#ffc7a4", below: "#d8a3ac", fog: "#f0c0b0",
  glow: "#ffb488", glowAmt: 0.9, light: "#ffbe92", lightI: 0.72,
  hemiSky: "#e6c6d8", hemiGround: "#7f8060", hemiI: 0.46,
  cloudLit: "#ffe4d2", cloudShade: "#e3a7bd",
};
const MORNING = {
  zenith: "#4c9cec", mid: "#a8dbff", horizon: "#e6f4ff", below: "#c2e0f2", fog: "#d6edfb",
  glow: "#ffe6b8", glowAmt: 0.35, light: "#fff0d8", lightI: 0.7,
  hemiSky: "#d6ecff", hemiGround: "#90ba78", hemiI: 0.46,
  cloudLit: "#ffffff", cloudShade: "#dbe8f6",
};
const DAY = {
  zenith: "#2f8ae6", mid: "#8fd3ff", horizon: "#cdeeff", below: "#bde2f7", fog: "#cbe9fd",
  glow: "#fff6dc", glowAmt: 0.25, light: "#fff6e6", lightI: 0.68,
  hemiSky: "#dff0ff", hemiGround: "#94c47e", hemiI: 0.46,
  cloudLit: "#ffffff", cloudShade: "#d9e9f9",
};
const GOLDEN = {
  zenith: "#4e85d6", mid: "#f4c3b8", horizon: "#ffd58f", below: "#ecc49e", fog: "#f6d3a8",
  glow: "#ffbe66", glowAmt: 0.85, light: "#ffc679", lightI: 0.95,
  hemiSky: "#d3c6ee", hemiGround: "#b4a472", hemiI: 0.6,
  cloudLit: "#fff0d2", cloudShade: "#f0b7ab",
};
const SUNSET_KEY = {
  zenith: "#3a4e9e", mid: "#e48eb0", horizon: "#ffa060", below: "#bc6c8c", fog: "#e89c8c",
  glow: "#ff8a48", glowAmt: 1.0, light: "#ff9e5a", lightI: 0.88,
  hemiSky: "#c0a8e0", hemiGround: "#94786a", hemiI: 0.56,
  cloudLit: "#ffc69e", cloudShade: "#bb7caa",
};
// Dusk: coral horizon glow under a violet sky, purple ambient (warm-to-purple).
const DUSK = {
  zenith: "#2a2c74", mid: "#8552a8", horizon: "#f07f92", below: "#5e3a72", fog: "#9c5a8a",
  glow: "#ff8a6a", glowAmt: 0.85, light: "#d08cd8", lightI: 0.5,
  hemiSky: "#a786d6", hemiGround: "#56405e", hemiI: 0.52,
  cloudLit: "#e79cb8", cloudShade: "#5e4888",
};
const BLUE_HOUR = {
  zenith: "#121a52", mid: "#2c3282", horizon: "#5e4c9c", below: "#242656", fog: "#353874",
  glow: "#8a5cb0", glowAmt: 0.3, light: "#92afff", lightI: 0.0,
  hemiSky: "#5e6ade", hemiGround: "#262c4c", hemiI: 0.48,
  cloudLit: "#7670b2", cloudShade: "#33366e",
};

const KEYS = [
  [0.0, NIGHT],
  [4.6, NIGHT],
  [5.3, PREDAWN],
  [6.0, DAWN],
  [7.0, MORNING],
  [8.5, DAY],
  [15.6, DAY],
  [17.3, GOLDEN],
  [18.35, SUNSET_KEY],
  [19.15, DUSK],
  [20.0, BLUE_HOUR],
  [21.0, NIGHT],
  [24.0, NIGHT],
];

const COLOR_FIELDS = ["zenith", "mid", "horizon", "below", "fog", "glow", "light", "hemiSky", "hemiGround", "cloudLit", "cloudShade"];
const NUMBER_FIELDS = ["glowAmt", "lightI", "hemiI"];

// Convert hex strings to Color3 once at load time.
const FRAMES = KEYS.map(([t, src]) => {
  const f = { t };
  for (const k of COLOR_FIELDS) f[k] = Color3.FromHexString(src[k]);
  for (const k of NUMBER_FIELDS) f[k] = src[k];
  return f;
});

const SUN_DISC_LOW = Color3.FromHexString("#ff8c3a");
const SUN_DISC_HIGH = Color3.FromHexString("#fff4d6");

// ---- helpers -------------------------------------------------------------
export const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
export function smoothstep(e0, e1, x) {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}
export const wrapHours = (h) => ((h % 24) + 24) % 24;

/**
 * Point on a celestial arc: angle 0 = rising due east (+X), π/2 = due south
 * (-Z) at maxElevation, π = setting due west.
 */
function arcDirection(theta, maxElevation, out) {
  const s = Math.sin(theta);
  return out.set(Math.cos(theta), s * Math.sin(maxElevation), -s * Math.cos(maxElevation));
}

/** Sun arc angle: day maps 06:00→18:30 to 0→π, night maps 18:30→06:00 to π→2π. */
function sunAngle(h) {
  if (h >= SUNRISE && h <= SUNSET) return (Math.PI * (h - SUNRISE)) / (SUNSET - SUNRISE);
  const nightLen = 24 - (SUNSET - SUNRISE);
  const since = h > SUNSET ? h - SUNSET : h + 24 - SUNSET;
  return Math.PI + (Math.PI * since) / nightLen;
}

function moonAngle(h) {
  const t = h < 12 ? h + 24 : h;
  return (Math.PI * (t - MOONRISE)) / MOON_SPAN;
}

/** Allocate the per-frame sky/light state that evaluateSky() fills. */
export function createSkyState() {
  const s = {
    hours: 0,
    sunDir: new Vector3(0, 1, 0), // toward the sun
    moonDir: new Vector3(0, 1, 0), // toward the moon
    keyDir: new Vector3(0, -1, 0), // direction the key light travels
    keyColor: new Color3(1, 1, 1),
    keyIntensity: 1,
    keyIsMoon: false,
    sunElevation: 0, // degrees
    moonElevation: 0,
    sunVisibility: 1, // sun disc 0..1
    moonVisibility: 0, // moon disc 0..1
    nightFactor: 0,
    starAmount: 0,
    sunDiscColor: new Color3(1, 1, 1),
    glowColor: new Color3(0, 0, 0),
    cloudLightDir: new Vector3(0, 1, 0),
  };
  for (const k of COLOR_FIELDS) s[k] = new Color3();
  for (const k of NUMBER_FIELDS) s[k] = 0;
  return s;
}

/** Fill `out` (from createSkyState) for the given time in hours. Allocation-free. */
export function evaluateSky(hours, out) {
  const h = wrapHours(hours);
  out.hours = h;

  // Palette: linear blend between the two surrounding keyframes.
  let i = 0;
  while (i < FRAMES.length - 2 && h >= FRAMES[i + 1].t) i++;
  const a = FRAMES[i];
  const b = FRAMES[i + 1];
  const k = clamp01((h - a.t) / (b.t - a.t));
  for (let c = 0; c < COLOR_FIELDS.length; c++) {
    const f = COLOR_FIELDS[c];
    Color3.LerpToRef(a[f], b[f], k, out[f]);
  }
  for (let c = 0; c < NUMBER_FIELDS.length; c++) {
    const f = NUMBER_FIELDS[c];
    out[f] = a[f] + (b[f] - a[f]) * k;
  }

  // Sun & moon.
  arcDirection(sunAngle(h), SUN_MAX_ELEVATION, out.sunDir);
  arcDirection(moonAngle(h), MOON_MAX_ELEVATION, out.moonDir);
  const sunEl = Math.asin(Math.max(-1, Math.min(1, out.sunDir.y))) / DEG;
  const moonEl = Math.asin(Math.max(-1, Math.min(1, out.moonDir.y))) / DEG;
  out.sunElevation = sunEl;
  out.moonElevation = moonEl;
  out.nightFactor = smoothstep(6, -8, sunEl);
  out.starAmount = smoothstep(0.3, 1, out.nightFactor);
  out.sunVisibility = smoothstep(-4, 0.5, sunEl);
  out.moonVisibility = smoothstep(-3, 1, moonEl) * smoothstep(0.05, 0.6, out.nightFactor);

  // Key light: the sun while it is up, then (through zero intensity, so there
  // is never a visible pop) the moon. Both weights are 0 at -1° sun elevation.
  if (sunEl > -1) {
    out.keyIsMoon = false;
    out.keyDir.copyFrom(out.sunDir).scaleInPlace(-1);
    out.keyColor.copyFrom(out.light);
    out.keyIntensity = out.lightI * smoothstep(-1, 4, sunEl);
  } else {
    out.keyIsMoon = true;
    out.keyDir.copyFrom(out.moonDir).scaleInPlace(-1);
    out.keyColor.copyFrom(MOON_LIGHT);
    out.keyIntensity = MOON_INTENSITY * smoothstep(-1, -9, sunEl) * smoothstep(-2, 8, moonEl);
  }

  // Sun disc: warm orange near the horizon, pale yellow-white overhead. >1 so it blooms.
  Color3.LerpToRef(SUN_DISC_LOW, SUN_DISC_HIGH, smoothstep(2, 25, sunEl), out.sunDiscColor);
  out.sunDiscColor.scaleInPlace(1.35);
  out.glow.scaleToRef(out.glowAmt, out.glowColor);

  // Clouds are lit from a blend of sun and moon (plus a little "up") so their
  // shading never flips abruptly when the key light swaps over.
  const n = out.nightFactor;
  out.cloudLightDir.set(
    out.sunDir.x * (1 - n) + out.moonDir.x * n,
    out.sunDir.y * (1 - n) + out.moonDir.y * n + 0.35,
    out.sunDir.z * (1 - n) + out.moonDir.z * n,
  );
  out.cloudLightDir.normalize();
  return out;
}

/**
 * The game clock. "cycle" advances time; fixed modes ease to their preset hour
 * over ~1.5 s along the shortest way round the dial, then hold.
 */
export function createClock(startHours = 16) {
  const clock = {
    mode: "cycle",
    hours: startHours,
    _from: 0,
    _delta: 0,
    _t: 0,
    _transition: false,

    setMode(mode) {
      if (mode !== "cycle" && !(mode in MODE_TIMES)) return;
      this.mode = mode;
      if (mode === "cycle") {
        this._transition = false; // resume from wherever we are
        return;
      }
      let delta = wrapHours(MODE_TIMES[mode] - this.hours);
      if (delta > 12) delta -= 24;
      this._from = this.hours;
      this._delta = delta;
      this._t = 0;
      this._transition = Math.abs(delta) > 1e-4;
    },

    setHours(h) {
      this.hours = wrapHours(Number.isFinite(h) ? h : 12);
      this._transition = false;
    },

    update(dt) {
      if (this._transition) {
        this._t += dt;
        const p = clamp01(this._t / TRANSITION_SECONDS);
        const e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2; // easeInOutCubic
        this.hours = wrapHours(this._from + this._delta * e);
        if (p >= 1) this._transition = false;
      } else if (this.mode === "cycle") {
        this.hours = wrapHours(this.hours + (dt * 24) / DAY_SECONDS);
      }
    },
  };
  clock.setHours(startHours);
  return clock;
}

// Audio: 100% synthesized Web Audio — SFX, a composed procedural music loop and
// day/night ambience. No files are loaded.
//
// The AudioContext is created lazily on "game:start" (which follows a user
// gesture). Without Web Audio (e.g. the Node smoke test) everything is a silent
// no-op. Music and ambience are scheduled by time with a lookahead scheduler
// (setInterval ~25 ms, ~0.12 s ahead on the audio clock); update() only
// watches pause / night state and never creates nodes.
import { createMixer, glideGain, LEVELS } from "./audio/mixer.js";
import { createSfx } from "./audio/sfx.js";
import { createMusic } from "./audio/music.js";
import { createAmbience } from "./audio/ambience.js";

const MASTER_VOLUME = LEVELS.master;
const MUSIC_VOLUME = LEVELS.music; // sits under the SFX
const AMBIENCE_VOLUME = LEVELS.ambience;
const LOOKAHEAD = 0.12; // s scheduled ahead of the audio clock
const TICK_MS = 25;

/**
 * @param {{ events: { on(name: string, fn: Function): Function } }} opts
 * @returns {{ update(dt: number, state?: { paused?: boolean, nightFactor?: number, speed?: number }): void,
 *             muted: boolean, musicOn: boolean }}
 */
export function createAudio({ events } = {}) {
  const AC = typeof window !== "undefined" ? window.AudioContext || window.webkitAudioContext : undefined;

  let ctx = null;
  let mix = null;
  let sfx = null;
  let music = null;
  let ambience = null;
  let timer = 0;

  let muted = false;
  let musicOn = true;
  let paused = false;
  let nightMode = false;
  let lastNight = -1;
  let duckUntil = 0; // music ducked under the fanfare until this audio time
  let coinStreak = 0;
  let lastCoin = -10;
  let lastGreet = -10;
  let lastChime = -10;

  // ---- lifecycle ----------------------------------------------------------------
  function init() {
    if (ctx || !AC) return;
    try {
      ctx = new AC({ latencyHint: "interactive" });
      mix = createMixer(ctx);
      sfx = createSfx(ctx, mix);
      music = createMusic(ctx, mix);
      ambience = createAmbience(ctx, mix);
    } catch (err) {
      console.warn("[audio] Web Audio unavailable, running silent:", err);
      ctx = null;
      return;
    }
    mix.master.gain.value = muted ? 0 : MASTER_VOLUME;
    const t = ctx.currentTime + 0.1;
    music.start(t);
    ambience.start(t);
    ambience.setNight(lastNight < 0 ? 0 : lastNight);
    applyMusicLevel(2.5); // gentle fade-in
    glideGain(ctx, mix.ambience, levelAmbience(), 1.5);
    timer = setInterval(tick, TICK_MS);
    resume();
    if (typeof document !== "undefined" && document.addEventListener) {
      document.addEventListener("visibilitychange", onVisibility);
    }
  }

  /** Resume now, and again on the next user gesture if the browser still blocks audio. */
  function resume() {
    if (!ctx || ctx.state === "running") return;
    ctx.resume?.().catch(() => {});
    if (typeof window === "undefined" || !window.addEventListener) return;
    const unlock = () => {
      if (!ctx) return;
      ctx.resume?.().catch(() => {});
      if (ctx.state === "running") {
        for (const type of ["pointerdown", "keydown", "touchend"]) window.removeEventListener(type, unlock, true);
      }
    };
    for (const type of ["pointerdown", "keydown", "touchend"]) window.addEventListener(type, unlock, true);
  }

  function onVisibility() {
    if (!ctx) return;
    if (document.visibilityState === "hidden") ctx.suspend?.().catch(() => {});
    else ctx.resume?.().catch(() => {});
  }

  function tick() {
    if (!ctx || ctx.state !== "running") return;
    const until = ctx.currentTime + LOOKAHEAD;
    // While the music is switched off the sequencer keeps time silently.
    music.scheduleUntil(until, !musicOn && !fading());
    ambience.scheduleUntil(until);
  }

  // ---- levels -----------------------------------------------------------------------
  let musicOffAt = -10;
  const fading = () => ctx && ctx.currentTime - musicOffAt < 1.2;
  const levelMusic = () => (musicOn ? MUSIC_VOLUME * (paused ? 0.35 : 1) * (ctx && ctx.currentTime < duckUntil ? 0.35 : 1) : 0);
  const levelAmbience = () => AMBIENCE_VOLUME * (paused ? 0.35 : 1);

  function applyMusicLevel(tau = 0.25) {
    if (!ctx) return;
    const v = levelMusic();
    glideGain(ctx, mix.music, v, tau);
    glideGain(ctx, mix.verbGate, v, tau);
  }

  function setMuted(m) {
    muted = !!m;
    if (!ctx) return;
    glideGain(ctx, mix.master, muted ? 0 : MASTER_VOLUME, 0.06);
    if (!muted) sfx.click(ctx.currentTime + 0.12);
  }

  function setMusicOn(on) {
    musicOn = !!on;
    if (!ctx) return;
    if (!musicOn) musicOffAt = ctx.currentTime;
    applyMusicLevel(0.35);
    sfx.click();
  }

  // ---- events --------------------------------------------------------------------------
  const on = (name, fn) => events?.on?.(name, (payload) => fn(payload ?? {}));
  const ready = () => !!ctx;

  on("game:start", init);
  on("player:footstep", ({ run }) => ready() && sfx.footstep(!!run));
  on("player:jump", ({ double }) => ready() && (double ? sfx.doubleJump() : sfx.jump()));
  on("player:land", ({ impact }) => ready() && sfx.land(Number(impact)));
  on("coin:collected", () => {
    if (!ready()) return;
    const t = ctx.currentTime;
    coinStreak = t - lastCoin < 1.4 ? Math.min(coinStreak + 1, 4) : 0;
    lastCoin = t;
    sfx.coin(coinStreak);
  });
  on("coin:all", () => {
    if (!ready()) return;
    const t = ctx.currentTime + 0.32; // let the last "ba-ding" ring first
    sfx.fanfare(t);
    duckUntil = t + 2.2;
    applyMusicLevel(0.15);
    setTimeout(() => applyMusicLevel(1.2), 2600);
  });
  on("npc:greet", ({ name, text }) => {
    if (!ready() || ctx.currentTime - lastGreet < 0.6) return;
    lastGreet = ctx.currentTime;
    sfx.babble(String(name ?? ""), String(text ?? ""));
  });
  on("zone:enter", () => {
    if (!ready() || ctx.currentTime - lastChime < 5) return;
    lastChime = ctx.currentTime;
    sfx.chime();
  });
  on("hud:slotSelected", ({ index }) => ready() && sfx.select(Number(index) || 0));
  on("hud:useItem", () => ready() && sfx.use());
  on("game:pause", ({ paused: p }) => {
    if (ready()) sfx.click();
    setPaused(!!p);
  });
  on("settings:mute", ({ muted: m }) => setMuted(m));
  on("settings:music", ({ on: o }) => setMusicOn(o));
  for (const name of ["settings:quality", "settings:daynight", "camera:reset"]) on(name, () => ready() && sfx.click());

  function setPaused(p) {
    if (p === paused) return;
    paused = p;
    if (!ctx) return;
    applyMusicLevel(0.3);
    glideGain(ctx, mix.ambience, levelAmbience(), 0.3);
  }

  // ---- per frame (cheap: compares state, schedules nothing) --------------------------------
  function update(dt, state) {
    if (!ctx) return;
    if (state && typeof state.paused === "boolean") setPaused(state.paused);
    const n = Number(state?.nightFactor);
    if (!Number.isFinite(n)) return;
    const night = Math.min(Math.max(n, 0), 1);
    if (Math.abs(night - lastNight) > 0.02) {
      lastNight = night;
      ambience.setNight(night);
    }
    // Hysteresis so dusk doesn't flip the arrangement back and forth.
    if (!nightMode && night > 0.6) nightMode = true;
    else if (nightMode && night < 0.5) nightMode = false;
    if (nightMode !== music.night) music.setNight(nightMode);
  }

  return {
    update,
    get muted() {
      return muted;
    },
    set muted(v) {
      setMuted(v);
    },
    get musicOn() {
      return musicOn;
    },
    set musicOn(v) {
      setMusicOn(v);
    },
    /** Stop scheduling and close the context (not needed by the game; handy for previews). */
    dispose() {
      clearInterval(timer);
      if (typeof document !== "undefined") document.removeEventListener?.("visibilitychange", onVisibility);
      ctx?.close?.().catch(() => {});
      ctx = null;
    },
  };
}

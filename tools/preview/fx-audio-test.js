// Offline audio self-test (tools/preview/fx.html?audio=1).
// Renders every SFX, the music (day + night arrangement) and the ambience with
// an OfflineAudioContext through the real mixer, then logs peak / RMS levels so
// a headless run (tools/shot.sh) can confirm: non-silent, not clipping, no NaN,
// and envelopes that end in silence (no clicks).
import { createMixer, LEVELS } from "/src/game/audio/mixer.js";
import { createSfx } from "/src/game/audio/sfx.js";
import { createMusic } from "/src/game/audio/music.js";
import { createAmbience } from "/src/game/audio/ambience.js";

const SR = 44100;
const db = (v) => (v > 0 ? (20 * Math.log10(v)).toFixed(1) : "-inf");

async function render(seconds, setup) {
  const ctx = new OfflineAudioContext(2, Math.ceil(SR * seconds), SR);
  const mix = createMixer(ctx);
  setup(ctx, mix);
  const buf = await settle(ctx.startRendering());
  return analyze(buf);
}

/**
 * Await a promise that is fulfilled by another thread. Headless Chrome's virtual
 * clock (tools/shot.sh) jumps ahead whenever the page looks idle and would take
 * the screenshot mid-test, so we keep the main thread busy in short real-time
 * slices (virtual time does not advance during synchronous work) and yield
 * between them so the completion can be delivered.
 */
async function settle(promise) {
  let done = false;
  let value;
  let error;
  promise.then(
    (v) => ((done = true), (value = v)),
    (e) => ((done = true), (error = e)),
  );
  while (!done) {
    let x = 0;
    for (let i = 0; i < 2e7; i++) x += i & 1; // ~10-20 ms of real time
    globalThis.__spin = x;
    await new Promise((r) => setTimeout(r, 0));
  }
  if (error) throw error;
  return value;
}

function analyze(buf) {
  const chans = [buf.getChannelData(0), buf.getChannelData(1)];
  const n = chans[0].length;
  const win = Math.floor(SR * 0.05);
  let peak = 0;
  let sum = 0;
  let nan = 0;
  let clip = 0;
  let loudest = 0;
  let winSum = 0;
  for (let i = 0; i < n; i++) {
    let s2 = 0;
    for (const d of chans) {
      const v = d[i];
      if (!Number.isFinite(v)) {
        nan++;
        continue;
      }
      const a = Math.abs(v);
      if (a > peak) peak = a;
      if (a >= 0.999) clip++;
      s2 += v * v;
    }
    sum += s2 / 2;
    winSum += s2 / 2;
    if (i % win === win - 1) {
      loudest = Math.max(loudest, Math.sqrt(winSum / win));
      winSum = 0;
    }
  }
  let tail = 0;
  for (const d of chans) for (let i = n - Math.floor(SR * 0.02); i < n; i++) tail = Math.max(tail, Math.abs(d[i]));
  return { peak, rms: Math.sqrt(sum / n), loudest, tail, nan, clip };
}

function report(name, r, { minLoud = -40, maxPeak = -1, checkTail = true } = {}) {
  const problems = [];
  if (r.nan) problems.push(`${r.nan} NaN samples`);
  if (r.clip) problems.push(`${r.clip} clipped samples`);
  if (20 * Math.log10(r.loudest || 1e-9) < minLoud) problems.push("too quiet / silent");
  if (20 * Math.log10(r.peak || 1e-9) > maxPeak) problems.push("too hot");
  if (checkTail && r.tail > 0.002) problems.push(`does not end silent (tail ${db(r.tail)} dBFS)`);
  console.log(
    `[audio test] ${name.padEnd(16)} peak ${db(r.peak).padStart(6)} dBFS | loudest50ms ${db(r.loudest).padStart(6)} | rms ${db(r.rms).padStart(6)} | tail ${db(r.tail).padStart(6)} | ${problems.length ? "PROBLEM: " + problems.join(", ") : "ok"}`,
  );
  return problems.length === 0;
}

export async function runAudioSelfTest() {
  if (typeof OfflineAudioContext === "undefined") {
    console.log("[audio test] OfflineAudioContext unavailable — skipped");
    return;
  }
  const t0 = performance.now();
  let ok = true;

  const sfxCases = [
    ["footstep walk", 0.5, (s) => s.footstep(false, 0.05)],
    ["footstep run", 0.5, (s) => s.footstep(true, 0.05)],
    ["jump", 0.8, (s) => s.jump(0.05)],
    ["double jump", 1.2, (s) => s.doubleJump(0.05)],
    ["land soft", 0.6, (s) => s.land(4, 0.05)],
    ["land hard", 0.6, (s) => s.land(14, 0.05)],
    ["coin", 1.6, (s) => s.coin(0, 0.05)],
    ["coin streak x4", 1.6, (s) => s.coin(4, 0.05)],
    ["fanfare", 3.2, (s) => s.fanfare(0.05)],
    ["hotbar select", 0.4, (s) => s.select(3, 0.05)],
    ["item use", 0.7, (s) => s.use(0.05)],
    ["npc babble", 1.4, (s) => s.babble("Mabel", "Hello there, Pip! Lovely day?", 0.05)],
    ["menu click", 0.3, (s) => s.click(0.05)],
    ["zone chime", 1.2, (s) => s.chime(0.05)],
  ];
  for (const [name, secs, play] of sfxCases) {
    const r = await render(secs, (ctx, mix) => play(createSfx(ctx, mix)));
    // Footsteps are deliberately soft ticks; everything else should clearly read.
    ok = report(name, r, { minLoud: name.startsWith("footstep") ? -42 : -38, maxPeak: -2 }) && ok;
  }

  // Music at the in-game level.
  const musicLevel = LEVELS.music;
  const playMusic = (night, secs) => (ctx, mix) => {
    mix.music.gain.value = musicLevel;
    mix.verbGate.gain.value = musicLevel;
    const m = createMusic(ctx, mix);
    if (night) m.setNight(true, 0.01);
    m.start(0.05);
    m.scheduleUntil(secs - 4); // leave room for the pad/reverb tails to finish
  };
  ok = report("music day 20s", await render(23, playMusic(false, 23)), { minLoud: -40, maxPeak: -3, checkTail: true }) && ok;
  ok = report("music night 14s", await render(18, playMusic(true, 18)), { minLoud: -44, maxPeak: -3, checkTail: true }) && ok;

  // Stems: one part at a time (pass 3 = B section has every part playing).
  const parts = ["lead", "arp", "bass", "pad", "perc"];
  for (const solo of parts) {
    const r = await render(12, (ctx, mix) => {
      mix.music.gain.value = musicLevel;
      mix.verbGate.gain.value = 0; // dry stems
      for (const p of parts) mix[p].gain.value = p === solo ? 1 : 0;
      const m = createMusic(ctx, mix);
      m.start(0.05);
      m.skipTo(16 * 16); // jump to the B section (bar 17) where every part plays
      m.scheduleUntil(9);
    });
    report(`  stem ${solo}`, r, { minLoud: -70, maxPeak: 0, checkTail: false });
  }

  const playAmb = (night) => (ctx, mix) => {
    mix.ambience.gain.value = LEVELS.ambience;
    const a = createAmbience(ctx, mix);
    a.setNight(night);
    a.start(0);
    a.scheduleUntil(12);
  };
  ok = report("ambience day", await render(14, playAmb(0)), { minLoud: -50, maxPeak: -10, checkTail: false }) && ok;
  ok = report("ambience night", await render(14, playAmb(1)), { minLoud: -55, maxPeak: -10, checkTail: false }) && ok;

  // Everything at once: music + a burst of gameplay sounds (checks headroom).
  const busyMix = await render(6, (ctx, mix) => {
    playMusic(false, 6)(ctx, mix);
    const s = createSfx(ctx, mix);
    for (let i = 0; i < 12; i++) s.footstep(true, 0.2 + i * 0.3);
    s.jump(0.6);
    s.doubleJump(0.9);
    s.land(12, 1.6);
    [1.9, 2.2, 2.5, 2.8].forEach((t, i) => s.coin(i, t));
    s.fanfare(3.1);
  });
  ok = report("busy mix", busyMix, { minLoud: -30, maxPeak: -0.5, checkTail: false }) && ok;

  console.log(`[audio test] ${ok ? "ALL OK" : "SOME PROBLEMS"} (${((performance.now() - t0) / 1000).toFixed(1)}s)`);
}

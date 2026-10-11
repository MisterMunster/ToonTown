// Synthesized sound effects. Each function schedules a handful of short-lived
// nodes at time `t` (defaults to "now") on the mixer's buses. Pitches are drawn
// from F major so SFX sit nicely on top of the music.
import { tone, noiseHit, noteHz, semis } from "./mixer.js";

const PENTA = [0, 2, 4, 7, 9]; // major pentatonic steps (semitones)
const rand = (a, b) => a + Math.random() * (b - a);
const clamp01 = (x) => Math.min(Math.max(Number.isFinite(x) ? x : 0, 0), 1);

/** Small stable string hash (NPC voice pitch). */
function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}

// Vowel formants (F1, F2) for the babble voice.
const VOWELS = [
  [800, 1250], // a
  [500, 1850], // e
  [330, 2300], // i
  [520, 950], // o
  [360, 800], // u
];

/**
 * @param {BaseAudioContext} ctx
 * @param {ReturnType<import("./mixer.js").createMixer>} mix
 */
export function createSfx(ctx, mix) {
  const now = (t) => (Number.isFinite(t) ? t : ctx.currentTime + 0.005);
  let foot = 0;

  /** Short filtered-noise tick, alternating feet; softer when walking. */
  function footstep(run, t) {
    t = now(t);
    foot ^= 1;
    const dest = mix.feet[foot];
    const pitch = (foot ? 1.1 : 0.92) * rand(0.9, 1.1);
    noiseHit(ctx, mix, dest, {
      t,
      dur: run ? 0.075 : 0.06,
      peak: (run ? 0.3 : 0.24) * rand(0.85, 1.1),
      attack: 0.002,
      filter: { type: "bandpass", freq: (run ? 1500 : 1150) * pitch, q: 1.3 },
    });
    // A soft low "body" so steps feel grounded, not just clicky.
    tone(ctx, dest, { t, dur: 0.06, peak: run ? 0.12 : 0.08, freq: 130 * pitch, freqEnd: 70, attack: 0.003 });
  }

  /** Cute rising "boing" with a springy vibrato. */
  function jump(t) {
    t = now(t);
    const lfo = ctx.createOscillator();
    const lfoAmt = ctx.createGain();
    lfo.frequency.value = 22;
    lfoAmt.gain.value = 16;
    lfo.connect(lfoAmt);
    const main = tone(ctx, mix.sfx, { t, dur: 0.24, peak: 0.24, freq: 230, freqEnd: 640, glide: 0.16, type: "triangle", attack: 0.006 });
    lfoAmt.connect(main.osc.frequency);
    lfo.start(t);
    lfo.stop(t + 0.28);
    lfo.onended = () => lfoAmt.disconnect();
    tone(ctx, mix.sfx, { t, dur: 0.16, peak: 0.045, freq: 460, freqEnd: 1280, glide: 0.16, attack: 0.006 });
  }

  /** Sparkly upward pentatonic arpeggio + airy whoosh. */
  function doubleJump(t) {
    t = now(t);
    const notes = ["C6", "D6", "F6", "A6", "C7"];
    notes.forEach((n, i) => {
      const f = noteHz(n);
      const ti = t + i * 0.038;
      tone(ctx, mix.sfxFx, { t: ti, dur: 0.22, peak: 0.085, freq: f, attack: 0.003 });
      tone(ctx, mix.sfxFx, { t: ti, dur: 0.08, peak: 0.025, freq: f * 2.0, attack: 0.002 });
    });
    noiseHit(ctx, mix, mix.sfx, {
      t,
      dur: 0.3,
      peak: 0.075,
      attack: 0.06,
      filter: { type: "bandpass", freq: 500, freqEnd: 3800, q: 0.9 },
    });
  }

  /** Soft thump scaled by impact speed (m/s). */
  function land(impact, t) {
    t = now(t);
    const imp = Number.isFinite(impact) ? impact : 0;
    if (imp < 1.5) return;
    const k = clamp01((imp - 2) / 12);
    tone(ctx, mix.sfx, { t, dur: 0.18, peak: 0.13 + 0.3 * k, freq: 150, freqEnd: 48, glide: 0.13, attack: 0.003 });
    noiseHit(ctx, mix, mix.sfx, {
      t,
      dur: 0.07 + 0.09 * k,
      peak: 0.035 + 0.12 * k,
      attack: 0.002,
      filter: { type: "lowpass", freq: 650 + 500 * k, q: 0.7 },
    });
  }

  /** Bright two-note "ba-ding" (C6 -> F6), climbing a pentatonic step per quick pickup. */
  function coin(streak = 0, t) {
    t = now(t);
    const tr = PENTA[Math.min(Math.max(streak | 0, 0), PENTA.length - 1)];
    const f1 = noteHz("C6") * semis(tr);
    const f2 = noteHz("F6") * semis(tr);
    tone(ctx, mix.sfxFx, { t, dur: 0.085, peak: 0.13, freq: f1, wave: mix.waves.bright, attack: 0.002 });
    tone(ctx, mix.sfxFx, { t: t + 0.075, dur: 0.5, peak: 0.16, freq: f2, wave: mix.waves.bright, attack: 0.003 });
    tone(ctx, mix.sfxFx, { t: t + 0.075, dur: 0.32, peak: 0.04, freq: f2 * 2, attack: 0.003 });
  }

  /** "All coins" fanfare: bright major arpeggio, then a warm sustained F-major chord. */
  function fanfare(t) {
    t = now(t);
    const brass = (f, ti, dur, peak) => {
      const filt = ctx.createBiquadFilter();
      filt.type = "lowpass";
      filt.Q.value = 0.8;
      filt.frequency.setValueAtTime(900, ti);
      filt.frequency.exponentialRampToValueAtTime(4200, ti + 0.05);
      filt.frequency.exponentialRampToValueAtTime(1600, ti + dur);
      filt.connect(mix.sfxFx);
      for (const det of [-7, 7]) {
        const v = tone(ctx, filt, { t: ti, dur, peak, freq: f, type: "sawtooth", attack: 0.025, detune: det });
        v.osc.addEventListener("ended", () => filt.disconnect(), { once: true });
      }
    };
    ["F5", "A5", "C6"].forEach((n, i) => brass(noteHz(n), t + i * 0.11, 0.24, 0.05));
    const tc = t + 0.34;
    ["F4", "A4", "C5", "F5"].forEach((n) => brass(noteHz(n), tc, 1.25, 0.04));
    brass(noteHz("A5"), tc, 1.25, 0.035);
    tone(ctx, mix.sfx, { t: tc, dur: 1.1, peak: 0.12, freq: noteHz("F2"), type: "triangle", attack: 0.02 });
    // Shimmer on top.
    ["C7", "A6", "F6", "C7", "F7"].forEach((n, i) =>
      tone(ctx, mix.sfxFx, { t: tc + 0.05 + i * 0.07, dur: 0.35, peak: 0.035, freq: noteHz(n), attack: 0.002 }),
    );
  }

  /** Soft wooden tick; pitch follows the hotbar slot. */
  function select(index = 0, t) {
    t = now(t);
    const i = Math.abs(index | 0);
    const f = noteHz("F5") * semis(PENTA[i % 5] + 12 * Math.floor(i / 5)); // F major pentatonic
    tone(ctx, mix.sfx, { t, dur: 0.07, peak: 0.12, freq: f, attack: 0.001 });
    tone(ctx, mix.sfx, { t, dur: 0.03, peak: 0.035, freq: f * 2.76, attack: 0.001 });
    noiseHit(ctx, mix, mix.sfx, { t, dur: 0.018, peak: 0.04, filter: { type: "bandpass", freq: 3200, q: 1.5 } });
  }

  /** Playful "boop-bloop". */
  function use(t) {
    t = now(t);
    tone(ctx, mix.sfx, { t, dur: 0.12, peak: 0.17, freq: 540, freqEnd: 330, glide: 0.09, attack: 0.004 });
    const b = tone(ctx, mix.sfx, { t: t + 0.12, dur: 0.18, peak: 0.16, freq: 330, freqEnd: 700, glide: 0.12, attack: 0.004 });
    const lfo = ctx.createOscillator();
    const amt = ctx.createGain();
    lfo.frequency.value = 13;
    amt.gain.value = 22;
    lfo.connect(amt);
    amt.connect(b.osc.frequency);
    lfo.start(t + 0.12);
    lfo.stop(t + 0.33);
    lfo.onended = () => amt.disconnect();
  }

  /** Animal-Crossing-style babble: 4-8 random-pitched formant syllables. */
  function babble(name = "", text = "", t) {
    t = now(t);
    const seed = hashString(String(name));
    const base = 190 + seed * 150; // each NPC gets a stable voice pitch
    const str = String(text);
    const count = Math.min(8, Math.max(4, Math.round(4 + str.length / 12)));
    const rising = /[?!]\s*$/.test(str);

    const osc = ctx.createOscillator();
    osc.setPeriodicWave(mix.waves.reed);
    const f1 = ctx.createBiquadFilter();
    const f2 = ctx.createBiquadFilter();
    f1.type = f2.type = "bandpass";
    f1.Q.value = 4;
    f2.Q.value = 6;
    const amp = ctx.createGain();
    amp.gain.value = 0;
    const g2 = ctx.createGain();
    g2.gain.value = 0.6;
    osc.connect(f1);
    osc.connect(f2);
    f1.connect(amp);
    f2.connect(g2);
    g2.connect(amp);
    const out = mix.panner(rand(-0.25, 0.25), mix.sfx);
    amp.connect(out);

    osc.frequency.setValueAtTime(base, t);
    let ts = t;
    for (let i = 0; i < count; i++) {
      const dur = rand(0.065, 0.1);
      const last = i === count - 1;
      let p = base * semis(Math.round(rand(-3, 5)));
      if (last) p = base * semis(rising ? 7 : -2);
      const [F1, F2] = VOWELS[Math.floor(Math.random() * VOWELS.length)];
      osc.frequency.setTargetAtTime(p, ts, 0.012);
      if (last) osc.frequency.setTargetAtTime(p * (rising ? 1.12 : 0.92), ts + dur * 0.4, 0.03);
      f1.frequency.setTargetAtTime(F1, ts, 0.012);
      f2.frequency.setTargetAtTime(F2, ts, 0.012);
      amp.gain.setValueAtTime(0, ts);
      amp.gain.linearRampToValueAtTime(0.38, ts + 0.012);
      amp.gain.setValueAtTime(0.38, ts + dur - 0.025);
      amp.gain.linearRampToValueAtTime(0, ts + dur);
      ts += dur + rand(0.018, 0.04);
    }
    osc.start(t);
    osc.stop(ts + 0.05);
    osc.onended = () => {
      amp.disconnect();
      out.disconnect();
    };
  }

  /** Gentle UI click. */
  function click(t) {
    t = now(t);
    tone(ctx, mix.sfx, { t, dur: 0.045, peak: 0.11, freq: 1320, attack: 0.001 });
    tone(ctx, mix.sfx, { t, dur: 0.03, peak: 0.05, freq: 2640, attack: 0.001 });
  }

  /** Soft marimba chime (entering a new area). */
  function chime(t) {
    t = now(t);
    ["A5", "C6", "F6"].forEach((n, i) => {
      const f = noteHz(n);
      tone(ctx, mix.sfxFx, { t: t + i * 0.09, dur: 0.5, peak: 0.06, freq: f, attack: 0.003 });
      tone(ctx, mix.sfxFx, { t: t + i * 0.09, dur: 0.08, peak: 0.02, freq: f * 3.95, attack: 0.002 });
    });
  }

  return { footstep, jump, doubleJump, land, coin, fanfare, select, use, babble, click, chime };
}

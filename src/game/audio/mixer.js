// Mixer + shared synth helpers for the procedural audio.
//
// Signal flow (all persistent nodes, created once):
//
//   sfx ─────────────────────────────┐
//   sfxFx ─┬─> sfx                    │
//          ├─> echo send ─> delay ⟲ ─┘ (echo returns into sfx)
//          └─> reverb send ───────────┐
//   music sub-buses (lead, arp, bass,  │
//   pad, perc) ─> music ───────────────┤──> master ─> compressor ─> destination
//   music reverb sends ─> verbGate ────┤
//   ambience (birds, crickets) ────────┘
//   reverb (convolver, procedural IR) ─> reverbReturn ─> master
//
// Every voice is a few short-lived nodes started/stopped at exact times on
// the audio clock; envelopes always ramp to ~0 before a node stops (no clicks).

/** Bus levels (linear gain). Music sits well under the SFX. */
export const LEVELS = {
  master: 0.9,
  music: 0.3,
  ambience: 0.6,
};

/** Semitone offset -> frequency ratio. */
export const semis = (n) => Math.pow(2, n / 12);

const NOTE_INDEX = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
/** "F#4" / "Bb3" / "C6" -> Hz (A4 = 440). */
export function noteHz(name) {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(name);
  if (!m) return 440;
  let n = NOTE_INDEX[m[1]] + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0);
  n += (Number(m[3]) + 1) * 12; // MIDI number
  return 440 * Math.pow(2, (n - 69) / 12);
}

const clampPeak = (v) => (Number.isFinite(v) && v > 0.0001 ? v : 0.0001);

/**
 * Percussive envelope on a gain AudioParam: 0 -> peak over `attack`, then an
 * exponential fall to ~-80 dB at `t + dur`.
 */
export function pluckEnv(param, t, peak, attack, dur) {
  param.setValueAtTime(0, t);
  param.linearRampToValueAtTime(clampPeak(peak), t + attack);
  param.exponentialRampToValueAtTime(0.0001, t + Math.max(dur, attack + 0.01));
}

/**
 * One enveloped oscillator voice.
 * @param {BaseAudioContext} ctx
 * @param {AudioNode} dest
 * @param {{ t:number, dur:number, peak:number, freq:number, attack?:number, type?:OscillatorType,
 *           wave?:PeriodicWave, freqEnd?:number, glide?:number, detune?:number }} o
 */
export function tone(ctx, dest, o) {
  const { t, dur, peak, freq, attack = 0.004, type = "sine", wave, freqEnd, glide, detune = 0 } = o;
  const osc = ctx.createOscillator();
  if (wave) osc.setPeriodicWave(wave);
  else osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (freqEnd) osc.frequency.exponentialRampToValueAtTime(freqEnd, t + (glide ?? dur));
  if (detune) osc.detune.setValueAtTime(detune, t);
  const g = ctx.createGain();
  g.gain.value = 0;
  pluckEnv(g.gain, t, peak, attack, dur);
  osc.connect(g);
  g.connect(dest);
  osc.start(t);
  osc.stop(t + dur + 0.03);
  osc.onended = () => g.disconnect();
  return { osc, gain: g };
}

/**
 * A burst of filtered white noise (footsteps, shakers, whooshes).
 * `filter` = { type, freq, q, freqEnd? } or null to use `dest` directly.
 */
export function noiseHit(ctx, mix, dest, o) {
  const { t, dur, peak, attack = 0.002, filter = null } = o;
  const src = ctx.createBufferSource();
  src.buffer = mix.noise;
  const g = ctx.createGain();
  g.gain.value = 0;
  pluckEnv(g.gain, t, peak, attack, dur);
  let head = g;
  if (filter) {
    const f = ctx.createBiquadFilter();
    f.type = filter.type;
    f.frequency.setValueAtTime(filter.freq, t);
    if (filter.freqEnd) f.frequency.exponentialRampToValueAtTime(filter.freqEnd, t + dur);
    f.Q.value = filter.q ?? 1;
    f.connect(g);
    head = f;
  }
  src.connect(head);
  g.connect(dest);
  const offset = Math.random() * Math.max(0, mix.noise.duration - dur - 0.1);
  src.start(t, offset);
  src.stop(t + dur + 0.03);
  src.onended = () => g.disconnect();
  return g;
}

/** Ramp a persistent gain smoothly toward `value` (time constant `tau` seconds). */
export function glideGain(ctx, node, value, tau = 0.08) {
  const v = Number.isFinite(value) ? Math.max(0, value) : 0;
  node.gain.setTargetAtTime(v, ctx.currentTime, Math.max(0.005, tau));
}

/**
 * Builds the persistent mixing graph on any BaseAudioContext (realtime or offline).
 * @param {BaseAudioContext} ctx
 * @param {AudioNode} [destination]
 */
export function createMixer(ctx, destination = ctx.destination) {
  const gain = (v, to) => {
    const g = ctx.createGain();
    g.gain.value = v;
    if (to) g.connect(to);
    return g;
  };
  const panner = (pan, to) => {
    if (typeof ctx.createStereoPanner !== "function") return gain(1, to);
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    p.connect(to);
    return p;
  };

  // Master chain: gentle glue compression keeps stacked SFX from clipping.
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.knee.value = 10;
  comp.ratio.value = 3.5;
  comp.attack.value = 0.004;
  comp.release.value = 0.22;
  comp.connect(destination);
  const master = gain(LEVELS.master, comp);

  // Shared reverb (procedural impulse response).
  const reverb = ctx.createConvolver();
  reverb.buffer = makeImpulse(ctx, 1.7);
  const reverbReturn = gain(0.32, master);
  reverb.connect(reverbReturn);

  // SFX buses: dry, and "fx" (dry + echo + reverb sends) for sparkly sounds.
  const sfx = gain(1, master);
  const sfxFx = gain(1, sfx);
  const echoSend = gain(0.32, null);
  sfxFx.connect(echoSend);
  const delay = ctx.createDelay(1);
  delay.delayTime.value = 0.156; // a 16th note at 96 BPM
  const feedback = gain(0.3, null);
  const echoTone = ctx.createBiquadFilter();
  echoTone.type = "lowpass";
  echoTone.frequency.value = 2600;
  echoSend.connect(delay);
  delay.connect(echoTone);
  echoTone.connect(feedback);
  feedback.connect(delay);
  echoTone.connect(gain(0.55, sfx));
  sfxFx.connect(gain(0.35, reverb));

  // Music: sub-buses so the night arrangement can crossfade parts.
  const music = gain(0, master); // faded in when music starts
  const verbGate = gain(0, reverb); // music reverb sends follow the music level
  const leadTone = ctx.createBiquadFilter();
  leadTone.type = "lowpass";
  leadTone.frequency.value = 5200;
  leadTone.Q.value = 0.5;
  leadTone.connect(music);
  const lead = gain(1, leadTone);
  lead.connect(gain(0.45, verbGate));
  const leadWeak = gain(1, lead); // off-beat melody notes (thinned at night)
  const arp = gain(1, leadTone);
  const bass = gain(1, music);
  const bassWeak = gain(1, bass);
  const padTone = ctx.createBiquadFilter();
  padTone.type = "lowpass";
  padTone.frequency.value = 1500;
  padTone.connect(music);
  const pad = gain(1, padTone);
  pad.connect(gain(0.6, verbGate));
  const perc = gain(1, music);
  const shakerTone = ctx.createBiquadFilter();
  shakerTone.type = "highpass";
  shakerTone.frequency.value = 6500;
  shakerTone.connect(perc);
  const snapTone = ctx.createBiquadFilter();
  snapTone.type = "bandpass";
  snapTone.frequency.value = 1900;
  snapTone.Q.value = 1.1;
  snapTone.connect(perc);

  // Ambience.
  const ambience = gain(0, master);
  const birds = gain(1, ambience);
  birds.connect(gain(0.25, reverb));
  const crickets = gain(0, ambience);

  // Footstep panners (left / right foot), plus a few spare pans for ambience.
  const feet = [panner(-0.14, sfx), panner(0.14, sfx)];

  return {
    ctx,
    master,
    comp,
    sfx,
    sfxFx,
    reverb,
    music,
    verbGate,
    lead,
    leadWeak,
    leadTone,
    arp,
    bass,
    bassWeak,
    pad,
    padTone,
    perc,
    shakerTone,
    snapTone,
    ambience,
    birds,
    crickets,
    feet,
    panner,
    noise: makeNoise(ctx, 2),
    waves: makeWaves(ctx),
  };
}

function makeNoise(ctx, seconds) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

/** Stereo noise with an exponential, progressively darker decay: a soft "room". */
function makeImpulse(ctx, seconds) {
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * seconds);
  const buf = ctx.createBuffer(2, len, sr);
  const pre = Math.floor(sr * 0.012);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let lp = 0;
    for (let i = pre; i < len; i++) {
      const x = (i - pre) / (len - pre);
      const k = 0.55 - 0.45 * x; // one-pole lowpass gets darker over the tail
      lp += k * (Math.random() * 2 - 1 - lp);
      d[i] = lp * Math.exp(-5.2 * x) * 0.9;
    }
  }
  return buf;
}

/** Custom oscillator tables (normalized by Web Audio). */
function makeWaves(ctx) {
  const wave = (amps) => {
    const real = new Float32Array(amps.length + 1);
    const imag = new Float32Array(amps.length + 1);
    amps.forEach((a, i) => (imag[i + 1] = a));
    return ctx.createPeriodicWave(real, imag);
  };
  return {
    // Soft, rounded "warm" tone for pads: odd-ish harmonics rolling off fast.
    warm: wave([1, 0.32, 0.18, 0.08, 0.05, 0.025]),
    // Bright but band-limited bell/brass tone for coins and fanfares.
    bright: wave([1, 0.55, 0.38, 0.22, 0.16, 0.1, 0.06, 0.04]),
    // Hollow reed-like tone for the NPC babble.
    reed: wave([1, 0.2, 0.6, 0.12, 0.35, 0.08, 0.2, 0.05, 0.1]),
  };
}

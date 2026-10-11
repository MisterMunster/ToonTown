// Procedural background music: a gentle, composed loop in F major at 96 BPM.
//
// Form: A A' B A'' (8 bars each, ~80 s per loop). A = I-vi-IV-V style
// (F Dm Bb C F Dm Gm|C7 F), B = Bb C Am Dm Bb C Gm C7. Instruments: marimba
// lead playing the written melody, kalimba Alberti arpeggios (from the 2nd
// pass), soft triangle bass on roots/fifths, warm detuned pad, shaker 16ths and
// a light snap on 2 & 4. At night the arrangement crossfades to a softer
// version (no percussion or arpeggio, off-beat melody notes thinned, darker lead).
import { tone, noiseHit, noteHz, semis, glideGain } from "./mixer.js";

export const BPM = 96;
export const STEP = 60 / BPM / 4; // one 16th note in seconds

const CHORDS = {
  F: { root: "F2", pad: ["F3", "A3", "C4"], arp: ["F4", "A4", "C5"] },
  Dm: { root: "D2", pad: ["F3", "A3", "D4"], arp: ["D4", "F4", "A4"] },
  Bb: { root: "Bb1", pad: ["F3", "Bb3", "D4"], arp: ["D4", "F4", "Bb4"] },
  C: { root: "C2", pad: ["E3", "G3", "C4"], arp: ["E4", "G4", "C5"] },
  C7: { root: "C2", pad: ["E3", "Bb3", "C4"], arp: ["E4", "G4", "Bb4"] },
  Gm: { root: "G2", pad: ["G3", "Bb3", "D4"], arp: ["D4", "G4", "Bb4"] },
  Am: { root: "A2", pad: ["E3", "A3", "C4"], arp: ["E4", "A4", "C5"] },
};

// Melody: 8 eighth-note slots per bar. Note name = new note, "_" = hold, "." = rest.
const SECTION_A = {
  chords: ["F", "Dm", "Bb", "C", "F", "Dm", ["Gm", "C7"], "F"],
  lead: [
    "F5 _ A5 C6 _ A5 F5 _",
    "D6 _ C6 A5 _ F5 A5 _",
    "Bb5 _ D6 _ C6 Bb5 A5 _",
    "G5 _ _ _ E5 _ C5 _",
    "F5 _ A5 C6 _ A5 F5 _",
    "D6 _ E6 F6 _ E6 D6 _",
    "D6 _ Bb5 G5 _ C6 Bb5 _",
    "A5 _ _ G5 F5 _ _ _",
  ],
};
const SECTION_B = {
  chords: ["Bb", "C", "Am", "Dm", "Bb", "C", "Gm", "C7"],
  lead: [
    "F5 _ Bb5 _ D6 _ _ _",
    "E6 _ D6 _ C6 _ G5 _",
    "A5 _ C6 _ E6 _ _ _",
    "F6 _ E6 D6 _ _ A5 _",
    "Bb5 _ D6 _ F6 _ D6 _",
    "C6 _ E6 _ G6 _ E6 _",
    "D6 _ Bb5 _ G5 _ Bb5 _",
    "C6 _ _ _ G5 _ E5 _",
  ],
};
// Arrangement per pass: the arpeggio joins on the 2nd pass, the snap on the B section.
const SONG = [
  { section: SECTION_A, arp: false, snap: false },
  { section: SECTION_A, arp: true, snap: false },
  { section: SECTION_B, arp: true, snap: true },
  { section: SECTION_A, arp: true, snap: true },
];

const SHAKER_VEL = [0.55, 0.22, 1, 0.3]; // per 16th within a beat: accent on the "and"
const ALBERTI = [0, 2, 1, 2]; // low, high, middle, high

/** Flatten the song into bars with pre-parsed melody events. */
function buildBars() {
  const bars = [];
  for (const pass of SONG) {
    const { chords, lead } = pass.section;
    chords.forEach((c, i) => {
      const halves = Array.isArray(c) ? c.map((n) => CHORDS[n]) : [CHORDS[c], null];
      const tokens = lead[i].trim().split(/\s+/);
      const notes = new Array(8).fill(null);
      tokens.forEach((tok, k) => {
        if (tok === "_" || tok === ".") return;
        let len = 1;
        while (tokens[k + len] === "_") len++;
        notes[k] = { freq: noteHz(tok), len };
      });
      bars.push({ halves, notes, arp: pass.arp, snap: pass.snap });
    });
  }
  return bars;
}

/**
 * @param {BaseAudioContext} ctx
 * @param {ReturnType<import("./mixer.js").createMixer>} mix
 */
export function createMusic(ctx, mix) {
  const bars = buildBars();
  const totalSteps = bars.length * 16;
  let step = 0;
  let nextTime = 0;
  let playing = false;
  let night = false;
  const level = { perc: 1, arp: 1, leadWeak: 1, bassWeak: 1 }; // current bus targets
  let fadeUntil = 0; // keep scheduling fading parts until their crossfade has finished
  const audible = (part) => level[part] > 0.02 || ctx.currentTime < fadeUntil;

  // ---- instruments -----------------------------------------------------------
  function marimba(dest, f, t, vel, len8) {
    const dur = Math.min(1.4, 0.4 + len8 * STEP * 2 * 0.7);
    tone(ctx, dest, { t, dur, peak: 0.24 * vel, freq: f, attack: 0.003 });
    tone(ctx, dest, { t, dur: dur * 0.45, peak: 0.03 * vel, freq: f * 2, attack: 0.004 });
    tone(ctx, dest, { t, dur: 0.06, peak: 0.07 * vel, freq: f * 3.93, attack: 0.002 }); // mallet "knock"
  }

  function kalimba(f, t, vel) {
    tone(ctx, mix.arp, { t, dur: 0.55, peak: 0.08 * vel, freq: f, attack: 0.002 });
    tone(ctx, mix.arp, { t, dur: 0.04, peak: 0.022 * vel, freq: f * 5.4, attack: 0.001 });
  }

  function bassNote(dest, f, t, len) {
    const g = ctx.createGain();
    g.gain.value = 0;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.11, t + 0.012);
    g.gain.setTargetAtTime(0.065, t + 0.012, 0.12);
    g.gain.setTargetAtTime(0, t + len, 0.045);
    g.connect(dest);
    const o1 = ctx.createOscillator();
    o1.type = "triangle";
    o1.frequency.value = f;
    const o2 = ctx.createOscillator();
    o2.frequency.value = f * 2; // octave partial so the bass reads on small speakers
    const o2g = ctx.createGain();
    o2g.gain.value = 0.28;
    o1.connect(g);
    o2.connect(o2g);
    o2g.connect(g);
    const end = t + len + 0.35;
    o1.start(t);
    o2.start(t);
    o1.stop(end);
    o2.stop(end);
    o1.onended = () => {
      g.disconnect();
      o2g.disconnect();
    };
  }

  function padChord(chord, t, len) {
    const g = ctx.createGain();
    g.gain.value = 0;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.015, t + 0.45);
    g.gain.setValueAtTime(0.015, t + Math.max(0.46, len - 0.05));
    g.gain.setTargetAtTime(0, t + len, 0.28);
    g.connect(mix.pad);
    const end = t + len + 1.8;
    const oscs = [];
    for (const n of chord.pad) {
      for (const det of [-7, 6]) {
        const o = ctx.createOscillator();
        o.setPeriodicWave(mix.waves.warm);
        o.frequency.value = noteHz(n);
        o.detune.value = det;
        o.connect(g);
        o.start(t);
        o.stop(end);
        oscs.push(o);
      }
    }
    oscs[0].onended = () => g.disconnect();
  }

  // ---- step sequencer ----------------------------------------------------------
  function playStep(s, t) {
    const bar = bars[Math.floor(s / 16)];
    const i = s % 16;
    const split = !!bar.halves[1];
    const chord = i < 8 || !split ? bar.halves[0] : bar.halves[1];
    const halfLen = 8 * STEP;
    const human = () => 0.88 + Math.random() * 0.12;

    // Pad on every chord change.
    if (i === 0) padChord(bar.halves[0], t, split ? halfLen : halfLen * 2);
    if (i === 8 && split) padChord(chord, t, halfLen);

    // Bass: root on 1 (and 3), fifth pick-ups on the "and" of 2 and 4.
    const root = noteHz(chord.root);
    if (i === 0) bassNote(mix.bass, root, t, 5 * STEP);
    if (audible("bassWeak")) {
      if (i === 6) bassNote(mix.bassWeak, root * semis(7), t, 1.6 * STEP);
      if (i === 8) bassNote(split ? mix.bass : mix.bassWeak, root, t, 5 * STEP);
      if (i === 14) bassNote(mix.bassWeak, root * semis(7), t, 1.6 * STEP);
    } else if (i === 8 && split) {
      bassNote(mix.bass, root, t, 5 * STEP);
    }

    // Melody (eighth-note grid): on-beat notes are "strong", off-beats "weak".
    if (i % 2 === 0) {
      const k = i / 2;
      const n = bar.notes[k];
      if (n) {
        const weak = k % 2 === 1;
        if (!weak || audible("leadWeak")) marimba(weak ? mix.leadWeak : mix.lead, n.freq, t, (weak ? 0.85 : 1) * human(), n.len);
      }
      if (bar.arp && audible("arp")) {
        const f = noteHz(chord.arp[ALBERTI[k % 4]]);
        kalimba(f, t + STEP * 0.04, (k % 2 === 0 ? 1 : 0.75) * human());
      }
    }

    // Percussion.
    if (audible("perc")) {
      const v = SHAKER_VEL[i % 4] * human();
      noiseHit(ctx, mix, mix.shakerTone, { t, dur: v > 0.8 ? 0.06 : 0.04, peak: 0.14 * v, attack: 0.004 });
      if (bar.snap && (i === 4 || i === 12)) {
        noiseHit(ctx, mix, mix.snapTone, { t, dur: 0.09, peak: 0.13, attack: 0.001 });
      }
    }
  }

  return {
    /** Begin the song at audio time t (restarts from the top). */
    start(t) {
      step = 0;
      nextTime = t;
      playing = true;
    },
    stop() {
      playing = false;
    },
    /** Jump the sequencer to a given 16th step (previews / tests). */
    skipTo(s) {
      step = ((Math.floor(s) % totalSteps) + totalSteps) % totalSteps;
    },
    get playing() {
      return playing;
    },
    /**
     * Schedule every 16th whose start time is before `until`. When `silent`
     * the clock still advances (stays in time) but no notes are created.
     */
    scheduleUntil(until, silent = false) {
      if (!playing) return;
      // Fell far behind (tab throttled / context resumed): jump to now.
      if (nextTime < ctx.currentTime - 0.25) nextTime = ctx.currentTime + 0.05;
      let guard = 0;
      while (nextTime < until && guard++ < 256) {
        if (!silent) playStep(step, nextTime);
        step = (step + 1) % totalSteps;
        nextTime += STEP;
      }
    },
    /** Crossfade between the day and the softer night arrangement. */
    setNight(on, tau = 2.5) {
      if (on === night) return;
      night = on;
      fadeUntil = ctx.currentTime + tau * 3;
      level.perc = on ? 0 : 1;
      level.arp = on ? 0 : 1;
      level.leadWeak = on ? 0.3 : 1;
      level.bassWeak = on ? 0 : 1;
      glideGain(ctx, mix.perc, level.perc, tau);
      glideGain(ctx, mix.arp, level.arp, tau);
      glideGain(ctx, mix.leadWeak, level.leadWeak, tau);
      glideGain(ctx, mix.bassWeak, level.bassWeak, tau);
      glideGain(ctx, mix.lead, on ? 0.85 : 1, tau);
      glideGain(ctx, mix.pad, on ? 1.6 : 1, tau);
      mix.leadTone.frequency.setTargetAtTime(on ? 1900 : 5200, ctx.currentTime, tau);
    },
    get night() {
      return night;
    },
  };
}

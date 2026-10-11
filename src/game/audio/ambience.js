// Ambience: daytime FM bird chirps (random species pattern, pan and timing
// every 2-7 s) and night crickets (pulsed chirps from a few fixed spots),
// crossfaded by the environment's night factor.
import { glideGain } from "./mixer.js";

const rand = (a, b) => a + Math.random() * (b - a);

/**
 * @param {BaseAudioContext} ctx
 * @param {ReturnType<import("./mixer.js").createMixer>} mix
 */
export function createAmbience(ctx, mix) {
  let nextBird = 0;
  let birdLevel = 1;
  let cricketLevel = 0;
  let started = false;
  const crickets = [
    { out: mix.panner(-0.55, mix.crickets), pitch: 4600, period: 0.86, gain: 0.028, next: 0 },
    { out: mix.panner(0.6, mix.crickets), pitch: 4250, period: 1.04, gain: 0.022, next: 0 },
    { out: mix.panner(0.1, mix.crickets), pitch: 4900, period: 0.71, gain: 0.012, next: 0 },
  ];

  /** One bird phrase: a single FM voice whose pitch/amp automation draws the notes. */
  function bird(t) {
    const out = mix.panner(rand(-0.75, 0.75), mix.birds);
    const car = ctx.createOscillator();
    const mod = ctx.createOscillator();
    const modAmt = ctx.createGain();
    const amp = ctx.createGain();
    amp.gain.value = 0;
    mod.frequency.value = rand(28, 70);
    modAmt.gain.value = rand(80, 260);
    mod.connect(modAmt);
    modAmt.connect(car.frequency);
    car.connect(amp);
    amp.connect(out);

    const scale = rand(0.85, 1.2);
    const peak = rand(0.03, 0.06);
    const notes = [];
    const kind = Math.floor(Math.random() * 3);
    if (kind === 0) {
      // "tweet tweet": rising sweeps
      const n = 2 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n; i++) notes.push([0.075, 2700, 4300]);
    } else if (kind === 1) {
      // quick trill
      const n = 5 + Math.floor(Math.random() * 4);
      for (let i = 0; i < n; i++) notes.push([0.035, i % 2 ? 4100 : 3600, i % 2 ? 3900 : 3800]);
    } else {
      // "fee-bee" whistle
      notes.push([0.24, 3300, 3000], [0.2, 2700, 2650]);
    }

    car.frequency.setValueAtTime(notes[0][1] * scale, t);
    let tn = t;
    for (const [dur, f0, f1] of notes) {
      car.frequency.setValueAtTime(f0 * scale, tn);
      car.frequency.exponentialRampToValueAtTime(f1 * scale, tn + dur);
      amp.gain.setValueAtTime(0, tn);
      amp.gain.linearRampToValueAtTime(peak, tn + Math.min(0.012, dur * 0.3));
      amp.gain.linearRampToValueAtTime(0, tn + dur);
      tn += dur + (notes.length > 3 ? 0.03 : 0.07);
    }
    car.start(t);
    mod.start(t);
    car.stop(tn + 0.05);
    mod.stop(tn + 0.05);
    car.onended = () => {
      amp.disconnect();
      modAmt.disconnect();
      out.disconnect();
    };
  }

  /** One cricket chirp: 3-4 rapid sine pulses. */
  function chirp(c, t) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    g.gain.value = 0;
    osc.frequency.value = c.pitch * rand(0.99, 1.01);
    osc.connect(g);
    g.connect(c.out);
    const pulses = 3 + (Math.random() < 0.5 ? 1 : 0);
    let tp = t;
    for (let i = 0; i < pulses; i++) {
      g.gain.setValueAtTime(0, tp);
      g.gain.linearRampToValueAtTime(c.gain, tp + 0.005);
      g.gain.linearRampToValueAtTime(0, tp + 0.018);
      tp += 0.042;
    }
    osc.start(t);
    osc.stop(tp + 0.02);
    osc.onended = () => g.disconnect();
  }

  return {
    start(t) {
      started = true;
      nextBird = t + rand(0.5, 2);
      crickets.forEach((c, i) => (c.next = t + 0.3 + i * 0.37));
    },
    /** Schedule ambience events that start before `until`. */
    scheduleUntil(until) {
      if (!started) return;
      const now = ctx.currentTime;
      if (nextBird < now - 1) nextBird = now + rand(0.5, 2);
      while (nextBird < until) {
        if (birdLevel > 0.03) bird(nextBird);
        nextBird += rand(2, 7);
      }
      for (const c of crickets) {
        if (c.next < now - 1) c.next = now + rand(0, c.period);
        while (c.next < until) {
          if (cricketLevel > 0.03) chirp(c, c.next);
          c.next += c.period * rand(0.92, 1.08);
        }
      }
    },
    /** 0 = day (birds) .. 1 = night (crickets). */
    setNight(n) {
      const night = Math.min(Math.max(Number.isFinite(n) ? n : 0, 0), 1);
      birdLevel = 1 - smooth(0.3, 0.7, night);
      cricketLevel = smooth(0.45, 0.85, night);
      glideGain(ctx, mix.birds, birdLevel, 1.5);
      glideGain(ctx, mix.crickets, cricketLevel, 1.5);
    },
  };
}

function smooth(a, b, x) {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
}

// Townsfolk: named cartoon people strolling the town's NPC loops. Each one
// follows a lookahead point on its closed path with rate-limited turning,
// sidesteps / slows for other walkers and the hero, stops now and then to
// look around, and greets Pip with a wave and a speech bubble.

import { Vector3 } from "@babylonjs/core";
import { createCharacter } from "../character.js";
import { makeRng } from "../palette.js";
import { LoopPath } from "./path.js";
import { TOWNSFOLK, COMMON_LINES } from "./lines.js";
import { createBubbles } from "./bubbles.js";
import { pushOutOfStatic } from "./collide.js";

// ---- tuning -------------------------------------------------------------------
const GREET_RADIUS = 3.5; // m
const GREET_COOLDOWN = 25; // s per NPC
const GREET_GAP = 4; // s between any two greetings
const GREET_TIME = 3.3; // s the NPC stays stopped while greeting
const WAVE_TIME = 1.8; // s
const LOOK_RADIUS = 7; // head tracks the hero inside this
const ANIM_RADIUS = 60; // skip skeleton animation beyond this
const LOOKAHEAD = 1.8; // m along the path
const BODY_R = 0.3; // collision radius vs. static colliders
const STEP_UP = 0.4; // colliders taller than this above the feet block walking
const SEP_NPC = 0.8; // hard minimum NPC-NPC distance
const SEP_HERO = 0.9; // hard minimum NPC-hero distance
const PASS_LAT = 1.25; // lateral clearance kept when passing
const MAX_OFFSET = 1.4; // max sidestep from the path centre line
const TURN_GAIN = 5; // 1/s
const TURN_MAX_WALK = 2.8; // rad/s
const TURN_MAX_GREET = 5.0;
const ACCEL = 2.2; // m/s^2
const DECEL = 4.5;

const TAU = Math.PI * 2;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const wrapAngle = (a) => {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
};

/** Order loops (nearest to the spawn first) and decide how many walkers each gets. */
function assignLoops(loops, count, spawn) {
  const near = (l) => {
    let best = Infinity;
    for (let i = 0; i < l.n; i++) best = Math.min(best, Math.hypot(l.xs[i] - spawn.x, l.zs[i] - spawn.z));
    return best;
  };
  const sorted = loops.map((l) => ({ l, d: near(l), count: 0 })).sort((a, b) => a.d - b.d);
  const out = [];
  for (let i = 0; i < count; i++) {
    let slot;
    if (i < sorted.length) slot = sorted[i];
    else if (i === sorted.length) slot = sorted[0]; // a second stroller where the hero starts
    else slot = sorted.reduce((a, b) => (b.l.length / (b.count + 1) > a.l.length / (a.count + 1) ? b : a));
    out.push({ loop: slot.l, k: slot.count });
    slot.count++;
  }
  return out.map((o) => ({ ...o, of: sorted.find((s) => s.l === o.loop).count }));
}

/**
 * @param {import("@babylonjs/core").Scene} scene
 * @param {object} env
 * @param {import("../colliders.js").ColliderWorld} colliders
 * @param {object} town
 * @param {{ quality?: string, events?: any }} [opts]
 */
export function createTownsfolk(scene, env, colliders, town, { quality = "high", events } = {}) {
  const count = quality === "low" ? 5 : TOWNSFOLK.length;
  const spawn = town?.spawnPoint ?? { x: 0, z: 0 };
  let loops = (town?.npcPaths ?? []).map((p) => new LoopPath(p)).filter((l) => l.valid);
  if (!loops.length) {
    // no paths: a gentle circle around the spawn so the town still feels alive
    const pts = [];
    for (let i = 0; i < 24; i++) pts.push({ x: spawn.x + Math.sin((i / 24) * TAU) * 9, z: spawn.z + 10 + Math.cos((i / 24) * TAU) * 9 });
    loops = [new LoopPath(pts)];
  }

  const bubbles = createBubbles(scene, { maxActive: 3 });
  bubbles.prewarm(COMMON_LINES[0]);
  const plan = assignLoops(loops, count, spawn);
  const castShadows = quality !== "low";
  /** @type {any[]} */
  const npcs = [];
  const tmp = { x: 0, z: 0, tx: 0, tz: 0 };
  const steer = { x: 0, z: 0 };
  const proj = { s: 0, seg: 0, dist: 0 };

  plan.forEach(({ loop, k, of }, i) => {
    const def = TOWNSFOLK[i % TOWNSFOLK.length];
    const r = makeRng(1000 + i * 97);
    const char = createCharacter(scene, { name: def.name, preset: "random", seed: i * 7 + 3, lod: "low", outline: false });
    if (castShadows) env?.addShadowCaster?.(char.root, true);
    // walkers sharing a loop start spread out, alternating directions
    const prev = npcs.find((n) => n.path === loop);
    const s = loop.wrap((loop.length * k) / of + r() * loop.length * (of > 1 ? 0.2 : 1));
    const dir = prev ? -prev.dir : r() < 0.5 ? 1 : -1;
    loop.sample(s, tmp);
    const npc = {
      name: def.name,
      line: def.line,
      char,
      path: loop,
      dir,
      s,
      seg: loop.segAt(s),
      x: tmp.x,
      z: tmp.z,
      y: colliders?.groundHeightAt?.(tmp.x, tmp.z, BODY_R, 1) ?? 0,
      heading: Math.atan2(tmp.tx * dir, tmp.tz * dir),
      height: char.height ?? 1.55,
      baseSpeed: 1.1 + r() * 0.5,
      speed: 0,
      side: 0,
      passing: -1,
      blockedT: 0,
      patience: 1.4 + r() * 1.4,
      reverseOkAt: 0,
      waveAt: 0,
      mode: "walk",
      modeT: 0,
      stopFor: 0,
      stopYaw: 0,
      nextStop: 6 + r() * 16,
      waving: false,
      waved: false,
      greetReadyAt: 0,
      saidPersonal: false,
      dist: Infinity,
      looking: false,
      rng: r,
      upd: { speed: 0 },
      pos: { x: tmp.x, z: tmp.z },
    };
    npc.speed = npc.baseSpeed;
    char.root.position.set(npc.x, npc.y, npc.z);
    char.root.rotation.y = npc.heading;
    char.setState("walk");
    char.update(0.016, npc.upd);
    npcs.push(npc);
  });

  const positions = npcs.map((n) => n.pos);
  const lookAt = new Vector3();
  const hits = [];
  const recent = [];
  let now = 0;
  let nextGreetAt = 1.5;
  let warned = false;

  function pickLine(npc) {
    const personal = !npc.saidPersonal ? npc.rng() < 0.6 : npc.rng() < 0.2;
    if (personal && npc.line) {
      npc.saidPersonal = true;
      return npc.line;
    }
    let text = COMMON_LINES[0];
    for (let tries = 0; tries < 8; tries++) {
      text = COMMON_LINES[Math.floor(npc.rng() * COMMON_LINES.length) % COMMON_LINES.length];
      if (!recent.includes(text)) break;
    }
    recent.push(text);
    if (recent.length > 4) recent.shift();
    return text;
  }

  function startGreet(npc) {
    npc.mode = "greet";
    npc.modeT = 0;
    npc.waving = false;
    npc.waved = false;
    npc.greetReadyAt = now + GREET_COOLDOWN;
    nextGreetAt = now + GREET_GAP;
    const text = pickLine(npc);
    bubbles.show(npc, text);
    npc.char.setState("idle");
    events?.emit?.("npc:greet", { name: npc.name, text });
  }

  function startStop(npc) {
    npc.mode = "stop";
    npc.modeT = 0;
    npc.stopFor = 2 + npc.rng() * 3;
    // turn a little to one side, as if looking at a shop window or the view
    const side = npc.rng() < 0.5 ? -1 : 1;
    npc.stopYaw = wrapAngle(npc.heading + side * (0.5 + npc.rng() * 0.9));
  }

  /** Any other walker within r metres? */
  function crowded(npc, i, r) {
    for (let j = 0; j < npcs.length; j++) {
      if (j !== i && Math.hypot(npcs[j].x - npc.x, npcs[j].z - npc.z) < r) return true;
    }
    return false;
  }

  /** Is walker i blocking someone who has been waiting for a while? */
  function blocking(i) {
    for (let j = 0; j < npcs.length; j++) if (npcs[j].passing === i && npcs[j].blockedT > 0.6) return true;
    return false;
  }

  /**
   * Walking steer: head for the lookahead point on the path, or - when a
   * walker / the hero blocks our lane - for a passing point beside them
   * (keep right unless there's no room). Writes the goal into `steer` and
   * returns a speed factor 0..1.
   */
  function steerWalk(npc, i, hx, hz, hasHero, dt) {
    const path = npc.path;
    path.sample(npc.s, tmp);
    const fx = tmp.tx * npc.dir; // path forward
    const fz = tmp.tz * npc.dir;
    const rx = fz; // path right
    const rz = -fx;
    const myLat = (npc.x - tmp.x) * rx + (npc.z - tmp.z) * rz;
    path.sample(npc.s + npc.dir * LOOKAHEAD, tmp);
    steer.x = tmp.x;
    steer.z = tmp.z;

    // nearest obstacle ahead in our corridor (path frame)
    let bestAlong = Infinity;
    let bestLat = 0;
    let bestJ = -1;
    let follow = false;
    for (let j = -1; j < npcs.length; j++) {
      let ox;
      let oz;
      let same = false;
      if (j < 0) {
        if (!hasHero) continue;
        ox = hx;
        oz = hz;
      } else {
        if (j === i) continue;
        const o = npcs[j];
        ox = o.x;
        oz = o.z;
        // walking our way at a similar pace: just follow, no need to pass
        same = o.speed > 0.3 && Math.sin(o.heading) * fx + Math.cos(o.heading) * fz > 0.5 && o.speed >= npc.speed * 0.85;
      }
      const dx = ox - npc.x;
      const dz = oz - npc.z;
      const along = dx * fx + dz * fz;
      if (along < -0.3 || along > 3.2) continue;
      const lat = dx * rx + dz * rz;
      if (Math.abs(lat) > 1.2) continue;
      // side by side with someone going our way: no need to brake or swerve
      if (same && along < 0.4) continue;
      if (along < bestAlong) {
        bestAlong = along;
        bestLat = lat;
        bestJ = j;
        follow = same;
      }
    }
    npc.passing = bestJ;
    if (bestAlong === Infinity) {
      npc.side = 0;
      npc.blockedT = Math.max(0, npc.blockedT - dt);
      return 1;
    }
    const ox = npc.x + bestAlong * fx + bestLat * rx;
    const oz = npc.z + bestAlong * fz + bestLat * rz;
    if (!follow) {
      const obsLat = myLat + bestLat; // obstacle's offset from the centre line
      if (!npc.side) {
        const other = bestJ >= 0 ? npcs[bestJ] : null;
        let side;
        if (other && other.passing === i && other.side) {
          // they're already dodging us: mirror their choice (head-on, both keep to the same hand)
          side = other.side;
        } else {
          // keep right unless they're clearly on our right already, or there's no room
          side = bestLat > 0.6 ? -1 : 1;
          if (Math.abs(obsLat + side * PASS_LAT) > MAX_OFFSET && Math.abs(obsLat - side * PASS_LAT) <= MAX_OFFSET) side = -side;
        }
        npc.side = side;
      }
      const shift = clamp(obsLat + npc.side * PASS_LAT, -MAX_OFFSET, MAX_OFFSET) - obsLat;
      // aim beside the obstacle at the passing offset (a bit past it once we're close)
      const ahead = clamp(1.2 - bestAlong, 0.15, 1.2);
      steer.x = ox + shift * rx + fx * ahead;
      steer.z = oz + shift * rz + fz * ahead;
    }
    // slow down only when it is right in front of where we're heading
    const hfx = Math.sin(npc.heading);
    const hfz = Math.cos(npc.heading);
    const dx = ox - npc.x;
    const dz = oz - npc.z;
    const hAlong = dx * hfx + dz * hfz;
    const hLat = Math.abs(dx * hfz - dz * hfx);
    let f = 1;
    if (follow) f = clamp((bestAlong - 1.0) / 1.4, 0.15, 1);
    else if (hAlong > 0 && hLat < 0.75) f = clamp((hAlong - 0.55) / 1.1, 0, 1);
    // two walkers in each other's way (merging at a corner, head-on in a
    // narrow spot): the later one politely waits, the other squeezes past
    if (bestJ >= 0 && npcs[bestJ].passing === i && f < 0.5) {
      if (i > bestJ) {
        npc.blockedT += dt * 0.3;
        return 0;
      }
      f = Math.max(f, 0.45);
    }
    if (f < 0.3) npc.blockedT += dt;
    else npc.blockedT = Math.max(0, npc.blockedT - dt);
    return f;
  }

  function step(dt, playerPos, camPos) {
    now += dt;
    const hasHero = !!playerPos && Number.isFinite(playerPos.x) && Number.isFinite(playerPos.z);
    const hx = hasHero ? playerPos.x : 0;
    const hy = hasHero ? Number(playerPos.y) || 0 : 0;
    const hz = hasHero ? playerPos.z : 0;

    // ---- intentions & movement
    for (let i = 0; i < npcs.length; i++) {
      const npc = npcs[i];
      const dx = hx - npc.x;
      const dz = hz - npc.z;
      npc.dist = hasHero ? Math.hypot(dx, dz) : Infinity;

      if (hasHero && npc.mode !== "greet" && npc.dist < GREET_RADIUS && Math.abs(hy - npc.y) < 2.5 && now >= npc.greetReadyAt && now >= nextGreetAt) {
        startGreet(npc);
      }

      npc.modeT += dt;
      let desired = npc.heading;
      let targetSpeed = 0;
      let turnMax = TURN_MAX_WALK;
      if (npc.mode === "walk") {
        npc.nextStop -= dt;
        if (npc.nextStop <= 0) {
          npc.nextStop = 10 + npc.rng() * 18;
          if (npc.dist > 4 && !crowded(npc, i, 3.5)) startStop(npc);
        }
      }
      if (npc.mode === "walk") {
        const speedF = steerWalk(npc, i, hx, hz, hasHero, dt);
        desired = Math.atan2(steer.x - npc.x, steer.z - npc.z);
        targetSpeed = npc.baseSpeed * speedF;
        // boxed in (cornered by the hero, a head-on stalemate...): turn back
        if (npc.blockedT > npc.patience && now > npc.reverseOkAt) {
          npc.dir = -npc.dir;
          npc.side = 0;
          npc.blockedT = 0;
          npc.reverseOkAt = now + 8;
          npc.patience = 1.4 + npc.rng() * 1.4;
        }
      } else if (npc.mode === "stop") {
        desired = npc.stopYaw;
        // someone stuck behind us? stop dawdling
        if (npc.modeT > npc.stopFor || blocking(i)) {
          npc.mode = "walk";
          npc.modeT = 0;
        }
      } else if (npc.mode === "greet") {
        turnMax = TURN_MAX_GREET;
        if (hasHero && npc.dist > 0.05) desired = Math.atan2(dx, dz);
        const err = Math.abs(wrapAngle(desired - npc.heading));
        if (!npc.waved && ((npc.modeT > 0.25 && err < 0.6) || npc.modeT > 0.9)) {
          npc.waved = true;
          npc.waving = true;
          npc.waveAt = npc.modeT;
          npc.char.setState("wave");
        }
        if (npc.waving && npc.modeT - npc.waveAt > WAVE_TIME) {
          npc.waving = false;
          npc.char.setState("idle");
        }
        if (npc.modeT > GREET_TIME && !npc.waving) {
          npc.mode = "walk";
          npc.modeT = 0;
        }
      }

      // rate-limited turning, slower walking while facing away from the goal
      const err = wrapAngle(desired - npc.heading);
      let turn = clamp(err * TURN_GAIN, -turnMax, turnMax) * dt;
      if (Math.abs(turn) > Math.abs(err)) turn = err;
      npc.heading = wrapAngle(npc.heading + turn);
      if (npc.mode === "walk") targetSpeed *= clamp(1 - (Math.abs(err) - 0.35) / 1.2, 0.25, 1);
      const dv = targetSpeed - npc.speed;
      npc.speed += clamp(dv, -DECEL * dt, ACCEL * dt);
      if (npc.speed < 0) npc.speed = 0;
      npc.x += Math.sin(npc.heading) * npc.speed * dt;
      npc.z += Math.cos(npc.heading) * npc.speed * dt;
    }

    // ---- hard separation: never overlap each other or walk through the hero
    for (let i = 0; i < npcs.length; i++) {
      const a = npcs[i];
      for (let j = i + 1; j < npcs.length; j++) {
        const b = npcs[j];
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const d2 = dx * dx + dz * dz;
        if (d2 >= SEP_NPC * SEP_NPC) continue;
        const d = Math.sqrt(d2) || 1e-3;
        const push = (SEP_NPC - d) / 2;
        const nx = d2 > 1e-8 ? dx / d : 1;
        const nz = d2 > 1e-8 ? dz / d : 0;
        a.x -= nx * push;
        a.z -= nz * push;
        b.x += nx * push;
        b.z += nz * push;
      }
      if (hasHero && Math.abs(hy - a.y) < 1.8) {
        const dx = a.x - hx;
        const dz = a.z - hz;
        const d2 = dx * dx + dz * dz;
        if (d2 < SEP_HERO * SEP_HERO) {
          const d = Math.sqrt(d2) || 1e-3;
          const nx = d2 > 1e-8 ? dx / d : -Math.sin(a.heading);
          const nz = d2 > 1e-8 ? dz / d : -Math.cos(a.heading);
          a.x = hx + nx * SEP_HERO;
          a.z = hz + nz * SEP_HERO;
        }
      }
    }

    // ---- static collisions, path progress, ground height, animation
    for (let i = 0; i < npcs.length; i++) {
      const npc = npcs[i];
      pushOutOfStatic(colliders, npc, BODY_R + 0.02, STEP_UP, hits);
      npc.path.project(npc.x, npc.z, npc.seg, 3, proj);
      npc.s = proj.s;
      npc.seg = proj.seg;

      const ground = colliders?.groundHeightAt ? colliders.groundHeightAt(npc.x, npc.z, BODY_R, npc.y + 0.5) : 0;
      const rate = ground > npc.y ? 20 : 12;
      npc.y += (ground - npc.y) * (1 - Math.exp(-rate * dt));

      const root = npc.char.root;
      root.position.set(npc.x, npc.y, npc.z);
      root.rotation.y = npc.heading;
      npc.pos.x = npc.x;
      npc.pos.z = npc.z;

      let animDist = npc.dist;
      if (!hasHero && camPos) animDist = Math.hypot(camPos.x - npc.x, camPos.z - npc.z);
      if (animDist > ANIM_RADIUS) continue;

      if (npc.mode !== "greet") npc.char.setState(npc.speed > 0.15 ? "walk" : "idle");
      if (hasHero && npc.dist < LOOK_RADIUS) {
        lookAt.set(hx, hy + 1.4, hz);
        npc.char.setLookAt(lookAt);
        npc.looking = true;
      } else if (npc.looking) {
        npc.char.setLookAt(null);
        npc.looking = false;
      }
      npc.upd.speed = npc.speed;
      npc.char.update(dt, npc.upd);
    }

    bubbles.update(dt, camPos);
  }

  return {
    positions,
    npcs,
    bubbles,
    /**
     * @param {number} dt
     * @param {{x:number,y:number,z:number}|null} playerPos
     * @param {{x:number,y:number,z:number}|null} camPos
     */
    update(dt, playerPos, camPos) {
      if (!(dt > 0)) return;
      try {
        step(Math.min(dt, 0.1), playerPos, camPos);
      } catch (err) {
        if (!warned) console.warn("[npcs] townsfolk update failed", err);
        warned = true;
      }
    },
    dispose() {
      for (const n of npcs) n.char.dispose();
      bubbles.dispose();
    },
  };
}

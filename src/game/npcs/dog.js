// Biscuit, the park dog: trots between spots along the park paths and sniffs
// around; when Pip comes by it barks hello, follows him around the park for a
// while with its tail going like mad (hopping when he jumps), then wanders
// off again. One CPU-animated mesh (see partmesh.js), stays inside the park.

import { PartBuilder, PartMesh, setBody, setHinge } from "./partmesh.js";
import { pushOutOfStatic } from "./collide.js";
import { makeRng } from "../palette.js";

const BODY = 0;
const HEAD = 1;
const EAR_L = 2;
const EAR_R = 3;
const TAIL = 4;
const LEGS = [5, 6, 7, 8]; // FL, FR, BL, BR
const PARTS = 9;

const NAME = "Biscuit";
const SCALE = 1.15;
const RADIUS = 0.3;
const NOTICE_RADIUS = 7; // starts following inside this
const FOLLOW_GAP = 1.7; // preferred distance to the hero
const FOLLOW_TIME = 24; // s
const FOLLOW_COOLDOWN = 35; // s
const MAX_SPEED = 6.5;

const TAU = Math.PI * 2;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

const C = {
  coat: "#e3a45e",
  coatDark: "#b9773a",
  cream: "#fff1d6",
  ear: "#8a5a3b",
  nose: "#2b2230",
  eye: "#1d2b3a",
  tongue: "#ff7a9a",
  collar: "#e23c3c",
  tag: "#ffd93d",
};

/** Dog template facing +Z, feet at y = 0 (~0.75 m to the top of the head). */
function buildDog() {
  const b = new PartBuilder();
  b.ellipsoid([0, 0.36, -0.01], [0.15, 0.14, 0.27], (d) => (d[1] < -0.4 || (d[2] > 0.7 && d[1] < 0.35) ? C.cream : C.coat), BODY, 10, 6);
  b.ellipsoid([0, 0.47, 0.2], [0.09, 0.11, 0.09], C.coat, BODY, 8, 4); // neck
  b.ellipsoid([0, 0.455, 0.215], [0.1, 0.03, 0.1], C.collar, BODY, 10, 3);
  b.ellipsoid([0, 0.41, 0.315], [0.026, 0.03, 0.012], C.tag, BODY, 6, 3);
  // head
  b.ellipsoid([0, 0.62, 0.33], [0.13, 0.12, 0.125], (d) => (d[2] > 0.55 && d[1] < -0.1 ? C.cream : C.coat), HEAD, 10, 6);
  b.ellipsoid([0, 0.575, 0.44], [0.075, 0.06, 0.085], C.cream, HEAD, 8, 4);
  b.ellipsoid([0, 0.607, 0.522], [0.032, 0.025, 0.022], C.nose, HEAD, 6, 3);
  b.ellipsoid([0, 0.532, 0.47], [0.03, 0.012, 0.045], C.tongue, HEAD, 6, 3);
  for (const s of [-1, 1]) b.ellipsoid([s * 0.06, 0.66, 0.43], [0.024, 0.029, 0.018], C.eye, HEAD, 6, 4);
  // floppy ears
  b.ellipsoid([-0.135, 0.615, 0.31], [0.028, 0.095, 0.065], C.ear, EAR_L, 6, 4);
  b.ellipsoid([0.135, 0.615, 0.31], [0.028, 0.095, 0.065], C.ear, EAR_R, 6, 4);
  // tail (base at the rump, pointing up and back) with a cream tip
  b.ellipsoid([0, 0.53, -0.31], [0.035, 0.11, 0.04], (d) => (d[1] > 0.55 ? C.cream : C.coatDark), TAIL, 6, 5);
  // legs + paws
  const legXZ = [[-0.085, 0.17], [0.085, 0.17], [-0.085, -0.17], [0.085, -0.17]];
  legXZ.forEach(([x, z], k) => {
    b.ellipsoid([x, 0.17, z], [0.045, 0.14, 0.05], C.coat, LEGS[k], 6, 4);
    b.ellipsoid([x, 0.035, z + 0.025], [0.052, 0.035, 0.065], C.cream, LEGS[k], 6, 3);
  });
  return { b, legXZ };
}

/**
 * @param {import("@babylonjs/core").Scene} scene
 * @param {object} env
 * @param {import("../colliders.js").ColliderWorld} colliders
 * @param {import("@babylonjs/core").Material} material
 * @param {{ park: {minX:number,maxX:number,minZ:number,maxZ:number}, home: {x:number,z:number},
 *   paths?: Array<Array<{x:number,z:number}>>, townsfolk?: any[], bubbles?: any, events?: any,
 *   castShadows?: boolean }} opts
 */
export function createDog(scene, env, colliders, material, opts) {
  const { park, home, townsfolk = [], bubbles, events, castShadows = false } = opts;
  const rng = makeRng(31337);
  const { b: tpl, legXZ } = buildDog();
  const pm = new PartMesh(scene, "npc_dog", tpl, 1, material, PARTS);
  if (castShadows) env?.addShadowCaster?.(pm.mesh, false);

  // the dog's world: the park rectangle (inset), roaming spots along its paths near home
  const area = { minX: park.minX + 1.2, maxX: park.maxX - 1.2, minZ: park.minZ + 1.2, maxZ: park.maxZ - 1.2 };
  const inArea = (x, z, m = 0) => x > area.minX + m && x < area.maxX - m && z > area.minZ + m && z < area.maxZ - m;
  const spots = [];
  for (const path of opts.paths ?? []) {
    for (const p of path) if (inArea(p.x, p.z, 0.5) && Math.hypot(p.x - home.x, p.z - home.z) < 16) spots.push(p);
  }
  if (!spots.length) spots.push({ x: home.x, z: home.z });

  const dog = {
    name: NAME,
    x: home.x,
    y: 0,
    z: home.z,
    height: 0.85 * SCALE,
    heading: rng() * TAU,
    speed: 0,
    mode: "roam",
    modeT: 0,
    tx: home.x,
    tz: home.z,
    phase: 0,
    tailT: 0,
    hopT: -1,
    headYaw: 0,
    headPitch: 0,
    happy: 0,
    followUntil: 0,
    followReadyAt: 3,
    lastX: home.x,
    lastZ: home.z,
    progressT: 0,
  };
  const hits = [];
  let now = 0;
  let heroX = NaN;
  let heroZ = NaN;
  let warned = false;
  let hidden = false;

  function newSpot() {
    const p = spots[Math.floor(rng() * spots.length) % spots.length];
    dog.tx = clamp(p.x + (rng() - 0.5) * 2.5, area.minX, area.maxX);
    dog.tz = clamp(p.z + (rng() - 0.5) * 2.5, area.minZ, area.maxZ);
    dog.mode = "roam";
    dog.modeT = 0;
  }
  newSpot();
  dog.y = colliders?.groundHeightAt?.(dog.x, dog.z, 0.2, 1) ?? 0;

  // a little hop of joy when the hero jumps nearby
  const offJump = events?.on?.("player:jump", () => {
    if (dog.mode === "follow" && Math.hypot(heroX - dog.x, heroZ - dog.z) < 7 && dog.hopT < 0) dog.hopT = 0;
  });

  function step(dt, hero) {
    now += dt;
    dog.modeT += dt;
    const hasHero = !!hero && Number.isFinite(hero.x) && Number.isFinite(hero.z);
    heroX = hasHero ? hero.x : NaN;
    heroZ = hasHero ? hero.z : NaN;
    const hd = hasHero ? Math.hypot(hero.x - dog.x, hero.z - dog.z) : Infinity;
    const heroInPark = hasHero && inArea(hero.x, hero.z, -2);

    // ---- decide
    if (dog.mode !== "follow" && heroInPark && hd < NOTICE_RADIUS && now >= dog.followReadyAt) {
      dog.mode = "follow";
      dog.modeT = 0;
      dog.followUntil = now + FOLLOW_TIME;
      bubbles?.show?.(dog, "Woof! Woof!");
      events?.emit?.("npc:greet", { name: NAME, text: "Woof! Woof!" });
    }
    let targetSpeed = 0;
    let desired = dog.heading;
    if (dog.mode === "follow") {
      if (now > dog.followUntil || hd > 30 || !hasHero) {
        dog.followReadyAt = now + FOLLOW_COOLDOWN;
        newSpot();
      } else {
        // stay a step away from Pip, inside the park
        const k = hd > 1e-3 ? FOLLOW_GAP / hd : 0;
        const gx = clamp(hero.x + (dog.x - hero.x) * k, area.minX, area.maxX);
        const gz = clamp(hero.z + (dog.z - hero.z) * k, area.minZ, area.maxZ);
        const gd = Math.hypot(gx - dog.x, gz - dog.z);
        if (gd > 0.35 && hd > FOLLOW_GAP + 0.3) {
          desired = Math.atan2(gx - dog.x, gz - dog.z);
          targetSpeed = clamp(gd * 2.2, 0, MAX_SPEED);
        } else desired = Math.atan2(hero.x - dog.x, hero.z - dog.z); // sit tight, face Pip
      }
    }
    if (dog.mode === "roam") {
      const d = Math.hypot(dog.tx - dog.x, dog.tz - dog.z);
      if (d < 0.5) {
        dog.mode = "sniff";
        dog.modeT = 0;
        dog.sniffFor = 1.5 + rng() * 3;
      } else {
        desired = Math.atan2(dog.tx - dog.x, dog.tz - dog.z);
        targetSpeed = d > 6 ? 2.4 : 1.3;
      }
    } else if (dog.mode === "sniff" && dog.modeT > dog.sniffFor) newSpot();

    // ---- move
    const err = wrapAngle(desired - dog.heading);
    let turn = clamp(err * 6, -4.5, 4.5) * dt;
    if (Math.abs(turn) > Math.abs(err)) turn = err;
    dog.heading = wrapAngle(dog.heading + turn);
    targetSpeed *= clamp(1 - (Math.abs(err) - 0.4) / 1.2, 0.2, 1);
    dog.speed += clamp(targetSpeed - dog.speed, -9 * dt, 5 * dt);
    dog.x += Math.sin(dog.heading) * dog.speed * dt;
    dog.z += Math.cos(dog.heading) * dog.speed * dt;

    // ---- keep clear of the hero, the townsfolk and the scenery
    if (hasHero) {
      const dx = dog.x - hero.x;
      const dz = dog.z - hero.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.75 && Math.abs((hero.y ?? 0) - dog.y) < 1.2) {
        dog.x = hero.x + (d > 1e-4 ? dx / d : 1) * 0.75;
        dog.z = hero.z + (d > 1e-4 ? dz / d : 0) * 0.75;
      }
    }
    for (let i = 0; i < townsfolk.length; i++) {
      const n = townsfolk[i];
      const dx = dog.x - n.x;
      const dz = dog.z - n.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.65 && d > 1e-4) {
        dog.x = n.x + (dx / d) * 0.65;
        dog.z = n.z + (dz / d) * 0.65;
      }
    }
    pushOutOfStatic(colliders, dog, RADIUS, 0.35, hits);
    dog.x = clamp(dog.x, area.minX, area.maxX);
    dog.z = clamp(dog.z, area.minZ, area.maxZ);
    const ground = colliders?.groundHeightAt ? colliders.groundHeightAt(dog.x, dog.z, 0.2, dog.y + 0.4) : 0;
    dog.y += (ground - dog.y) * (1 - Math.exp(-15 * dt));

    // stuck against something while roaming? pick somewhere else
    dog.progressT += dt;
    if (dog.progressT > 1.5) {
      if (dog.mode === "roam" && Math.hypot(dog.x - dog.lastX, dog.z - dog.lastZ) < 0.4) newSpot();
      dog.lastX = dog.x;
      dog.lastZ = dog.z;
      dog.progressT = 0;
    }

    animate(dt, hasHero ? hero : null, hd);
  }

  const m = pm.mats;
  const offs = [0, 0, 0, 0];

  function animate(dt, hero, hd) {
    const v = dog.speed;
    const moveW = smoothstep(0.05, 0.9, v);
    const g = smoothstep(2.8, 4.4, v); // trot -> gallop
    const stride = 0.42 + 0.12 * Math.min(v, 6);
    dog.phase = (dog.phase + (v * dt) / stride) % 1;
    const ph = dog.phase * TAU;
    // leg phase offsets: trot = diagonal pairs, gallop = front pair / back pair
    offs[0] = 0;
    offs[1] = lerp(0.5, 0.12, g);
    offs[2] = lerp(0.5, 0.55, g);
    offs[3] = lerp(0, 0.67, g);
    const amp = 0.55 * moveW * (1 + 0.3 * g);
    let bob = moveW * (0.018 * Math.sin(2 * ph) * (1 - g) + 0.05 * Math.sin(ph) * g);
    let pitch = g * 0.1 * Math.sin(ph + 1);
    // hop
    if (dog.hopT >= 0) {
      dog.hopT += dt;
      const u = dog.hopT / 0.45;
      if (u >= 1) dog.hopT = -1;
      else {
        bob += 0.32 * Math.sin(Math.PI * u);
        pitch += 0.25 * Math.sin(TAU * u);
      }
    }

    // happiness drives the tail and the ears
    const near = hero && hd < 8;
    dog.happy += ((dog.mode === "follow" ? 1 : near ? 0.6 : 0.2) - dog.happy) * (1 - Math.exp(-3 * dt));
    dog.tailT += dt * lerp(5, 15, dog.happy);
    const wag = Math.sin(dog.tailT) * lerp(0.25, 0.65, dog.happy);

    // head: look at Pip when near, nose down while sniffing
    let yawT = 0;
    let pitchT = dog.mode === "sniff" ? 0.5 + 0.08 * Math.sin(dog.modeT * 9) : -0.05;
    if (near && dog.mode !== "sniff") {
      yawT = clamp(wrapAngle(Math.atan2(hero.x - dog.x, hero.z - dog.z) - dog.heading), -0.9, 0.9);
      pitchT = -0.15;
    } else if (dog.mode === "sniff") yawT = 0.25 * Math.sin(dog.modeT * 2.3);
    dog.headYaw += (yawT - dog.headYaw) * (1 - Math.exp(-6 * dt));
    dog.headPitch += (pitchT - dog.headPitch) * (1 - Math.exp(-6 * dt));

    const o = pm.at(0, BODY);
    setBody(m, o, dog.x, dog.y + bob, dog.z, dog.heading, pitch, 0, SCALE);
    const head = pm.at(0, HEAD);
    setHinge(m, head, o, 0, 0.5, 0.24, dog.headYaw, 1);
    setHinge(m, head, head, 0, 0.5, 0.24, dog.headPitch + moveW * 0.04 * Math.sin(2 * ph + 0.6), 0); // + = nose down
    const flop = 0.18 + moveW * 0.22 * Math.sin(2 * ph + 0.5);
    setHinge(m, pm.at(0, EAR_L), head, -0.11, 0.7, 0.31, -flop);
    setHinge(m, pm.at(0, EAR_R), head, 0.11, 0.7, 0.31, flop);
    setHinge(m, pm.at(0, TAIL), o, 0, 0.44, -0.27, wag);
    for (let k = 0; k < 4; k++) {
      const [x, z] = legXZ[k];
      setHinge(m, pm.at(0, LEGS[k]), o, x, 0.3, z, amp * Math.sin(ph + offs[k] * TAU), 0);
    }
    pm.update();
  }

  return {
    mesh: pm.mesh,
    dog,
    /**
     * @param {number} dt
     * @param {{x:number,y:number,z:number}|null} hero
     * @param {{x:number,y:number,z:number}|null} [camPos]  far from the camera: nap (hidden, no work)
     */
    update(dt, hero, camPos) {
      if (!(dt > 0)) return;
      try {
        const far = camPos ? Math.hypot(camPos.x - dog.x, camPos.z - dog.z) > 90 : false;
        if (far !== hidden) {
          hidden = far;
          pm.mesh.setEnabled(!far);
        }
        if (far) return;
        step(Math.min(dt, 0.1), hero);
      } catch (err) {
        if (!warned) console.warn("[npcs] dog update failed", err);
        warned = true;
      }
    },
    dispose() {
      offJump?.();
      pm.mesh.dispose();
    },
  };
}

// FX: particle "juice" reacting to gameplay events — landing dust rings, jump
// puffs, double-jump sparkle rings, running dust kicks, coin sparkles with a
// floating "+1", and a confetti celebration when every coin is found.
//
// Design: three long-lived ParticleSystems (dust / sparkle / confetti), one per
// texture + blend mode, are started once and fed with `manualEmitCount` bursts.
// Each burst is queued with its own origin/shape/look; our custom
// startPositionFunction pops the queue so several bursts in one frame never
// stomp on each other, and a wrapped updateFunction animates per-particle size,
// colour, drag and flutter from the burst that spawned it. Nothing is created
// per event except a tiny plain-JS burst record.
import {
  ParticleSystem,
  DynamicTexture,
  Texture,
  MeshBuilder,
  StandardMaterial,
  Mesh,
  Color3,
  Color4,
  Vector3,
} from "@babylonjs/core";

const TAU = Math.PI * 2;

const CONFETTI_COLORS = ["#ff5d5d", "#ffd93d", "#4d96ff", "#6bcb77", "#c77dff", "#ff8c42", "#00b4d8", "#ff6b9d"].map(
  (h) => Color3.FromHexString(h),
);
const GOLD_SPARKS = [new Color3(1, 0.82, 0.18), new Color3(1, 0.92, 0.45), new Color3(1, 1, 0.85), new Color3(1, 0.66, 0.1)];
const MAGIC_SPARKS = [new Color3(1, 1, 1), new Color3(0.55, 0.9, 1), new Color3(1, 0.88, 0.4), new Color3(1, 0.6, 0.9)];
const DUST_TINT = new Color3(1, 0.96, 0.88);

/**
 * @param {import("@babylonjs/core").Scene} scene
 * @param {object} env environment (reads `nightFactor` to dim dust at night)
 * @param {{ events: any, quality?: "low"|"medium"|"high" }} opts
 * @returns {{ update(dt: number): void }}
 */
export function createFX(scene, env, { events, quality = "high" } = {}) {
  let density = quality === "low" ? 0.5 : 1;
  const look = { dim: 1 }; // shared night dimming for unlit, non-glowing particles

  const tex = makeTextures(scene);
  const dust = new BurstSystem(scene, "fxDust", 360, tex.puff, ParticleSystem.BLENDMODE_STANDARD);
  // Alpha-blended (not additive) so the stars stay vivid against bright daytime ground.
  const sparkle = new BurstSystem(scene, "fxSparkle", 360, tex.sparkle, ParticleSystem.BLENDMODE_STANDARD);
  const confetti = new BurstSystem(scene, "fxConfetti", 480, tex.confetti, ParticleSystem.BLENDMODE_STANDARD);
  const systems = [dust, sparkle, confetti];
  const labels = createLabelPool(scene, 6);
  const rings = createRingPool(scene, 4, tex.ring);

  // Last known hero feet position (FX has no player handle; events carry it).
  const hero = new Vector3(0, 0, 0);
  const lastStep = new Vector3(0, 0, 0);
  let haveStep = false;
  let showerTime = 0;
  let showerAcc = 0;
  let paused = false;

  const n = (count) => Math.max(1, Math.round(count * density));
  const remember = (p) => {
    if (isVec(p)) hero.set(p.x, p.y, p.z);
  };

  // Burst "specs": how a burst places/launches its particles and how they look over life.
  const DUST_RING = {
    spawn(b, i, pos, vel) {
      const a = (i / b.n) * TAU + Math.random() * 0.5;
      const ca = Math.cos(a), sa = Math.sin(a);
      const r = b.radius * (0.7 + Math.random() * 0.6);
      pos.set(b.x + ca * r, b.y + 0.08 + Math.random() * 0.06, b.z + sa * r);
      const sp = b.speed * (0.65 + Math.random() * 0.6);
      vel.set(ca * sp, b.up * (0.5 + Math.random()), sa * sp);
    },
    style: dustStyle,
  };
  const DUST_KICK = {
    spawn(b, i, pos, vel) {
      pos.set(b.x + (Math.random() - 0.5) * 0.25, b.y + 0.06, b.z + (Math.random() - 0.5) * 0.25);
      const sp = b.speed * (0.5 + Math.random() * 0.6);
      vel.set(b.bx * sp + (Math.random() - 0.5) * 0.6, 0.5 + Math.random() * 0.5, b.bz * sp + (Math.random() - 0.5) * 0.6);
    },
    style: dustStyle,
  };
  const SPARK_RING = {
    spawn(b, i, pos, vel) {
      const a = (i / b.n) * TAU;
      const ca = Math.cos(a), sa = Math.sin(a);
      pos.set(b.x + ca * b.radius, b.y + b.yOff, b.z + sa * b.radius);
      const sp = b.speed * (0.85 + Math.random() * 0.3);
      vel.set(ca * sp, 0.4 + Math.random() * 0.5, sa * sp);
    },
    style: sparkStyle,
  };
  const SPARK_BURST = {
    spawn(b, i, pos, vel) {
      randomDir(vel, 0.15);
      pos.set(b.x + vel.x * 0.15, b.y + b.yOff + vel.y * 0.15, b.z + vel.z * 0.15);
      vel.scaleInPlace(b.speed * (0.45 + Math.random() * 0.75));
    },
    style: sparkStyle,
  };
  const SPARK_FLASH = {
    spawn(b, i, pos, vel) {
      pos.set(b.x, b.y, b.z);
      vel.set(0, 0, 0);
    },
    style(p, b, t, dt) {
      const c = b.colors[2];
      p.size = b.size * (0.5 + 0.7 * Math.sin(Math.min(t, 1) * Math.PI));
      p.color.set(c.r, c.g, c.b, (1 - t) * 0.85);
      p.angle += 4 * dt;
    },
  };
  const CONFETTI_POP = {
    spawn(b, i, pos, vel) {
      const a = Math.random() * TAU;
      const spread = 0.35 + Math.random() * 0.5;
      pos.set(b.x + Math.cos(a) * 0.3, b.y + 1.1, b.z + Math.sin(a) * 0.3);
      const sp = b.speed * (0.65 + Math.random() * 0.45);
      vel.set(Math.cos(a) * spread * sp * 0.45, sp, Math.sin(a) * spread * sp * 0.45);
    },
    style: confettiStyle,
  };
  const CONFETTI_RAIN = {
    spawn(b, i, pos, vel) {
      const a = Math.random() * TAU;
      const r = Math.sqrt(Math.random()) * b.radius;
      pos.set(b.x + Math.cos(a) * r, b.y + b.height + Math.random() * 1.5, b.z + Math.sin(a) * r);
      vel.set((Math.random() - 0.5) * 0.8, -0.6 - Math.random() * 0.6, (Math.random() - 0.5) * 0.8);
    },
    style: confettiStyle,
  };

  // ---- event wiring -----------------------------------------------------------
  const off = [];
  const on = (name, fn) => {
    if (events?.on) off.push(events.on(name, (payload) => fn(payload ?? {})));
  };

  on("player:land", ({ impact, position }) => {
    if (!isVec(position)) return;
    remember(position);
    const imp = Number.isFinite(impact) ? impact : 0;
    if (imp < 2.2) return;
    const k = clamp01((imp - 2.2) / 10);
    dust.burst(DUST_RING, position, {
      n: n(9 + 19 * k),
      radius: 0.22,
      speed: 1.5 + 2.8 * k,
      up: 0.35 + 0.4 * k,
      size: 0.42 + 0.42 * k,
      alpha: 0.75 + 0.2 * k,
      life: 0.55 + 0.35 * k,
    });
    if (imp > 7) rings.spawn(position, 0.1, 0.35, 1.3 + 0.9 * k, 0.4, "ground");
  });

  on("player:jump", ({ double, position }) => {
    if (!isVec(position)) return;
    remember(position);
    if (!double) {
      dust.burst(DUST_RING, position, { n: n(7), radius: 0.12, speed: 1.1, up: 0.25, size: 0.32, alpha: 0.7, life: 0.45 });
      return;
    }
    // Double jump: a horizontal ring of sparkles at the feet + a star burst around the hero.
    sparkle.burst(SPARK_RING, position, { n: n(16), y: 0.25, radius: 0.35, speed: 3.4, size: 0.34, colors: MAGIC_SPARKS, life: 0.5 });
    sparkle.burst(SPARK_BURST, position, {
      n: n(12), y: 0.9, speed: 3.2, gravity: 2.5, drag: 2.6, size: 0.3, colors: MAGIC_SPARKS, life: 0.65,
    });
    rings.spawn(position, 0.05, 0.25, 1.25, 0.32, "air");
  });

  on("player:footstep", ({ run, position }) => {
    if (!isVec(position)) return;
    remember(position);
    let bx = 0;
    let bz = 0;
    if (haveStep) {
      const dx = position.x - lastStep.x;
      const dz = position.z - lastStep.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.05 && d < 4) {
        bx = -dx / d;
        bz = -dz / d;
      }
    }
    lastStep.set(position.x, position.y, position.z);
    haveStep = true;
    if (!run) return;
    dust.burst(DUST_KICK, position, { n: n(3), bx, bz, speed: 1.2, size: 0.28, alpha: 0.6, life: 0.42 });
  });

  on("coin:collected", ({ position }) => {
    if (!isVec(position)) return;
    sparkle.burst(SPARK_FLASH, position, { n: 1, size: 1.15, life: 0.18, colors: GOLD_SPARKS });
    sparkle.burst(SPARK_BURST, position, {
      n: n(18), y: 0, speed: 2.8, gravity: 3, drag: 2.2, size: 0.4, colors: GOLD_SPARKS, life: 0.7,
    });
    labels.spawn(position.x, position.y + 0.45, position.z);
  });

  on("coin:all", () => {
    confetti.burst(CONFETTI_POP, hero, { n: n(110), speed: 8.5, life: 3.4 });
    sparkle.burst(SPARK_RING, hero, { n: n(24), y: 0.5, radius: 0.5, speed: 4.2, size: 0.42, colors: GOLD_SPARKS, life: 0.7 });
    sparkle.burst(SPARK_BURST, hero, {
      n: n(26), y: 1.2, speed: 4.5, gravity: 1.5, drag: 1.8, size: 0.4, colors: GOLD_SPARKS, life: 1.0,
    });
    rings.spawn(hero, 0.06, 0.4, 2.4, 0.6, "air");
    showerTime = 3;
    showerAcc = 0;
  });

  on("settings:quality", ({ level }) => {
    density = level === "low" ? 0.5 : 1;
  });

  on("game:pause", ({ paused: p }) => {
    paused = !!p;
    for (const s of systems) s.ps.paused = paused;
  });

  // ---- per-frame --------------------------------------------------------------
  function update(dt) {
    dt = Number.isFinite(dt) ? Math.min(Math.max(dt, 0), 0.1) : 0;
    if (paused) return;

    const nf = Number(env?.nightFactor);
    look.dim = 1 - 0.5 * (Number.isFinite(nf) ? clamp01(nf) : 0);

    if (showerTime > 0) {
      showerTime -= dt;
      showerAcc += dt * 55 * density;
      const count = Math.floor(showerAcc);
      if (count > 0) {
        showerAcc -= count;
        confetti.burst(CONFETTI_RAIN, hero, { n: count, radius: 4.2, height: 4.5, life: 3.2 });
      }
    }

    labels.update(dt);
    rings.update(dt, look.dim);
  }

  /** Cartoon dust puffs: burst outward, slow down, swell, then shrink away. */
  function dustStyle(p, b, t, dt, h) {
    const damp = Math.exp(-4.2 * dt);
    p.direction.x *= damp;
    p.direction.z *= damp;
    p.direction.y = p.direction.y * damp + 0.35 * dt;
    const grow = t < 0.3 ? 0.35 + 0.65 * easeOutCubic(t / 0.3) : 1 - 0.8 * ((t - 0.3) / 0.7) ** 1.6;
    p.size = b.size * grow * (0.75 + 0.5 * h);
    // Keep each billboard mostly above the floor so the ground never slices it.
    const floor = b.y + p.size * 0.46;
    if (p.position.y < floor) p.position.y = floor;
    const a = (t < 0.65 ? 1 : 1 - (t - 0.65) / 0.35) * b.alpha;
    const d = look.dim;
    p.color.set(DUST_TINT.r * d, DUST_TINT.g * d, DUST_TINT.b * (d + 0.06), a);
    p.angle += (h - 0.5) * 2 * dt;
  }

  /** Twinkling cartoon stars with drag + gravity. */
  function sparkStyle(p, b, t, dt, h) {
    const damp = Math.exp(-b.drag * dt);
    p.direction.scaleInPlace(damp);
    p.direction.y -= b.gravity * dt;
    const twinkle = 0.7 + 0.3 * Math.sin(p.age * 30 + h * TAU);
    const env01 = t < 0.12 ? t / 0.12 : 1 - (t - 0.12) / 0.88;
    p.size = b.size * (0.6 + 0.8 * hash(h * 7.1)) * (0.35 + 0.65 * env01) * twinkle;
    const c = b.colors[Math.floor(hash(h * 3.3) * b.colors.length) % b.colors.length];
    p.color.set(c.r, c.g, c.b, Math.max(0, env01));
    p.angle += (h - 0.5) * 6 * dt;
  }

  /** Paper confetti: flutters down at a gentle terminal speed, flips, sways. */
  function confettiStyle(p, b, t, dt, h) {
    const h2 = hash(h * 5.7);
    const side = Math.exp(-1.6 * dt);
    p.direction.x *= side;
    p.direction.z *= side;
    const vy = p.direction.y;
    if (vy > 0) p.direction.y -= (7 + 1.2 * vy) * dt; // rising: gravity + air drag
    else p.direction.y += (-1.1 - vy) * (1 - Math.exp(-2.5 * dt)); // falling: settle at a slow drift
    const sway = Math.sin(p.age * (2.5 + 2 * h) + h2 * TAU) * 0.9 * dt;
    p.position.x += sway;
    p.position.z += Math.cos(p.age * (2.1 + 2 * h2) + h * TAU) * 0.6 * dt;
    p.size = 0.2 + 0.08 * h2;
    p.scale.x = 1;
    p.scale.y = Math.max(0.12, Math.abs(Math.cos(p.age * (5 + 7 * h) + h2 * TAU))) * 0.75;
    p.angle += (h - 0.5) * 5 * dt;
    const c = CONFETTI_COLORS[Math.floor(h2 * CONFETTI_COLORS.length) % CONFETTI_COLORS.length];
    const d = 0.35 + 0.65 * look.dim; // confetti dims less than dust: it's festive
    const a = Math.min(1, t / 0.05) * (t > 0.8 ? (1 - t) / 0.2 : 1);
    p.color.set(c.r * d, c.g * d, c.b * d, a);
  }

  return {
    update,
    /** Unhook events and free GPU resources (not needed by the game loop; handy for previews/tests). */
    dispose() {
      for (const unsubscribe of off) unsubscribe?.();
      for (const s of systems) s.ps.dispose(false);
      labels.dispose();
      rings.dispose();
      for (const t of Object.values(tex)) t.dispose();
    },
  };
}

// ---------------------------------------------------------------------------
// BurstSystem: one started ParticleSystem fed by a queue of bursts.
// ---------------------------------------------------------------------------

class BurstSystem {
  constructor(scene, name, capacity, texture, blendMode) {
    this.scene = scene;
    this.capacity = capacity;
    this.queue = [];
    this.queued = 0;
    this._vel = new Vector3();

    const ps = new ParticleSystem(name, capacity, scene);
    this.ps = ps;
    ps.particleTexture = texture;
    ps.blendMode = blendMode;
    ps.emitter = new Vector3(0, -50, 0); // moved to each burst origin
    ps.updateSpeed = 1 / 60; // => direction is m/s, age/lifeTime are seconds
    ps.minEmitPower = 1;
    ps.maxEmitPower = 1;
    ps.minSize = 0; // real sizes are animated per particle in the style pass
    ps.maxSize = 0;
    ps.minLifeTime = 0.5;
    ps.maxLifeTime = 0.5;
    ps.color1 = new Color4(1, 1, 1, 0); // invisible until the first style pass
    ps.color2 = new Color4(1, 1, 1, 0);
    ps.colorDead = new Color4(1, 1, 1, 0);
    ps.gravity = Vector3.Zero();
    ps.minAngularSpeed = 0;
    ps.maxAngularSpeed = 0;
    ps.minInitialRotation = 0;
    ps.maxInitialRotation = TAU;
    ps.isLocal = false;
    ps.manualEmitCount = 0;

    ps.startPositionFunction = (_m, pos, particle) => this._spawn(pos, particle);
    ps.startDirectionFunction = (_m, dir) => dir.copyFrom(this._vel);

    const baseUpdate = ps.updateFunction;
    ps.updateFunction = (particles) => {
      baseUpdate(particles); // ages, integrates, recycles the dead
      const dt = ps.updateSpeed * (scene.getAnimationRatio?.() ?? 1); // same step Babylon just used
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        const b = p.metadata;
        if (!b) continue;
        const t = Math.min(p.age / p.lifeTime, 1);
        b.spec.style(p, b, t, dt, hash(p.id * 0.618 + 0.1));
      }
    };
    ps.start();
  }

  /**
   * Queue a burst. `opts.n` = particle count, `opts.life` = mean lifetime (s);
   * the rest is spec-specific (radius, speed, size, colors…).
   */
  burst(spec, origin, opts) {
    const free = this.capacity - this.ps.getActiveCount() - this.queued;
    const count = Math.min(Math.floor(opts.n), free);
    if (!(count > 0)) return;
    const b = {
      ...opts,
      spec,
      n: count,
      remaining: count,
      x: origin.x,
      y: origin.y,
      z: origin.z,
      yOff: opts.y ?? 0,
      gravity: opts.gravity ?? 0,
      drag: opts.drag ?? 3,
      life: opts.life ?? 0.6,
    };
    this.queue.push(b);
    this.queued += count;
    this.ps.emitter.set(origin.x, origin.y, origin.z);
    this.ps.manualEmitCount = Math.max(0, this.ps.manualEmitCount) + count;
  }

  _spawn(pos, particle) {
    const b = this.queue[0];
    if (!b) {
      // Should not happen (counts are capped), but stay harmless.
      pos.set(0, -50, 0);
      this._vel.set(0, 0, 0);
      particle.lifeTime = 0.001;
      particle.metadata = null;
      return;
    }
    const i = b.n - b.remaining;
    b.remaining--;
    this.queued--;
    if (b.remaining <= 0) this.queue.shift();
    b.spec.spawn(b, i, pos, this._vel, particle);
    particle.lifeTime = b.life * (0.75 + Math.random() * 0.5);
    particle.metadata = b;
  }
}

// ---------------------------------------------------------------------------
// Floating "+1" labels (pooled billboards sharing one texture/material).
// ---------------------------------------------------------------------------

function createLabelPool(scene, size) {
  const W = 256;
  const H = 128;
  const tex = new DynamicTexture("fxPlusOneTex", { width: W, height: H }, scene, true, Texture.TRILINEAR_SAMPLINGMODE);
  tex.hasAlpha = true;
  let drawnWithFont = false;
  const draw = () => {
    const ctx = tex.getContext();
    ctx.clearRect(0, 0, W, H);
    ctx.font = "700 100px Fredoka, 'Arial Rounded MT Bold', 'Trebuchet MS', Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    const x = W / 2;
    const y = H / 2 + 4;
    ctx.lineWidth = 20;
    ctx.strokeStyle = "rgba(90,48,8,0.95)";
    ctx.strokeText("+1", x, y);
    const g = ctx.createLinearGradient(0, y - 40, 0, y + 40);
    g.addColorStop(0, "#fff7b0");
    g.addColorStop(0.5, "#ffd23f");
    g.addColorStop(1, "#ff9f1c");
    ctx.fillStyle = g;
    ctx.fillText("+1", x, y);
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.strokeText("+1", x, y - 2);
    tex.update();
    drawnWithFont = !!globalThis.document?.fonts?.check?.("700 100px Fredoka");
  };
  draw();

  const mat = new StandardMaterial("fxPlusOneMat", scene);
  mat.diffuseTexture = tex;
  mat.useAlphaFromDiffuseTexture = true;
  mat.diffuseColor = new Color3(0, 0, 0);
  mat.specularColor = new Color3(0, 0, 0);
  mat.emissiveColor = new Color3(1, 1, 1);
  mat.disableLighting = true;
  mat.backFaceCulling = false;
  mat.fogEnabled = false;

  const pool = [];
  for (let i = 0; i < size; i++) {
    const mesh = MeshBuilder.CreatePlane(`fxPlusOne${i}`, { width: 0.95, height: 0.475 }, scene);
    mesh.material = mat;
    mesh.billboardMode = Mesh.BILLBOARDMODE_ALL;
    mesh.renderingGroupId = 1; // draw over the popping coin / hero, like a HUD callout
    mesh.isPickable = false;
    mesh.setEnabled(false);
    pool.push({ mesh, t: 0, active: false, x: 0, y: 0, z: 0 });
  }
  // Hidden meshes are skipped by scene.whenReadyAsync(): compile now, not on the first pickup.
  mat.forceCompilation(pool[0].mesh);
  let next = 0;

  return {
    dispose() {
      for (const l of pool) l.mesh.dispose();
      mat.dispose();
      tex.dispose();
    },
    spawn(x, y, z) {
      // The bundled font may have finished loading after boot: redraw once with it.
      if (!drawnWithFont && globalThis.document?.fonts?.check?.("700 100px Fredoka")) draw();
      const l = pool[next];
      next = (next + 1) % pool.length;
      l.active = true;
      l.t = 0;
      l.x = x;
      l.y = y;
      l.z = z;
      l.mesh.position.set(x, y, z);
      l.mesh.scaling.setAll(0.01);
      l.mesh.visibility = 1;
      l.mesh.setEnabled(true);
    },
    update(dt) {
      for (const l of pool) {
        if (!l.active) continue;
        l.t += dt;
        const u = l.t / 0.8;
        if (u >= 1) {
          l.active = false;
          l.mesh.setEnabled(false);
          continue;
        }
        // Pop in with a little overshoot, rise, fade during the last 40%.
        const s = u < 0.18 ? easeOutBack(u / 0.18) : 1 + 0.06 * Math.sin((u - 0.18) * 8);
        l.mesh.scaling.setAll(Math.max(0.01, s));
        l.mesh.position.y = l.y + 1.1 * easeOutCubic(u);
        l.mesh.visibility = u < 0.6 ? 1 : 1 - (u - 0.6) / 0.4;
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Flat expanding shock-rings (hard landings, double jumps, finale).
// ---------------------------------------------------------------------------

function createRingPool(scene, size, ringTex) {
  const mats = {};
  const makeMat = (name, color) => {
    const m = new StandardMaterial(name, scene);
    m.diffuseColor = new Color3(0, 0, 0);
    m.specularColor = new Color3(0, 0, 0);
    m.emissiveColor = color; // with disableLighting the output colour is the emissive
    m.disableLighting = true;
    m.opacityTexture = ringTex;
    m.backFaceCulling = false;
    m.disableDepthWrite = true;
    m.zOffset = -3;
    return m;
  };
  mats.ground = makeMat("fxRingGround", new Color3(1, 0.96, 0.86));
  mats.air = makeMat("fxRingAir", new Color3(0.85, 0.97, 1));

  const pool = [];
  for (let i = 0; i < size; i++) {
    const mesh = MeshBuilder.CreatePlane(`fxRing${i}`, { size: 2 }, scene);
    mesh.rotation.x = Math.PI / 2; // lie flat, facing up
    mesh.material = mats.ground;
    mesh.isPickable = false;
    mesh.setEnabled(false);
    pool.push({ mesh, t: 0, dur: 0.35, r0: 0.3, r1: 1.2, active: false, kind: "ground" });
  }
  mats.ground.forceCompilation(pool[0].mesh);
  mats.air.forceCompilation(pool[0].mesh);
  let next = 0;

  return {
    dispose() {
      for (const r of pool) r.mesh.dispose();
      mats.ground.dispose();
      mats.air.dispose();
    },
    spawn(pos, yOff, r0, r1, dur, kind) {
      const r = pool[next];
      next = (next + 1) % pool.length;
      Object.assign(r, { t: 0, dur, r0, r1, active: true, kind });
      r.mesh.material = mats[kind] ?? mats.ground;
      r.mesh.position.set(pos.x, pos.y + yOff, pos.z);
      r.mesh.scaling.setAll(r0);
      r.mesh.visibility = 0.9;
      r.mesh.setEnabled(true);
    },
    update(dt, dim) {
      mats.ground.emissiveColor.set(dim, 0.96 * dim, 0.86 * dim + 0.04);
      for (const r of pool) {
        if (!r.active) continue;
        r.t += dt;
        const u = r.t / r.dur;
        if (u >= 1) {
          r.active = false;
          r.mesh.setEnabled(false);
          continue;
        }
        r.mesh.scaling.setAll(r.r0 + (r.r1 - r.r0) * easeOutCubic(u));
        r.mesh.visibility = 0.9 * (1 - u) ** 1.4;
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Procedural particle textures
// ---------------------------------------------------------------------------

function makeTextures(scene) {
  const make = (name, size, paint) => {
    const t = new DynamicTexture(name, { width: size, height: size }, scene, true, Texture.TRILINEAR_SAMPLINGMODE);
    const ctx = t.getContext();
    ctx.clearRect(0, 0, size, size);
    paint(ctx, size);
    t.hasAlpha = true;
    t.wrapU = Texture.CLAMP_ADDRESSMODE;
    t.wrapV = Texture.CLAMP_ADDRESSMODE;
    t.update();
    return t;
  };

  // Soft cartoon puff: bright top-left, gently shaded underside, soft rim.
  const puff = make("fxPuffTex", 128, (ctx, s) => {
    const c = s / 2;
    // Opaque body with a crisp-but-soft edge…
    const edge = ctx.createRadialGradient(c, c, 0, c, c, c - 1);
    edge.addColorStop(0, "rgba(255,255,255,1)");
    edge.addColorStop(0.8, "rgba(255,255,255,1)");
    edge.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = edge;
    ctx.beginPath();
    ctx.arc(c, c, c - 1, 0, TAU);
    ctx.fill();
    // …then shade it (keeping alpha) so each puff reads as a little ball lit from above.
    ctx.globalCompositeOperation = "source-atop";
    const shade = ctx.createRadialGradient(c - 16, c - 20, 6, c, c, c);
    shade.addColorStop(0, "rgba(255,255,255,1)");
    shade.addColorStop(0.6, "rgba(246,246,246,1)");
    shade.addColorStop(1, "rgba(212,212,218,1)");
    ctx.fillStyle = shade;
    ctx.fillRect(0, 0, s, s);
    ctx.globalCompositeOperation = "source-over";
  });

  // Four-point twinkle star with a soft glow and tiny diagonal rays.
  const sparkle = make("fxSparkleTex", 128, (ctx, s) => {
    const c = s / 2;
    const glow = ctx.createRadialGradient(c, c, 0, c, c, c * 0.6);
    glow.addColorStop(0, "rgba(255,255,255,0.6)");
    glow.addColorStop(0.4, "rgba(255,255,255,0.16)");
    glow.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, s, s);
    const star = (len, pinch, rot) => {
      ctx.save();
      ctx.translate(c, c);
      ctx.rotate(rot);
      ctx.beginPath();
      ctx.moveTo(0, -len);
      ctx.quadraticCurveTo(pinch, -pinch, len, 0);
      ctx.quadraticCurveTo(pinch, pinch, 0, len);
      ctx.quadraticCurveTo(-pinch, pinch, -len, 0);
      ctx.quadraticCurveTo(-pinch, -pinch, 0, -len);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    };
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    star(c * 0.5, 5, Math.PI / 4);
    ctx.fillStyle = "rgba(255,255,255,1)";
    star(c * 0.96, 10, 0);
    const core = ctx.createRadialGradient(c, c, 0, c, c, 12);
    core.addColorStop(0, "rgba(255,255,255,1)");
    core.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = core;
    ctx.fillRect(c - 12, c - 12, 24, 24);
  });

  // Paper confetti: rounded rectangle with a subtle fold shading.
  const confetti = make("fxConfettiTex", 64, (ctx, s) => {
    const g = ctx.createLinearGradient(0, 0, s, s);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.55, "rgba(238,238,238,1)");
    g.addColorStop(1, "rgba(205,205,205,1)");
    ctx.fillStyle = g;
    roundRect(ctx, 6, 14, s - 12, s - 28, 5);
    ctx.fill();
  });

  // Soft annulus for shock-rings.
  const ring = make("fxRingTex", 128, (ctx, s) => {
    const c = s / 2;
    const g = ctx.createRadialGradient(c, c, 0, c, c, c);
    g.addColorStop(0, "rgba(255,255,255,0)");
    g.addColorStop(0.58, "rgba(255,255,255,0)");
    g.addColorStop(0.8, "rgba(255,255,255,0.9)");
    g.addColorStop(0.88, "rgba(255,255,255,0.75)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  });

  return { puff, sparkle, confetti, ring };
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function isVec(p) {
  return !!p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);
}
function clamp01(x) {
  return Math.min(Math.max(x, 0), 1);
}
/** Deterministic 0..1 hash so each particle keeps stable "personality" values. */
function hash(x) {
  const s = Math.sin(x * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}
/** Random unit vector, biased upward by `up` (0 = uniform sphere). */
function randomDir(out, up) {
  const z = Math.random() * 2 - 1;
  const a = Math.random() * TAU;
  const r = Math.sqrt(1 - z * z);
  out.set(r * Math.cos(a), z, r * Math.sin(a));
  out.y += up;
  out.normalize();
  return out;
}
const easeOutCubic = (t) => 1 - (1 - t) ** 3;
function easeOutBack(t) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
}

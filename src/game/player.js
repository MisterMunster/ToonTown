// Kinematic third-person character controller (no physics engine).
//
// The body is a vertical capsule (radius 0.35, height 1.6) whose position is
// the FEET. Each frame: read input (camera-relative) → accelerate → jump /
// gravity → integrate in small sub-steps, resolving collisions against the
// static ColliderWorld after every sub-step:
//   - horizontal: push the capsule's XZ disc out of every collider whose
//     vertical span overlaps the body (above the step height), slide along walls
//   - step-up: anything whose top is within STEP_HEIGHT of the feet is not a
//     wall; it becomes ground and the feet move up onto it (visually smoothed)
//   - ground: ColliderWorld.groundHeightAt() under a slightly smaller disc
//   - ceiling: the head entering a collider from below stops upward motion
// See ARCHITECTURE.md "Player" for the public contract.

import { Vector3, Quaternion } from "@babylonjs/core";
import { ColliderWorld } from "./colliders.js";

const RADIUS = 0.35;
const HEIGHT = 1.6;
const STEP_HEIGHT = 0.4; // curbs, sidewalks, stairs, low platforms (grounded)
const AIR_STEP = 0.2; // small ledge assist while airborne
const SNAP_DOWN = 0.42; // stay glued to the ground when walking down steps
const GROUND_PROBE = RADIUS * 0.7;

const WALK_SPEED = 4.6;
const RUN_SPEED = 7.8;
const RUN_ANIM_SPEED = (WALK_SPEED + RUN_SPEED) / 2;
const GROUND_ACCEL = 45;
const GROUND_DECEL = 35;
const AIR_CONTROL = 0.45;
const AIR_DRAG = GROUND_DECEL * 0.25; // keep most momentum when letting go mid-air

const GRAVITY = -28;
const TERMINAL_VELOCITY = -30;
const JUMP_SPEED = 9.5; // apex ≈ v²/2g ≈ 1.61 m
const DOUBLE_JUMP_SPEED = 8.5; // +1.29 m → ≈ 2.9 m total
const SHORT_HOP_GRAVITY = 2.2; // gravity multiplier when jump is released early
const COYOTE_TIME = 0.12;
const JUMP_BUFFER = 0.15;

const TURN_RATE = 12; // rad/s max
const TURN_SMOOTH = 16; // 1/s exponential ease near the target heading
const MAX_SUBSTEP = RADIUS / 2;
const STEP_SMOOTH_RATE = 16; // 1/s visual easing of step-up/down

const LAND_EVENT_IMPACT = 2;
const LAND_ANIM_IMPACT = 3;
const STRIDE_WALK = 0.7;
const STRIDE_RUN = 1.0;
const FALL_KILL_Y = -20;

const TWO_PI = Math.PI * 2;
/** Wrap an angle to (-π, π]. */
function wrapAngle(a) {
  a = (a + Math.PI) % TWO_PI;
  if (a < 0) a += TWO_PI;
  return a - Math.PI;
}
const finite = (v) => (Number.isFinite(v) ? v : 0);

/**
 * @param {import("@babylonjs/core").Scene} scene
 * @param {{ root: import("@babylonjs/core").TransformNode, setState?: Function, update?: Function }} character
 * @param {ReturnType<import("./input.js").createInput>} input
 * @param {import("./colliders.js").ColliderWorld} colliders
 * @param {{ spawn?: Vector3, heading?: number, bounds?: {minX:number,maxX:number,minZ:number,maxZ:number}, events?: any }} [opts]
 */
export function createPlayer(scene, character, input, colliders, opts = {}) {
  const { bounds = null, events = null } = opts;
  const spawn = opts.spawn ? opts.spawn.clone() : new Vector3(0, 0, 0);
  const spawnHeading = Number.isFinite(opts.heading) ? opts.heading : 0;

  const position = spawn.clone();
  const velocity = new Vector3(0, 0, 0);

  // ---- controller state --------------------------------------------------
  let grounded = false;
  let coyoteT = 0;
  let jumpBufferT = 0;
  let airJumps = 1;
  let jumpRising = false; // true while rising from a player-initiated jump
  let airTime = 0;
  let stepSmooth = 0; // visual-only Y offset easing step-ups/downs
  let strideDist = STRIDE_WALK * 0.45;
  let wasEnabled = true;

  // Animation bookkeeping (land / doubleJump are one-shots in the character).
  let animState = "";
  let animLockT = 0;
  const animInfo = { speed: 0, grounded: true, verticalSpeed: 0 };

  const queryList = []; // reused collider query result

  const api = {
    root: character?.root ?? null,
    position,
    velocity,
    heading: spawnHeading,
    speed: 0,
    grounded: false,
    enabled: true,
    update,
    teleport,
  };

  // Footsteps land on the character's real foot plants when it reports them
  // (character.onStep); otherwise they fall back to a fixed stride below.
  const footSync = !!character && "onStep" in character;
  if (footSync) {
    character.onStep = () => {
      if (grounded) emit("player:footstep", { run: api.speed > RUN_ANIM_SPEED, position: position.clone() });
    };
  }

  // ---- helpers -----------------------------------------------------------
  function emit(name, payload) {
    try {
      events?.emit?.(name, payload);
    } catch (err) {
      console.error(err);
    }
  }

  function groundAt(x, z, maxTop) {
    return colliders ? colliders.groundHeightAt(x, z, GROUND_PROBE, maxTop) : 0;
  }

  function setAnim(state, lock = 0, force = false) {
    if (!force && (animLockT > 0 || state === animState)) return;
    animState = state;
    animLockT = lock;
    try {
      character?.setState?.(state);
    } catch (err) {
      console.error(err);
    }
  }

  /** Push the XZ disc out of one collider; slide velocity along it. */
  function pushOut(c) {
    let nx;
    let nz;
    let push;
    if (c.type === "cyl") {
      const dx = position.x - c.x;
      const dz = position.z - c.z;
      const rr = RADIUS + c.radius;
      const d2 = dx * dx + dz * dz;
      if (d2 >= rr * rr) return false;
      const d = Math.sqrt(d2);
      if (d < 1e-6) {
        nx = 1;
        nz = 0;
      } else {
        nx = dx / d;
        nz = dz / d;
      }
      push = rr - d;
    } else {
      const qx = Math.max(c.minX, Math.min(position.x, c.maxX));
      const qz = Math.max(c.minZ, Math.min(position.z, c.maxZ));
      const dx = position.x - qx;
      const dz = position.z - qz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= RADIUS * RADIUS) return false;
      if (d2 > 1e-10) {
        const d = Math.sqrt(d2);
        nx = dx / d;
        nz = dz / d;
        push = RADIUS - d;
      } else {
        // Center is inside the box footprint: leave through the nearest face.
        const l = position.x - c.minX;
        const r = c.maxX - position.x;
        const b = position.z - c.minZ;
        const t = c.maxZ - position.z;
        const m = Math.min(l, r, b, t);
        nx = m === l ? -1 : m === r ? 1 : 0;
        nz = nx !== 0 ? 0 : m === b ? -1 : 1;
        push = m + RADIUS;
      }
    }
    position.x += nx * (push + 1e-4);
    position.z += nz * (push + 1e-4);
    const vn = velocity.x * nx + velocity.z * nz;
    if (vn < 0) {
      velocity.x -= vn * nx;
      velocity.z -= vn * nz;
    }
    return true;
  }

  /** Resolve horizontal penetration against walls (2–3 passes for corners). */
  function resolveHorizontal() {
    if (!colliders) return;
    const lo = position.y + (grounded ? STEP_HEIGHT : AIR_STEP);
    const hi = position.y + HEIGHT;
    const m = RADIUS + 0.25;
    const list = colliders.queryXZ(position.x - m, position.z - m, position.x + m, position.z + m, queryList);
    for (let iter = 0; iter < 3; iter++) {
      let pushed = false;
      for (let i = 0; i < list.length; i++) {
        const c = list[i];
        if (c.maxY <= lo || c.minY >= hi) continue; // steppable or overhead
        if (pushOut(c)) pushed = true;
      }
      if (!pushed) break;
    }
  }

  /** Lowest collider bottom the head would enter while moving up, or Infinity. */
  function ceilingAbove(headBefore, headAfter) {
    if (!colliders) return Infinity;
    const r = GROUND_PROBE;
    const list = colliders.queryXZ(position.x - r, position.z - r, position.x + r, position.z + r, queryList);
    let best = Infinity;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (c.minY < headBefore - 0.02 || c.minY >= headAfter || c.minY >= best) continue;
      if (ColliderWorld.overlapsDiscXZ(c, position.x, position.z, r)) best = c.minY;
    }
    return best;
  }

  function land(impact) {
    grounded = true;
    jumpRising = false;
    airJumps = 1;
    velocity.y = 0;
    if (impact > LAND_EVENT_IMPACT) emit("player:land", { impact, position: position.clone() });
    if (impact > LAND_ANIM_IMPACT) setAnim("land", 0.16, true);
    else animLockT = 0; // a soft landing ends any airborne one-shot (somersault)
    strideDist = STRIDE_WALK * 0.45;
  }

  function syncCharacter() {
    const root = character?.root;
    if (!root) return;
    root.position.set(position.x, position.y - stepSmooth, position.z);
    if (root.rotationQuaternion) Quaternion.RotationYawPitchRollToRef(api.heading, 0, 0, root.rotationQuaternion);
    else root.rotation.y = api.heading;
  }

  /** false if the state got corrupted (NaN) or the hero fell out of the world. */
  function isSane() {
    return (
      Number.isFinite(position.x) && Number.isFinite(position.y) && Number.isFinite(position.z) &&
      Number.isFinite(velocity.x) && Number.isFinite(velocity.y) && Number.isFinite(velocity.z) &&
      Number.isFinite(api.heading) && position.y >= FALL_KILL_Y
    );
  }

  function respawn() {
    teleport(spawn, spawnHeading);
  }

  // ---- public ------------------------------------------------------------
  /**
   * @param {Vector3} target feet position
   * @param {number} [heading]
   */
  function teleport(target, heading) {
    position.copyFrom(target);
    velocity.setAll(0);
    if (Number.isFinite(heading)) api.heading = heading;
    grounded = false;
    jumpRising = false;
    coyoteT = 0;
    airJumps = 1;
    airTime = 0;
    stepSmooth = 0;
    // Settle immediately if we're (nearly) standing on something.
    const g = groundAt(position.x, position.z, position.y + STEP_HEIGHT);
    if (position.y - g < 0.05) {
      position.y = g;
      grounded = true;
    }
    api.grounded = grounded;
    api.speed = 0;
    syncCharacter();
  }

  /**
   * @param {number} dt seconds
   * @param {number} cameraYaw camera look direction on XZ (see ARCHITECTURE.md)
   */
  function update(dt, cameraYaw) {
    if (!(dt > 0)) return;
    dt = Math.min(dt, 0.1);
    if (!isSane()) {
      respawn();
      return;
    }

    // ---- input -----------------------------------------------------------
    const enabled = api.enabled !== false;
    // A press made in the same frame the player got enabled (e.g. Space on
    // the title screen) must not make the hero hop.
    if (enabled && !wasEnabled) {
      input?.consumeJump?.();
      jumpBufferT = 0;
    }
    wasEnabled = enabled;

    let ix = 0;
    let iz = 0;
    let run = false;
    let jumpHeld = false;
    if (enabled && input) {
      ix = finite(input.moveX);
      iz = finite(input.moveZ);
      run = !!input.run;
      jumpHeld = !!input.jumpHeld;
      if (input.consumeJump?.()) jumpBufferT = JUMP_BUFFER;
    } else {
      input?.consumeJump?.(); // drain presses while disabled
    }

    // Camera-relative wish direction: forward (sin θ, cos θ), right (cos θ, −sin θ).
    const yaw = finite(cameraYaw);
    const sy = Math.sin(yaw);
    const cy = Math.cos(yaw);
    let wx = ix * cy + iz * sy;
    let wz = -ix * sy + iz * cy;
    let mag = Math.hypot(wx, wz);
    if (mag > 1) {
      wx /= mag;
      wz /= mag;
      mag = 1;
    }

    // ---- horizontal acceleration ----------------------------------------
    const maxSpeed = run ? RUN_SPEED : WALK_SPEED;
    const tvx = wx * maxSpeed;
    const tvz = wz * maxSpeed;
    const hasInput = mag > 0.01;
    const rate = grounded ? (hasInput ? GROUND_ACCEL : GROUND_DECEL) : hasInput ? GROUND_ACCEL * AIR_CONTROL : AIR_DRAG;
    let dvx = tvx - velocity.x;
    let dvz = tvz - velocity.z;
    const dl = Math.hypot(dvx, dvz);
    const maxDv = rate * dt;
    if (dl > maxDv) {
      dvx *= maxDv / dl;
      dvz *= maxDv / dl;
    }
    velocity.x += dvx;
    velocity.z += dvz;

    // ---- jumping ----------------------------------------------------------
    if (grounded) coyoteT = COYOTE_TIME;
    else coyoteT -= dt;
    jumpBufferT -= dt;
    if (jumpBufferT > 0) {
      if (grounded || coyoteT > 0) {
        velocity.y = JUMP_SPEED;
        grounded = false;
        coyoteT = 0;
        jumpBufferT = 0;
        jumpRising = true;
        airJumps = 1;
        airTime = 0;
        setAnim("jump", 0, true);
        emit("player:jump", { double: false, position: position.clone() });
      } else if (airJumps > 0) {
        velocity.y = DOUBLE_JUMP_SPEED;
        airJumps = 0;
        jumpBufferT = 0;
        jumpRising = true;
        // Let the second jump redirect momentum toward the stick — feels responsive.
        if (hasInput) {
          velocity.x += (tvx - velocity.x) * 0.5;
          velocity.z += (tvz - velocity.z) * 0.5;
        }
        setAnim("doubleJump", 0.5, true);
        emit("player:jump", { double: true, position: position.clone() });
      }
    }

    // ---- gravity (trapezoid integration: apex height is frame-rate independent)
    let vyAvg = 0;
    if (!grounded) {
      let g = GRAVITY;
      if (jumpRising && velocity.y > 0 && !jumpHeld) g *= SHORT_HOP_GRAVITY;
      const vy0 = velocity.y;
      velocity.y = Math.max(TERMINAL_VELOCITY, vy0 + g * dt);
      vyAvg = (vy0 + velocity.y) * 0.5;
      if (velocity.y <= 0) jumpRising = false;
    } else {
      velocity.y = 0;
    }

    // ---- integrate with sub-steps ---------------------------------------
    const startX = position.x;
    const startZ = position.z;
    const travel = Math.max(Math.hypot(velocity.x, velocity.z), Math.abs(vyAvg)) * dt;
    const steps = Math.min(16, Math.max(1, Math.ceil(travel / MAX_SUBSTEP)));
    const h = dt / steps;
    let landedImpact = -1;

    for (let s = 0; s < steps; s++) {
      position.x += velocity.x * h;
      position.z += velocity.z * h;
      resolveHorizontal();

      if (grounded) {
        // Follow the ground: step up onto low things, snap down small drops.
        const g = groundAt(position.x, position.z, position.y + STEP_HEIGHT);
        if (g >= position.y - SNAP_DOWN) {
          stepSmooth += g - position.y;
          position.y = g;
        } else {
          grounded = false; // walked off a ledge → fall (coyote time applies)
          velocity.y = 0;
          vyAvg = 0;
          airTime = 0;
        }
      } else {
        const y0 = position.y;
        position.y += vyAvg * h;
        if (velocity.y > 0) {
          const ceil = ceilingAbove(y0 + HEIGHT, position.y + HEIGHT);
          if (ceil !== Infinity) {
            position.y = ceil - HEIGHT - 1e-3;
            velocity.y = 0;
            vyAvg = 0;
            jumpRising = false;
          }
        } else {
          const g = groundAt(position.x, position.z, y0 + AIR_STEP);
          if (position.y <= g) {
            if (g - position.y > 0.02 && g > y0) stepSmooth += g - y0; // ledge assist pop → ease it
            position.y = g;
            landedImpact = -velocity.y;
            vyAvg = 0;
            land(landedImpact);
          }
        }
      }
    }

    // ---- bounds & safety -------------------------------------------------
    if (bounds) {
      const minX = bounds.minX + RADIUS;
      const maxX = bounds.maxX - RADIUS;
      const minZ = bounds.minZ + RADIUS;
      const maxZ = bounds.maxZ - RADIUS;
      if (position.x < minX) { position.x = minX; if (velocity.x < 0) velocity.x = 0; }
      else if (position.x > maxX) { position.x = maxX; if (velocity.x > 0) velocity.x = 0; }
      if (position.z < minZ) { position.z = minZ; if (velocity.z < 0) velocity.z = 0; }
      else if (position.z > maxZ) { position.z = maxZ; if (velocity.z > 0) velocity.z = 0; }
    }
    if (!isSane()) {
      respawn();
      return;
    }

    if (!grounded) airTime += dt;
    stepSmooth = Math.max(-0.5, Math.min(0.5, stepSmooth)) * Math.exp(-dt * STEP_SMOOTH_RATE);
    if (Math.abs(stepSmooth) < 1e-4) stepSmooth = 0;

    // ---- facing -----------------------------------------------------------
    if (enabled && mag > 0.08) {
      const target = Math.atan2(wx, wz);
      const diff = wrapAngle(target - api.heading);
      const maxTurn = TURN_RATE * dt;
      const step = Math.max(-maxTurn, Math.min(maxTurn, diff * (1 - Math.exp(-dt * TURN_SMOOTH))));
      api.heading = wrapAngle(api.heading + step);
    }

    // ---- footsteps ----------------------------------------------------------
    const speed = Math.hypot(velocity.x, velocity.z);
    if (!footSync && grounded && landedImpact < 0) {
      const stride = speed > RUN_ANIM_SPEED ? STRIDE_RUN : STRIDE_WALK;
      if (speed < 0.3) strideDist = stride * 0.45; // first step lands soon after starting
      else {
        strideDist += Math.hypot(position.x - startX, position.z - startZ);
        if (strideDist >= stride) {
          strideDist = Math.min(strideDist - stride, stride * 0.5);
          emit("player:footstep", { run: speed > RUN_ANIM_SPEED, position: position.clone() });
        }
      }
    }

    // ---- animation --------------------------------------------------------
    animLockT -= dt;
    let desired;
    if (grounded) desired = speed > RUN_ANIM_SPEED ? "run" : speed > 0.35 ? "walk" : "idle";
    else if (velocity.y > 0) desired = "jump";
    else desired = airTime > 0.08 || animState === "jump" ? "fall" : animState || "idle";
    // Starting to move cancels a landing squash early; it reads snappier.
    if (animState === "land" && grounded && speed > 1.5 && animLockT < 0.08) animLockT = 0;
    setAnim(desired);

    api.speed = speed;
    api.grounded = grounded;
    syncCharacter();

    animInfo.speed = speed;
    animInfo.grounded = grounded;
    animInfo.verticalSpeed = velocity.y;
    try {
      character?.update?.(dt, animInfo);
    } catch (err) {
      console.error(err);
    }
  }

  // Start settled on the ground under the spawn point.
  teleport(spawn, spawnHeading);
  setAnim("idle", 0, true);
  return api;
}

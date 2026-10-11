// Player input: keyboard + Gamepad API + on-screen touch controls (cross-shaped
// D-pad, JUMP button, RUN toggle). Everything is merged into one small,
// device-agnostic intent object that the player controller and camera read
// each frame. See ARCHITECTURE.md "Input" and "Key map".
//
// Notes
// - Fields on the returned object are plain writable properties (the headless
//   smoke test overwrites moveX / moveZ / run after update()).
// - moveX / moveZ are camera-relative: x = right, z = forward, magnitude <= 1.
// - Touch controls are only built on touch devices (coarse pointer or the
//   first touch event), or when forced with `?touch=1` / opts.touch = true.

const JUMP_BUFFER = 0.15; // s a press stays "consumable"
const PROGRAMMATIC_HOLD = 0.4; // s pressJump() reads as held (covers the whole rise → full-height jump)
const STICK_DEADZONE = 0.2;
const LOOK_DEADZONE = 0.15;
const TRIGGER_THRESHOLD = 0.35;

// Gamepad "standard" mapping button indices.
const PAD = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, RT: 7, START: 9, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };

// Physical key codes (event.code) → action. event.code is layout independent,
// so WASD stays in the same place on AZERTY / Dvorak keyboards.
const KEY_ACTIONS = {
  ArrowUp: "up",
  KeyW: "up",
  ArrowDown: "down",
  KeyS: "down",
  ArrowLeft: "left",
  KeyA: "left",
  ArrowRight: "right",
  KeyD: "right",
  ShiftLeft: "run",
  ShiftRight: "run",
  Space: "jump",
};
// Fallback for environments that report an empty event.code.
const KEY_FALLBACK = {
  ArrowUp: "ArrowUp", ArrowDown: "ArrowDown", ArrowLeft: "ArrowLeft", ArrowRight: "ArrowRight",
  w: "KeyW", W: "KeyW", a: "KeyA", A: "KeyA", s: "KeyS", S: "KeyS", d: "KeyD", D: "KeyD",
  " ": "Space", Spacebar: "Space", Shift: "ShiftLeft",
};
// Keys whose browser default (page scroll, button activation) must be suppressed.
const PREVENT = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"]);

// Touch-control stylesheet: Vite bundles it (an eager glob is a static
// import); plain Node (headless smoke test) can't import .css and skips it.
if (import.meta.env) import.meta.glob("../ui/touch.css", { eager: true });

/** true while the user is typing into a form field (game keys must not fire). */
function isTypingTarget(target) {
  if (!target || typeof target !== "object") return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable === true;
}

/** Gamepad button state as a boolean (analog triggers count above a threshold). */
function padPressed(buttons, i, threshold = 0.5) {
  const b = buttons[i];
  if (!b) return false;
  return b.pressed || b.value > threshold;
}

/**
 * @param {import("@babylonjs/core").Scene} scene  used to keep polling Start while paused
 * @param {HTMLCanvasElement} canvas  (unused: keys are read on window, touch UI lives in #touch-root)
 * @param {{ events?: { emit(name: string, payload?: any): void, on?: Function }, touch?: boolean }} [opts]
 *   touch: force the on-screen controls on (true) or off (false); also `?touch=1|0` in the URL.
 */
export function createInput(scene, canvas, opts = {}) {
  const { events } = opts;
  const emit = (name, payload) => {
    try {
      events?.emit(name, payload);
    } catch (err) {
      console.error(err);
    }
  };

  // ---- internal state ---------------------------------------------------
  const keysDown = new Set(); // held physical codes
  let paused = false;
  let jumpBufferT = 0;
  let programmaticHoldT = 0;
  let keyJumpHeld = false;

  // Gamepad (re-computed every poll)
  let padMoveX = 0;
  let padMoveZ = 0;
  let padRun = false;
  let padJumpHeld = false;
  let padLookX = 0;
  let padLookY = 0;
  const padPrev = []; // per gamepad index: Uint8Array of last button states
  let polledSinceRender = false;

  // Touch
  let touchMoveX = 0;
  let touchMoveZ = 0;
  let touchRun = false;
  let touchJumpHeld = false;
  let touchUI = null;

  const api = {
    moveX: 0,
    moveZ: 0,
    run: false,
    jumpHeld: false,
    lookX: 0,
    lookY: 0,
    /** @type {"keyboard"|"gamepad"|"touch"} */
    device: "keyboard",

    /** Returns true once per jump press (presses stay buffered for ~0.15 s). */
    consumeJump() {
      if (jumpBufferT <= 0) return false;
      jumpBufferT = 0;
      return true;
    },

    /** Programmatic jump press (touch button, autopilots, smoke test). */
    pressJump() {
      queueJump();
      programmaticHoldT = PROGRAMMATIC_HOLD;
      api.jumpHeld = true; // visible right away, even if update() already ran this frame
    },

    /** Poll gamepads and merge all devices. Call once per frame before the player. */
    update(dt) {
      if (!(dt > 0)) dt = 0;
      polledSinceRender = true;
      pollGamepads(false);

      // Keyboard vector (digital).
      const kx = (has("ArrowRight", "KeyD") ? 1 : 0) - (has("ArrowLeft", "KeyA") ? 1 : 0);
      const kz = (has("ArrowUp", "KeyW") ? 1 : 0) - (has("ArrowDown", "KeyS") ? 1 : 0);

      let mx = kx + padMoveX + touchMoveX;
      let mz = kz + padMoveZ + touchMoveZ;
      const len = Math.hypot(mx, mz);
      if (len > 1) {
        mx /= len;
        mz /= len;
      }
      api.moveX = mx;
      api.moveZ = mz;
      api.run = has("ShiftLeft", "ShiftRight") || padRun || touchRun;
      api.lookX = padLookX;
      api.lookY = padLookY;

      programmaticHoldT = Math.max(0, programmaticHoldT - dt);
      api.jumpHeld = keyJumpHeld || padJumpHeld || touchJumpHeld || programmaticHoldT > 0;
      jumpBufferT = Math.max(0, jumpBufferT - dt);
    },

    /** Remove listeners and DOM (used by preview pages / hot reload). */
    dispose() {
      for (const [target, type, fn, o] of listeners) target.removeEventListener?.(type, fn, o);
      listeners.length = 0;
      if (renderObserver) scene?.onBeforeRenderObservable?.remove(renderObserver);
      touchUI?.root.remove?.();
      document.body?.classList?.remove("touch-ui");
    },
  };

  function has(a, b) {
    return keysDown.has(a) || keysDown.has(b);
  }

  function queueJump() {
    jumpBufferT = JUMP_BUFFER;
  }

  function clearHeld() {
    keysDown.clear();
    keyJumpHeld = false;
    touchJumpHeld = false;
    touchMoveX = 0;
    touchMoveZ = 0;
    programmaticHoldT = 0;
    touchUI?.reset();
  }

  // ---- listener bookkeeping --------------------------------------------
  const listeners = [];
  function listen(target, type, fn, o) {
    if (!target?.addEventListener) return;
    target.addEventListener(type, fn, o);
    listeners.push([target, type, fn, o]);
  }

  // ---- keyboard ---------------------------------------------------------
  function codeOf(e) {
    return e.code || KEY_FALLBACK[e.key] || "";
  }

  listen(window, "keydown", (e) => {
    if (paused || isTypingTarget(e.target)) return;
    const code = codeOf(e);
    const action = KEY_ACTIONS[code];
    if (!action) return;
    // Let browser shortcuts (Cmd+D, Ctrl+W...) through untouched.
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (PREVENT.has(code)) e.preventDefault();
    api.device = "keyboard";
    keysDown.add(code);
    if (action === "jump") {
      keyJumpHeld = true;
      if (!e.repeat) queueJump();
    }
  });

  listen(window, "keyup", (e) => {
    const code = codeOf(e);
    // Always release (even from a text field) so keys never get stuck.
    keysDown.delete(code);
    if (code === "Space") keyJumpHeld = false;
    if (code === "ShiftLeft" || code === "ShiftRight" || e.key === "Shift") {
      keysDown.delete("ShiftLeft");
      keysDown.delete("ShiftRight");
    }
    // macOS swallows keyups of keys released while Cmd is held: start clean.
    if (code === "MetaLeft" || code === "MetaRight" || e.key === "Meta") clearHeld();
    // Stop Space/arrows from activating a focused HUD button on keyup.
    if (!paused && PREVENT.has(code) && !isTypingTarget(e.target)) e.preventDefault();
  });

  listen(window, "blur", clearHeld);
  listen(document, "visibilitychange", () => {
    if (document.hidden) clearHeld();
  });
  events?.on?.("game:pause", (p) => {
    paused = !!p?.paused;
    clearHeld();
  });

  // ---- gamepad ----------------------------------------------------------
  listen(window, "gamepaddisconnected", (e) => {
    const i = e?.gamepad?.index;
    if (i != null) padPrev[i] = null;
  });

  /**
   * Read every connected pad. With `menuOnly` (game paused: the main loop
   * stops calling update), only Start is edge-detected so the pad can unpause.
   */
  function pollGamepads(menuOnly) {
    if (!menuOnly) {
      padMoveX = padMoveZ = padLookX = padLookY = 0;
      padRun = padJumpHeld = false;
    }
    let pads = null;
    try {
      pads = typeof navigator !== "undefined" && navigator.getGamepads ? navigator.getGamepads() : null;
    } catch {
      pads = null; // e.g. blocked by Permissions-Policy
    }
    if (!pads) return;

    for (let i = 0; i < pads.length; i++) {
      const gp = pads[i];
      if (!gp || gp.connected === false || !gp.buttons) continue;
      const b = gp.buttons;
      const prev = padPrev[i] || (padPrev[i] = new Uint8Array(20));
      let active = false;

      const start = padPressed(b, PAD.START);
      if (start && !prev[PAD.START]) emit("game:togglePause");
      prev[PAD.START] = start ? 1 : 0;
      if (menuOnly) continue;

      // Edge-triggered buttons.
      for (let k = 0; k < 6; k++) {
        const now = padPressed(b, k);
        if (now && !prev[k]) {
          active = true;
          if (k === PAD.A) queueJump();
          else if (k === PAD.X) emit("hud:use");
          else if (k === PAD.Y) emit("camera:reset");
          else if (k === PAD.LB) emit("hud:cycle", { dir: -1 });
          else if (k === PAD.RB) emit("hud:cycle", { dir: 1 });
        }
        prev[k] = now ? 1 : 0;
      }

      // Held buttons.
      if (padPressed(b, PAD.A)) padJumpHeld = true;
      if (padPressed(b, PAD.B) || padPressed(b, PAD.RT, TRIGGER_THRESHOLD)) padRun = true;

      // Movement: D-pad wins over the stick when pressed.
      const dx = (padPressed(b, PAD.RIGHT) ? 1 : 0) - (padPressed(b, PAD.LEFT) ? 1 : 0);
      const dz = (padPressed(b, PAD.UP) ? 1 : 0) - (padPressed(b, PAD.DOWN) ? 1 : 0);
      const ax = gp.axes || [];
      if (dx || dz) {
        const n = dx && dz ? Math.SQRT1_2 : 1;
        padMoveX += dx * n;
        padMoveZ += dz * n;
        active = true;
      } else {
        const sx = ax[0] || 0;
        const sy = ax[1] || 0;
        const m = Math.hypot(sx, sy);
        if (m > STICK_DEADZONE) {
          // Radial deadzone, rescaled so motion starts smoothly at the edge.
          const s = Math.min(1, (m - STICK_DEADZONE) / (1 - STICK_DEADZONE)) / m;
          padMoveX += sx * s;
          padMoveZ -= sy * s; // stick up is negative Y
          active = true;
        }
      }

      // Right stick → camera orbit rates.
      const rx = ax[2] || 0;
      const ry = ax[3] || 0;
      const rm = Math.hypot(rx, ry);
      if (rm > LOOK_DEADZONE) {
        const s = Math.min(1, (rm - LOOK_DEADZONE) / (1 - LOOK_DEADZONE)) / rm;
        padLookX += rx * s;
        padLookY += ry * s;
        active = true;
      }

      if (active || padJumpHeld || padRun) api.device = "gamepad";
    }
    padLookX = Math.max(-1, Math.min(1, padLookX));
    padLookY = Math.max(-1, Math.min(1, padLookY));
  }

  // While the HUD pause menu is open main.js stops calling update(); keep
  // watching Start so the gamepad can also resume the game.
  const renderObserver = scene?.onBeforeRenderObservable?.add(() => {
    if (!polledSinceRender) pollGamepads(true);
    polledSinceRender = false;
  });

  // ---- touch controls ---------------------------------------------------
  const touchRoot = document.getElementById?.("touch-root");
  const params = new URLSearchParams(typeof location !== "undefined" ? location.search : "");
  const forced = opts.touch ?? (params.has("touch") ? params.get("touch") !== "0" : undefined);

  function showTouch() {
    if (touchUI || forced === false || !touchRoot) return;
    touchUI = buildTouchControls(touchRoot, {
      onDir(x, z) {
        touchMoveX = x;
        touchMoveZ = z;
        if (x || z) api.device = "touch";
      },
      onJump(down) {
        if (down && !touchJumpHeld) queueJump();
        touchJumpHeld = down;
        if (down) api.device = "touch";
      },
      onRun(on) {
        touchRun = on;
        api.device = "touch";
      },
    });
    document.body?.classList?.add("touch-ui");
    // Next frame: fade the controls in.
    requestAnimationFrame(() => touchUI?.root.classList?.add("is-ready"));
  }

  let coarse = false;
  try {
    coarse = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  } catch {
    coarse = false;
  }
  if (forced === true || (forced === undefined && coarse)) showTouch();
  else if (forced === undefined) {
    const onFirstTouch = () => {
      window.removeEventListener?.("touchstart", onFirstTouch, true);
      showTouch();
      api.device = "touch";
    };
    listen(window, "touchstart", onFirstTouch, { capture: true, passive: true });
  }

  return api;
}

// ---------------------------------------------------------------------------
// Touch controls DOM
// ---------------------------------------------------------------------------

/** SVG path of a plus/cross shape with rounded outer corners and filleted inner corners. */
function crossPath(c0, c1, a0, a1, R, r) {
  return [
    `M${a0 + R} ${c0}H${a1 - R}A${R} ${R} 0 0 1 ${a1} ${c0 + R}V${a0 - r}A${r} ${r} 0 0 0 ${a1 + r} ${a0}`,
    `H${c1 - R}A${R} ${R} 0 0 1 ${c1} ${a0 + R}V${a1 - R}A${R} ${R} 0 0 1 ${c1 - R} ${a1}`,
    `H${a1 + r}A${r} ${r} 0 0 0 ${a1} ${a1 + r}V${c1 - R}A${R} ${R} 0 0 1 ${a1 - R} ${c1}`,
    `H${a0 + R}A${R} ${R} 0 0 1 ${a0} ${c1 - R}V${a1 + r}A${r} ${r} 0 0 0 ${a0 - r} ${a1}`,
    `H${c0 + R}A${R} ${R} 0 0 1 ${c0} ${a1 - R}V${a0 + R}A${R} ${R} 0 0 1 ${c0 + R} ${a0}`,
    `H${a0 - r}A${r} ${r} 0 0 0 ${a0} ${a0 - r}V${c0 + R}A${R} ${R} 0 0 1 ${a0 + R} ${c0}Z`,
  ].join("");
}

const DPAD_SVG = (() => {
  // 160×160 view box; arms 50 wide; 6 px margin keeps the 3 px outline inside.
  const cross = crossPath(6, 154, 55, 105, 14, 7);
  const arrow = (pts) => `<path class="tc-arrow" d="M${pts}Z"/>`;
  return `
<svg class="tc-dpad-svg" viewBox="0 0 160 166" aria-hidden="true">
  <defs>
    <linearGradient id="tcDpadFace" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff"/>
      <stop offset="0.55" stop-color="#fff6e3"/>
      <stop offset="1" stop-color="#f2dfb9"/>
    </linearGradient>
    <linearGradient id="tcDpadHot" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffc163"/>
      <stop offset="1" stop-color="#fb8500"/>
    </linearGradient>
    <clipPath id="tcDpadClip"><path d="${cross}"/></clipPath>
  </defs>
  <path class="tc-dpad-side" d="${cross}" transform="translate(0 6)"/>
  <path class="tc-dpad-face" d="${cross}"/>
  <g clip-path="url(#tcDpadClip)">
    <polygon class="tc-arm" data-arm="up" points="55,0 105,0 105,55 80,80 55,55"/>
    <polygon class="tc-arm" data-arm="down" points="55,160 105,160 105,105 80,80 55,105"/>
    <polygon class="tc-arm" data-arm="left" points="0,55 0,105 55,105 80,80 55,55"/>
    <polygon class="tc-arm" data-arm="right" points="160,55 160,105 105,105 80,80 105,55"/>
    <path class="tc-bevel" d="${cross}" transform="translate(0 3)"/>
  </g>
  <circle class="tc-hub" cx="80" cy="80" r="15"/>
  ${arrow("80 17L93 35H67")}
  ${arrow("80 143L93 125H67")}
  ${arrow("17 80L35 67V93")}
  ${arrow("143 80L125 67V93")}
  <path class="tc-dpad-outline" d="${cross}"/>
</svg>`;
})();

const JUMP_ICON = `<svg class="tc-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4l7 8h-4.5v7h-5v-7H5z"/></svg>`;
const RUN_ICON = `<svg class="tc-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M13.5 2L5 13.5h5.5L9 22l9-12.5h-5.6z"/></svg>`;

/**
 * Build the on-screen controls inside `root` and wire Pointer Events.
 * Each control tracks its own pointer id (with pointer capture) so moving
 * and jumping at the same time works with multi-touch.
 */
function buildTouchControls(root, { onDir, onJump, onRun }) {
  const wrap = document.createElement("div");
  wrap.className = "tc-touch";
  wrap.innerHTML = `
    <div class="tc-dpad" role="group" aria-label="Move">
      <div class="tc-dpad-socket"></div>
      ${DPAD_SVG}
    </div>
    <div class="tc-actions">
      <button type="button" tabindex="-1" class="tc-btn tc-run" aria-label="Run" aria-pressed="false">${RUN_ICON}<span>RUN</span></button>
      <button type="button" tabindex="-1" class="tc-btn tc-jump" aria-label="Jump">${JUMP_ICON}<span>JUMP</span></button>
    </div>`;
  root.appendChild(wrap);

  const dpad = wrap.querySelector(".tc-dpad");
  const jumpBtn = wrap.querySelector(".tc-jump");
  const runBtn = wrap.querySelector(".tc-run");
  const arms = {};
  for (const el of wrap.querySelectorAll(".tc-arm")) arms[el.dataset.arm] = el;

  const capture = (el, e) => {
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      /* pointer already gone */
    }
  };
  const noMenu = (e) => e.preventDefault();
  wrap.addEventListener("contextmenu", noMenu);

  // ---- D-pad: 8-way direction from the touch point relative to the center.
  let dpadPointer = null;
  let cx = 0;
  let cy = 0;
  let dead = 0; // neutral radius around the hub, px
  let sector = -1; // -1 = neutral, 0..7 = E, NE, N, NW, W, SW, S, SE
  const D = Math.SQRT1_2;
  const SECTOR_VEC = [[1, 0], [D, D], [0, 1], [-D, D], [-1, 0], [-D, -D], [0, -1], [D, -D]];
  const SECTOR_ARMS = [["right"], ["up", "right"], ["up"], ["up", "left"], ["left"], ["down", "left"], ["down"], ["down", "right"]];
  const TILT = 9; // degrees the pad rocks toward the pressed direction

  function setSector(s) {
    if (s === sector) return;
    sector = s;
    for (const k in arms) arms[k].classList.remove("is-on");
    if (s < 0) {
      onDir(0, 0);
      dpad.style.setProperty("--tilt-x", "0deg");
      dpad.style.setProperty("--tilt-y", "0deg");
      dpad.classList.remove("is-pressed");
      return;
    }
    for (const k of SECTOR_ARMS[s]) arms[k].classList.add("is-on");
    const [x, z] = SECTOR_VEC[s];
    onDir(x, z);
    dpad.style.setProperty("--tilt-x", `${(z * TILT).toFixed(2)}deg`);
    dpad.style.setProperty("--tilt-y", `${(x * TILT).toFixed(2)}deg`);
    dpad.classList.add("is-pressed");
  }

  function dpadAt(e) {
    const dx = e.clientX - cx;
    const dy = cy - e.clientY; // screen up = +
    if (dx * dx + dy * dy < dead * dead) {
      setSector(-1);
      return;
    }
    // Cardinal sectors are a bit wider (±26°) than diagonals (±19°) so a
    // thumb resting on an arm doesn't drift into a diagonal.
    const ang = Math.atan2(dy, dx); // -π..π, 0 = east
    const deg = ((ang * 180) / Math.PI + 360) % 360;
    const nearestCardinal = Math.round(deg / 90) % 4; // 0 E, 1 N, 2 W, 3 S
    const off = deg - nearestCardinal * 90;
    const diff = Math.abs(((off + 540) % 360) - 180);
    if (diff <= 26) setSector(nearestCardinal * 2);
    else {
      const diag = Math.floor(deg / 90); // 0 NE, 1 NW, 2 SW, 3 SE
      setSector(diag * 2 + 1);
    }
  }

  dpad.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    if (dpadPointer !== null && dpadPointer !== e.pointerId) return;
    dpadPointer = e.pointerId;
    capture(dpad, e);
    const rect = dpad.getBoundingClientRect();
    cx = rect.left + rect.width / 2;
    cy = rect.top + rect.height / 2;
    dead = rect.width * 0.09;
    dpadAt(e);
  });
  dpad.addEventListener("pointermove", (e) => {
    if (e.pointerId === dpadPointer) dpadAt(e);
  });
  const dpadRelease = (e) => {
    if (e.pointerId !== dpadPointer) return;
    dpadPointer = null;
    setSector(-1);
  };
  dpad.addEventListener("pointerup", dpadRelease);
  dpad.addEventListener("pointercancel", dpadRelease);
  dpad.addEventListener("lostpointercapture", dpadRelease);

  // ---- JUMP: held while any pointer is down on it.
  const jumpPointers = new Set();
  jumpBtn.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    capture(jumpBtn, e);
    jumpPointers.add(e.pointerId);
    jumpBtn.classList.add("is-pressed");
    onJump(true);
    // Tiny haptic tick (Android). Only after a user activation, otherwise
    // Chrome logs an intervention warning for the very first touch.
    try {
      if (navigator.userActivation?.hasBeenActive) navigator.vibrate?.(8);
    } catch {
      /* unsupported */
    }
  });
  const jumpRelease = (e) => {
    if (!jumpPointers.delete(e.pointerId)) return;
    if (jumpPointers.size === 0) {
      jumpBtn.classList.remove("is-pressed");
      onJump(false);
    }
  };
  jumpBtn.addEventListener("pointerup", jumpRelease);
  jumpBtn.addEventListener("pointercancel", jumpRelease);
  jumpBtn.addEventListener("lostpointercapture", jumpRelease);

  // ---- RUN: toggle on tap.
  let running = false;
  runBtn.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    running = !running;
    runBtn.classList.toggle("is-on", running);
    runBtn.setAttribute("aria-pressed", String(running));
    onRun(running);
  });

  return {
    root: wrap,
    reset() {
      dpadPointer = null;
      setSector(-1);
      jumpPointers.clear();
      jumpBtn.classList.remove("is-pressed");
      onJump(false);
    },
  };
}

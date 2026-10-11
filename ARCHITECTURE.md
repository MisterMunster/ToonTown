# Toon Town — Architecture & Module Contracts

A Babylon.js (v9.30) 3D demo: a cartoon hero ("Pip") explores a cheerful little
town. Arrow keys / WASD / gamepad D-pad / on-screen touch D-pad to move, Space
to jump (double-jump in the air), HUD with an item hotbar (visual only).

Client: vanilla ES modules bundled by **Vite**. Server: tiny **Express** app
(`server/`) that serves `dist/` behind a password page. Shipped as a **Docker**
image.

## Hard rules for every module

- **Imports:** always `import { X } from "@babylonjs/core"` (package root, not
  deep paths) so no side-effect registration is ever missing. Sky/water etc. may
  come from `@babylonjs/materials` root. No other runtime npm deps.
- **No external assets.** Everything is procedural: meshes from `MeshBuilder` /
  `VertexData`, textures from `DynamicTexture` / `RawTexture` / canvas, sounds
  from WebAudio synthesis. No network fetches at runtime (no Babylon CDN, no
  fonts from the web; the Fredoka font is bundled via `@fontsource/fredoka`).
- **Units:** 1 unit = 1 meter. Y is up. Babylon's left-handed system: +X east
  (right), +Z north (forward), heading/yaw angle θ means forward vector
  `(sin θ, 0, cos θ)`; `mesh.rotation.y = θ` turns local +Z to that direction.
  Right vector for yaw θ is `(cos θ, 0, -sin θ)`.
- **Style:** bright, saturated, toy-like, rounded, matte ("Animal Crossing meets
  a Pixar short"). Colors from `src/game/palette.js`; materials via
  `toonMat(scene, hex, opts)` from `src/game/materials.js` (cached, matte).
  Deterministic randomness via `makeRng(seed)` so the town is identical each load.
- **Performance budget** (must run smoothly on a MacBook Air and a recent phone
  at `quality: "low"`): aim for < 350 draw calls total. Merge static meshes that
  share a material (`Mesh.MergeMeshes`), use instances / thin instances for
  repeated props (trees, lamps, fences, windows), call `freezeWorldMatrix()` on
  static meshes, set `isPickable = false` on everything unless needed,
  `material.freeze()` for static materials whose params never change.
- **Shadows:** call `env.addShadowCaster(meshOrNode)` for things that should
  cast shadows (hero, NPCs, buildings, trees, props). Ground/roads/sidewalks
  should set `receiveShadows = true`. Avoid registering hundreds of tiny meshes
  (merge first).
- **No global keyboard conflicts:** see "Key map" below; only the listed owner
  handles each key.
- **Never throw from `update()`**; guard optional things.
- Plain JS + JSDoc, no TypeScript. Keep each file self-contained and readable.

## Files & owners

| File | Exports |
|---|---|
| `src/main.js` | bootstrap & game loop (wires everything; see below) |
| `src/game/events.js` | `events.on/off/emit` (provided) |
| `src/game/palette.js` | `PALETTE`, `pick`, `makeRng` (provided) |
| `src/game/materials.js` | `toonMat`, `uniqueMat` (provided) |
| `src/game/colliders.js` | `ColliderWorld` (provided, tested) |
| `src/game/environment.js` | `createEnvironment` |
| `src/game/town.js` (+ optional `src/game/town/*.js`) | `createTown` |
| `src/game/character.js` | `createCharacter` |
| `src/game/input.js` + `src/ui/touch.css` | `createInput` |
| `src/game/player.js` | `createPlayer` |
| `src/game/camera.js` | `createCameraRig` |
| `src/game/npcs.js` | `createNPCs` (townsfolk + birds/butterflies) |
| `src/game/collectibles.js` | `createCollectibles` (spinning coins) |
| `src/game/fx.js` | `createFX` (dust, sparkles, confetti particles) |
| `src/game/audio.js` | `createAudio` (WebAudio synth SFX + music) |
| `src/ui/hud.js` + `src/ui/hud.css` (+ `src/ui/icons.js`) | `createHUD` |
| `server/server.js`, `server/login.html` | password-protected static server |
| `Dockerfile`, `docker-compose.yml`, `.dockerignore`, `.env.example` | container |

## Module contracts

### Environment — `createEnvironment(scene, engine, { quality, events })`
Returns:
```js
{
  sun,               // DirectionalLight (also the moon light at night)
  hemi,              // HemisphericLight
  shadowGenerator,   // ShadowGenerator
  addShadowCaster(meshOrNode, includeDescendants = true),
  removeShadowCaster(meshOrNode),
  setupPostProcessing(camera),   // called once after the camera exists
  update(dt, focus),             // focus: Vector3 (player position) — shadow frustum follows it; advances day/night
  timeOfDay,         // number, hours [0, 24)
  nightFactor,       // number 0 (full day) .. 1 (full night) — drives lamps/windows
  setTimeOfDay(hours),
  setQuality(level), // "low" | "medium" | "high"
}
```
Listens: `settings:daynight` `{ mode: "cycle"|"day"|"sunset"|"night" }`,
`settings:quality` `{ level }`. Default mode `"cycle"`, starting at **16:00** so
golden hour → dusk → night happens during a short demo; one full 24h cycle ≈ 8
real minutes. Night stays readable (moonlit blue, not black) but moody: a
deep-blue ambient + cool moon key, warm amber lamp pools, and lit windows,
lamp globes and string lights bright enough to bloom. A night grade driven by
`nightFactor` lowers the bloom threshold and raises bloom weight and vignette
(`env/postfx.js`); dusk (~19:30) is a coral horizon under a violet sky.
Daytime values are untouched by all of this (`nightFactor` = 0).

### Town — `createTown(scene, env, colliders, { quality })`
Builds the whole static world and registers solid things in `colliders`.
Returns:
```js
{
  spawnPoint,        // Vector3 — feet position for the hero (in the town square, facing the fountain)
  spawnHeading,      // radians
  bounds,            // { minX, maxX, minZ, maxZ } playable area; player is clamped inside
  mapFeatures,       // Array<{ kind: "road"|"sidewalk"|"plaza"|"building"|"park"|"water"|"tree",
                     //          x, z, w, d, rot?, color, label?, shape? }>  (x,z = center; w along X, d along Z;
                     //          shape: "circle" = round plaza / pond, drawn as a circle on the minimap)
  landmarks,         // Array<{ name, x, z, icon? }>   e.g. Town Hall, Fountain, Bakery…
  zones,             // Array<{ name, minX, maxX, minZ, maxZ }> area names; first match wins (small zones first)
  npcPaths,          // Array<Array<{ x, z }>> closed obstacle-free loops on sidewalks / park paths (y = 0)
  coinSpots,         // Array<{ x, y, z }> 30–40 coin positions, ~10 on top of platforms/crates to reward jumping
  setNightFactor(f), // 0..1: window glow, street lamp lights, etc.
  update(dt, t),     // animate fountain, flags, windmill… (t = elapsed seconds)
}
```

### Character — `createCharacter(scene, opts)`
Procedural cartoon person built from primitives with a node hierarchy
(hips → torso → head / arms / legs) animated in code. Returns:
```js
{
  root,        // TransformNode — feet at local origin, faces local +Z, ~1.6 m tall
  meshes,      // AbstractMesh[] (for shadow registration)
  state,       // current state string
  setState(s), // "idle"|"walk"|"run"|"jump"|"doubleJump"|"fall"|"land"|"wave"
  update(dt, { speed }),  // speed = horizontal m/s; drives gait cycle rate & blend
  setLookAt(worldPosOrNull), // head turns toward a point (NPCs look at the hero)
  dispose(),
}
```
`opts`: `{ name, preset: "hero"|"random", seed, skin, hair, hairStyle, shirt,
pants, shoes, accessory, scale = 1, outline = true, lod: "high"|"low" }`.

### Input — `createInput(scene, canvas, { events })`
Keyboard + Gamepad API + on-screen touch controls (D-pad + Jump button +
Run toggle; only shown on touch devices; DOM appended to `#touch-root`, styled
in `src/ui/touch.css`). Returns:
```js
{
  moveX, moveZ,   // -1..1, camera-relative intent (x = right, z = forward); diagonal normalized
  run,            // boolean (Shift / gamepad B or right trigger / touch toggle)
  jumpHeld,       // boolean
  consumeJump(),  // returns true once per press (buffered) — player calls this
  pressJump(),    // programmatic jump press (touch button + headless smoke test use it)
  lookX, lookY,   // -1..1 camera orbit rates (gamepad right stick)
  device,         // "keyboard" | "gamepad" | "touch" (last used)
  update(dt),     // poll gamepads etc.; call once per frame
}
```

### Player — `createPlayer(scene, character, input, colliders, { spawn, heading, bounds, events })`
Kinematic character controller (no physics engine). Returns:
```js
{
  root,          // = character.root
  position,      // Vector3 feet position (live reference)
  velocity,      // Vector3
  heading,       // radians
  speed,         // horizontal speed m/s
  grounded,      // boolean
  enabled,       // boolean — when false, ignores input but keeps gravity/animation
  update(dt, cameraYaw),
  teleport(vec3, heading?),
}
```
Emits `player:jump` `{ double, position }`, `player:land` `{ impact, position }`
(impact = downward speed m/s), `player:footstep` `{ run, position }` (position =
a Vector3 copy of the feet position).

### Camera — `createCameraRig(scene, canvas, player, input, colliders, { quality })`
Third-person `ArcRotateCamera` follow cam. Returns:
```js
{
  camera,
  yaw,            // getter: direction the camera looks on XZ, same convention as heading
  update(dt),
  setIntro(on),   // true: slow cinematic orbit around the town square (title screen);
                  // false: swoop smoothly to behind the hero
}
```
For an ArcRotateCamera, `yaw = Math.atan2(-Math.cos(alpha), -Math.sin(alpha))`.
**Remove the camera's built-in keyboard input** (it would steal arrow keys).
Framing: the follow cam aims 2 m above the hero's feet, ~14° below horizontal
(beta 1.33), radius 9, vertical FOV 0.95 (portrait widens up to 1.2), so the
hero sits in the lower-middle of the frame with sky above the rooftops. The
title orbit circles at radius 30 with the lens ~16.5 m up (clear of every roof
and mascot), ~16° down, FOV 1.08; the swoop eases alpha/beta/radius/target/FOV.

### NPCs — `createNPCs(scene, env, colliders, town, { quality, events })`
Returns `{ update(dt, playerPos), positions }` where `positions` is a live
`Array<{ x, z }>` for the minimap. Emits `npc:greet` `{ name, text }`.

### Collectibles — `createCollectibles(scene, env, town, { events })`
Returns `{ update(dt, playerPos), positions, collected, total }` (`positions` =
remaining coins `{ x, z }`). Emits `coin:collected` `{ collected, total, position }`
and `coin:all` when the last one is picked up.

### FX — `createFX(scene, env, { events, quality })`
Particles reacting to events. Returns `{ update(dt) }`.

### Audio — `createAudio({ events })`
Returns `{ update(dt, state), muted, musicOn }`. Unlocks on `game:start`.

### HUD — `createHUD({ root, events, quality })`
All DOM UI (loading screen, title/start screen, HUD, pause menu, toasts). Returns:
```js
{
  setLoading(progress01, message),
  showStartScreen(opts),    // Promise<void>, resolves on click / key / tap;
                            // showStartScreen({ auto: true }) hides loading/title UI and resolves immediately
  setMap(town),             // static minimap features + landmarks
  update(dt, state),        // see below
  toast(text, icon?),
  showZone(name),           // "entering" banner
  paused,                   // getter
}
```
`state = { playerPos, heading, cameraYaw, timeOfDay, nightFactor, speed, grounded,
fps, npcPositions, coinPositions, coins, coinsTotal }`.

## Events (`src/game/events.js`)

| Event | Payload | Emitted by |
|---|---|---|
| `game:start` | — | main (after start screen) |
| `game:pause` | `{ paused }` | HUD |
| `player:jump` | `{ double, position }` | player |
| `player:land` | `{ impact, position }` | player |
| `player:footstep` | `{ run, position }` | player |
| `coin:collected` | `{ collected, total, position }` | collectibles |
| `coin:all` | — | collectibles |
| `npc:greet` | `{ name, text }` | npcs |
| `zone:enter` | `{ name }` | main |
| `hud:slotSelected` | `{ index, item }` | HUD |
| `hud:useItem` | `{ index, item }` | HUD |
| `settings:mute` | `{ muted }` | HUD |
| `settings:music` | `{ on }` | HUD |
| `settings:quality` | `{ level }` | HUD |
| `settings:daynight` | `{ mode }` | HUD |
| `camera:reset` | — | HUD/input (C key) |
| `hud:cycle` | `{ dir }` (-1 / +1) | input (gamepad LB/RB) |
| `hud:use` | — | input (gamepad X) |
| `game:togglePause` | — | input (gamepad Start) |

## Key map (owner in brackets)

- Arrows / WASD: move [input] · Shift: run [input] · Space: jump [input]
- Mouse drag: orbit camera · Wheel / pinch: zoom [camera]
- 1–8: select hotbar slot · Q / E: previous / next slot · F or click slot: use item
  ("coming soon" toast) [HUD]
- N: cycle time of day mode · M: mute · H: toggle controls help · Esc / P: pause
  menu · C: reset camera behind hero [HUD emits events]
- Gamepad: left stick / D-pad move, A jump, B / RT run, right stick camera,
  LB / RB cycle hotbar, X use item, Start pause [input handles movement; HUD polls
  nothing — input emits `hud:cycle` `{ dir }`, `hud:use`, `game:togglePause` for
  those buttons and the HUD listens]

## Game loop (`src/main.js`)

Per frame (dt clamped to 1/20 s): `input.update` → `player.update(dt, cam.yaw)`
→ `cameraRig.update` → `env.update(dt, player.position)` →
`town.setNightFactor(env.nightFactor)` + `town.update` → `npcs.update` →
`collectibles.update` → `fx.update` → `audio.update` → zone check →
`hud.update` → `scene.render()`.
Before the start screen is dismissed the camera runs its intro orbit and the
player is disabled.

## Testing

- `node tools/smoke-run.mjs` — headless NullEngine build + ~10 s simulated play
  using every module that exists (missing ones are stubbed). Use
  `--only town,character` to test specific modules with the rest stubbed. It
  overwrites `input.moveX/moveZ/run` after `input.update()` and calls
  `input.pressJump()`, so the input object's fields must be plain writable
  properties (not getter-only).
- `npx vite build` — bundling / import resolution check.
- `tools/shot.sh <path> <out.png> [virtual_ms] [WxH]` — headless Chrome (SwiftShader
  WebGL) screenshot of a page on the Vite dev server (http://localhost:5173, already
  running) + the page's console output. View the PNG with the Read tool. Runs in a
  throwaway profile, so several agents can use it in parallel. Examples:
  `tools/shot.sh "/?autostart=1" /tmp/x.png 60000`, `tools/shot.sh "/?autostart=1&time=21" ...`,
  `tools/shot.sh /tools/preview/character.html /tmp/c.png`.
  Headless virtual time races ahead of `requestAnimationFrame`, so the game only
  renders ~1 frame before the capture: use the debug params `?demo=1` (autopilot
  that drives the input object) and `?ff=SECONDS` (synchronous fast-forward after
  start) to capture gameplay, e.g. `/?autostart=1&demo=1&ff=2.45` = mid double-jump.
  `?autostart=1` skips the title *and* the camera intro (the rig starts in follow
  mode). `window.toonTown` (set before the title screen) exposes every module for
  console / CDP-driven tests.
- `tools/preview/<name>.html` — per-module visual test pages (served by Vite).

## Quality levels

`low` (touch devices / `?quality=low`): hardware scaling 1.0, 1024 shadow map,
no SSAO, FXAA only, fewer NPCs/particles. `medium`: DPR ≤ 1.25, 2048 shadows,
bloom. `high` (desktop default): DPR ≤ 1.75, 2048 shadows, bloom, MSAA/FXAA,
vignette. SSAO is implemented but opt-in (`createEnvironment(..., { ssao: true })`):
its gain on the flat toon look is small for the cost.

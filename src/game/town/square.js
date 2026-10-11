// Town Square: paved round plaza with a compass-rose pattern, a three-tier
// fountain (water curtains, arcing jets from frog statues, spray particles,
// ripple rings), benches, planters, festoon bunting with fairy lights that
// sway in the breeze, and the only four real point lights in town.
import { Matrix, Vector3, Color3, Color4, StandardMaterial, ParticleSystem, DynamicTexture, PointLight } from "@babylonjs/core";
import { PALETTE } from "../palette.js";
import { PLAZA_R, PLAZA_Y, CURB_H } from "./layout.js";
import { T, soloMesh, rgb, shade as shadeC } from "./geo.js";
import { COL, bench, lamp, planter, cafeTable, flowerBed, trashCan } from "./props.js";

const TAU = Math.PI * 2;
const Y0 = PLAZA_Y;
// fountain heights (absolute)
export const FOUNTAIN = {
  rim: Y0 + 0.64,
  rimR: 5.45,
  tier2: Y0 + 2.02,
  tier2R: 2.4,
  top: Y0 + 3.02,
  topR: 1.2,
};
const STONE = "#ece6da";
const STONE_DK = "#cfc6b4";
const pol = (r, a) => [Math.sin(a) * r, Math.cos(a) * r];

function plaza(ctx) {
  const { root, colliders, map } = ctx;
  // the base top shows through the gaps between tiles as darker grout
  root.shape("flat", T.cyl(64, 1), PALETTE.curb, 0, (Y0 - 0.06) / 2, 0, PLAZA_R * 2, Y0 + 0.06, PLAZA_R * 2, null, { top: "#d6c4a2" });
  colliders.addCylinder(0, 0, PLAZA_R, 0, Y0, "platform");
  map.push({ kind: "plaza", x: 0, z: 0, w: PLAZA_R * 2, d: PLAZA_R * 2, color: PALETTE.plaza, shape: "circle", label: "Town Square" });
  const y = Y0 + 0.006;
  const acc = PALETTE.plazaAccent;
  // paving: rings of stone tiles with a subtle per-tile tint
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (const [r0, r1] of [[6.7, 7.7], [7.7, 8.7], [8.7, 9.7], [9.7, 10.7], [11.3, 12.3], [12.3, 13.3], [13.3, 14.3], [14.3, PLAZA_R - 0.75]]) {
    const n = Math.round((TAU * (r0 + r1)) / 2 / 1.25);
    const off = rnd() * TAU;
    for (let i = 0; i < n; i++) {
      const k = 0.94 + rnd() * 0.09;
      const a0 = off + (i / n) * TAU + 0.004;
      const a1 = off + ((i + 1) / n) * TAU - 0.004;
      root.ring("flat", shadeC(PALETTE.plaza, k), 0, Y0 + 0.003, 0, r0 + 0.03, r1 - 0.03, a0, a1, 2);
    }
  }
  root.ring("flat", "#c9b28a", 0, y, 0, PLAZA_R - 0.75, PLAZA_R - 0.05, 0, TAU, 64);
  root.ring("flat", acc, 0, y, 0, 10.7, 11.3, 0, TAU, 56);
  // radial joints in the outer band
  for (let i = 0; i < 32; i++) {
    const a = (i / 32) * TAU;
    const [x, z] = pol(13.25, a);
    root.flat("flat", acc, x, y, z, 0.06, 3.9, a);
  }
  // checker ring around the fountain
  for (let i = 0; i < 32; i++) {
    const a0 = (i / 32) * TAU;
    root.ring("flat", i % 2 ? "#f3e6cc" : acc, 0, y + 0.002, 0, 5.7, 6.7, a0, a0 + TAU / 32, 2);
  }
  // compass rose between the rings
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU;
    const long = i % 2 === 0;
    const r1 = long ? 10.5 : 9.0;
    const half = long ? 0.42 : 0.3;
    const tip = pol(r1, a);
    const l = pol(6.9, a - half);
    const r = pol(6.9, a + half);
    const col = i === 0 ? "#e05d5d" : long ? "#d9a066" : "#e8c58f";
    root.poly("flat", col, [[l[0], y + 0.004, l[1]], [tip[0], y + 0.004, tip[1]], [r[0], y + 0.004, r[1]]], [0, 1, 0]);
  }
  // paved corner courts where the plaza meets the shop blocks
  const court = "#eadcc0";
  root.ring("flat", court, 0, CURB_H + 0.007, 0, PLAZA_R - 0.2, 21.5, 0.33, Math.PI / 2 - 0.33, 16);
  root.ring("flat", court, 0, CURB_H + 0.007, 0, PLAZA_R - 0.2, 21.5, -Math.PI / 2 + 0.33, -0.33, 16);
}

function fountain(ctx) {
  const { root: f, colliders, scene, mats, quality } = ctx;
  const F = FOUNTAIN;
  // plinth step + basin wall + rim
  f.shape("solid", T.cyl(48, 1), STONE_DK, 0, Y0 + 0.06, 0, 11.6, 0.12, 11.6, null, { top: STONE });
  f.shape("solid", T.cyl(48, 1, 0), STONE, 0, Y0 + 0.3, 0, 10.6, 0.6, 10.6, null, { grad: [Y0, Y0 + 0.6, 0.85, 1] });
  f.shape("solid", T.cyl(48, 1, 0), "#4fb3e8", 0, Y0 + 0.32, 0, 10.64, 0.12, 10.64);
  f.shape("solid", T.cyl(48, 1, 0), STONE, 0, F.rim - 0.06, 0, F.rimR * 2, 0.12, F.rimR * 2);
  f.ring("solid", "#f6f1e7", 0, F.rim, 0, 4.85, F.rimR, 0, TAU, 48);
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * TAU;
    const [x, z] = pol(5.32, a);
    f.box("solid", STONE_DK, x, Y0 + 0.3, z, 0.18, 0.6, 0.06, [0, a, 0]);
  }
  f.disc("water", null, 0, Y0 + 0.56, 0, 4.92, 40, 3);
  // pedestal + tier 2
  f.cylB("solid", STONE, 0, Y0 + 0.5, 0, 1.7, 0.3, 16, 0.7);
  f.cylB("solid", STONE, 0, Y0 + 0.8, 0, 1.1, 0.8, 16, 0.9);
  f.cylB("solid", "#4fb3e8", 0, Y0 + 1.05, 0, 1.1, 0.1, 16);
  f.shape("solid", T.cyl(32, 3.3), STONE, 0, Y0 + 1.75, 0, 1.4, 0.4, 1.4, null, { grad: [Y0 + 1.55, Y0 + 1.95, 0.8, 1] });
  f.ring("solid", "#f6f1e7", 0, F.tier2, 0, 2.1, F.tier2R, 0, TAU, 32);
  f.shape("solid", T.cyl(32, 1, 0), STONE, 0, F.tier2 - 0.06, 0, F.tier2R * 2, 0.12, F.tier2R * 2);
  f.disc("water", null, 0, F.tier2 - 0.05, 0, 2.12, 28, 3);
  // upper pedestal + top bowl + finial
  f.cylB("solid", STONE, 0, F.tier2 - 0.06, 0, 0.6, 0.76, 12, 0.85);
  f.shape("solid", T.cyl(24, 3.8), STONE, 0, F.top - 0.2, 0, 0.6, 0.3, 0.6);
  f.ring("solid", "#f6f1e7", 0, F.top, 0, 1.0, F.topR, 0, TAU, 24);
  f.shape("solid", T.cyl(24, 1, 0), STONE, 0, F.top - 0.05, 0, F.topR * 2, 0.1, F.topR * 2);
  f.disc("water", null, 0, F.top - 0.04, 0, 1.02, 20, 3);
  f.cylB("solid", STONE, 0, F.top - 0.04, 0, 0.3, 0.3, 10, 0.7);
  f.sphere("solid", "#f2c14e", 0, F.top + 0.42, 0, 0.42, 0.5, 0.42, 6);
  f.cyl("solid", "#f2c14e", 0, F.top + 0.75, 0, 0.18, 0.25, 8, 0.2);
  // water curtains falling from each bowl
  f.shape("stream", T.cyl(40, 2.42 / 2.75, 0), null, 0, (F.tier2 + Y0 + 0.56) / 2, 0, 5.5, F.tier2 - Y0 - 0.56, 5.5);
  f.shape("stream", T.cyl(28, 1.24 / 1.45, 0), null, 0, (F.top + F.tier2) / 2 - 0.03, 0, 2.9, F.top - F.tier2, 2.9);
  // four frog statues spitting arcs into the basin
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i / 4) * TAU;
    const [x, z] = pol(5.12, a);
    const fr = f.child(x, F.rim, z, a + Math.PI);
    fr.sphere("solid", "#6bcb77", 0, 0.25, 0, 0.62, 0.48, 0.66, 6);
    fr.sphere("solid", "#7ed98a", 0, 0.55, 0.12, 0.5, 0.4, 0.46, 6);
    for (const s of [-1, 1]) {
      fr.sphere("solid", "#ffffff", s * 0.15, 0.72, 0.18, 0.2, 0.2, 0.2, 5);
      fr.sphere("solid", "#1d2b3a", s * 0.15, 0.73, 0.27, 0.09, 0.09, 0.06, 4);
      fr.sphere("solid", "#5fb36a", s * 0.28, 0.08, 0.22, 0.24, 0.12, 0.3, 4);
    }
    fr.box("solid", "#3f8f45", 0, 0.48, 0.34, 0.24, 0.04, 0.06);
    const path = [];
    const sx = Math.sin(a);
    const sz = Math.cos(a);
    for (let k = 0; k <= 14; k++) {
      const t = k / 14;
      const r = 4.95 - t * 1.75;
      const yy = F.rim + 0.5 + t * (-0.55) + Math.sin(t * Math.PI) * 0.95;
      path.push([sx * r, yy, sz * r]);
    }
    f.tube("stream", null, path, 0.07, 6, 0.8);
  }
  colliders.addCylinder(0, 0, F.rimR, 0, F.rim, "platform");
  colliders.addCylinder(0, 0, F.tier2R, 0, F.tier2, "platform");
  colliders.addCylinder(0, 0, F.topR, 0, F.top, "platform");
  colliders.addCylinder(0, 0, 0.22, 0, F.top + 0.85, "prop");
  // frogs are little bumps on the rim (walk around them)
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i / 4) * TAU;
    const [x, z] = pol(5.12, a);
    colliders.addCylinder(x, z, 0.32, F.rim, F.rim + 0.75, "prop");
  }

  // ---- spray particles from the top spout ---------------------------------
  const dropTex = new DynamicTexture("town_dropTex", { width: 64, height: 64 }, scene, false);
  const dctx = dropTex.getContext();
  const g = dctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.4, "rgba(220,245,255,0.9)");
  g.addColorStop(1, "rgba(200,240,255,0)");
  dctx.fillStyle = g;
  dctx.fillRect(0, 0, 64, 64);
  dropTex.update(true);
  dropTex.hasAlpha = true;
  const ps = new ParticleSystem("town_fountainSpray", quality === "low" ? 120 : 360, scene);
  ps.particleTexture = dropTex;
  ps.emitter = new Vector3(0, F.top + 0.85, 0);
  ps.createConeEmitter(0.08, 0.32);
  ps.minEmitPower = 2.6;
  ps.maxEmitPower = 3.4;
  ps.gravity = new Vector3(0, -9.81, 0);
  ps.minLifeTime = 0.5;
  ps.maxLifeTime = 0.8;
  ps.minSize = 0.08;
  ps.maxSize = 0.2;
  ps.emitRate = quality === "low" ? 140 : 380;
  ps.color1 = new Color4(0.85, 0.96, 1, 0.9);
  ps.color2 = new Color4(0.7, 0.9, 1, 0.8);
  ps.colorDead = new Color4(0.7, 0.9, 1, 0);
  ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
  ps.preWarmCycles = 60;
  ps.start();

  // ---- ripple rings on the basin -------------------------------------------
  const rippleMat = new StandardMaterial("town_ripple", scene);
  rippleMat.diffuseColor = new Color3(1, 1, 1);
  rippleMat.emissiveColor = new Color3(0.75, 0.85, 0.9);
  rippleMat.specularColor = new Color3(0, 0, 0);
  rippleMat.alpha = 0.7;
  rippleMat.disableLighting = true;
  const ripples = [];
  for (let i = 0; i < 3; i++) {
    const m = soloMesh(scene, `town_ripple${i}`, rippleMat, (fr) => fr.ring("m", null, 0, 0, 0, 0.93, 1, 0, TAU, 40), { colors: false });
    m.position.set(0, Y0 + 0.575, 0);
    ripples.push(m);
  }

  ctx.anim.push((dt, t) => {
    for (let i = 0; i < ripples.length; i++) {
      const p = (t * 0.35 + i / ripples.length) % 1;
      const r = 2.85 + p * 1.9;
      const m = ripples[i];
      m.scaling.set(r, 1, r);
      m.visibility = 0.65 * (1 - p) * Math.min(1, p * 6);
    }
  });
}

/** Festoon bunting + fairy lights strung across the square on 8 poles. */
function bunting(ctx) {
  const { root: f, scene, mats } = ctx;
  const poleR = 14.8;
  // Tall enough that the strings (lowest flag tip ≈ 7.1 m) stay above the
  // follow camera (≈ 5 m, ≈ 6.5 m at the top of a double jump), so pennants
  // never fill the screen while Pip plays in the square.
  const poleH = 8.6;
  const poles = [];
  for (let i = 0; i < 8; i++) {
    const a = Math.PI / 8 + (i / 8) * TAU;
    const [x, z] = pol(poleR, a);
    planter(ctx, f, x, Y0, z, 1.5, i);
    f.cylB("solid", COL.white, x, Y0 + 0.6, z, 0.14, poleH - 0.6, 8);
    f.sphere("solid", COL.gold, x, Y0 + poleH + 0.08, z, 0.26, 0.26, 0.26, 6);
    ctx.colliders.addCylinder(x, z, 0.12, Y0, Y0 + poleH, "prop");
    poles.push([x, Y0 + poleH - 0.15, z]);
  }
  const flagCols = ["#ff5d5d", "#ffd93d", "#4d96ff", "#6bcb77", "#ff8c42", "#c77dff", "#ff6b9d", "#00b4d8"];
  const bulbCols = ["#fff2c4", "#ffd27a", "#ffb3c6", "#fff2c4", "#b9f3ff"];
  const flags = [];
  // four strings forming a square canopy around the fountain
  for (let i = 0; i < 8; i += 2) {
    const A = poles[i];
    const B = poles[(i + 3) % 8];
    const len = Math.hypot(B[0] - A[0], B[2] - A[2]);
    const sag = 1.0;
    const pt = (t) => [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t - sag * 4 * t * (1 - t), A[2] + (B[2] - A[2]) * t];
    const path = [];
    for (let k = 0; k <= 24; k++) path.push(pt(k / 24));
    f.tube("solid", "#3a3f4a", path, 0.022, 4);
    const yaw = Math.atan2(B[0] - A[0], B[2] - A[2]);
    const nFlags = Math.floor(len / 0.85);
    for (let k = 1; k < nFlags; k++) {
      const t = k / nFlags;
      const p = pt(t);
      flags.push({ p, yaw: yaw + Math.PI / 2, phase: i * 1.7 + k * 0.45, col: flagCols[(k + i) % flagCols.length] });
      if (k % 2 === 0) {
        const q = pt(t + 0.5 / nFlags);
        f.sphere("fairy", bulbCols[(k / 2 + i / 2) % bulbCols.length], q[0], q[1] - 0.1, q[2], 0.16, 0.19, 0.16, 3);
      }
    }
  }
  // flags: one thin-instanced pennant mesh with per-instance colour
  const flag = soloMesh(scene, "town_flags", mats.cloth, (fr) => {
    fr.poly("m", "#ffffff", [[-0.22, 0, 0], [0.22, 0, 0], [0, -0.5, 0]], [0, 0, 1]);
  });
  const n = flags.length;
  const matrices = new Float32Array(n * 16);
  const colors = new Float32Array(n * 4);
  const tmp = new Matrix();
  const writeMatrices = (t) => {
    for (let i = 0; i < n; i++) {
      const fl = flags[i];
      const sway = 0.28 * Math.sin(t * 2.1 + fl.phase) + 0.12 * Math.sin(t * 3.7 + fl.phase * 1.3);
      Matrix.RotationYawPitchRollToRef(fl.yaw, sway, 0, tmp);
      tmp.setTranslationFromFloats(fl.p[0], fl.p[1], fl.p[2]);
      tmp.copyToArray(matrices, i * 16);
    }
  };
  flags.forEach((fl, i) => {
    const c = rgb(fl.col);
    colors.set([c[0], c[1], c[2], 1], i * 4);
  });
  writeMatrices(0);
  flag.thinInstanceSetBuffer("matrix", matrices, 16, false);
  flag.thinInstanceSetBuffer("color", colors, 4, true);
  flag.alwaysSelectAsActiveMesh = true;
  ctx.anim.push((dt, t) => {
    writeMatrices(t);
    flag.thinInstanceBufferUpdated("matrix");
  });
}

function furniture(ctx) {
  const { root: f } = ctx;
  // benches facing the fountain
  for (const deg of [30, 60, 120, 150, 210, 240, 300, 330]) {
    const a = (deg * Math.PI) / 180;
    const [x, z] = pol(13.2, a);
    bench(ctx, f, x, Y0, z, a + Math.PI);
  }
  // trash cans beside two benches
  for (const deg of [96, 264]) {
    const a = (deg * Math.PI) / 180;
    const [x, z] = pol(13.6, a);
    trashCan(ctx, f, x, Y0, z);
  }
  // lamps on the diagonals: these hold the square's four real point lights
  const lights = [];
  for (const deg of [45, 135, 225, 315]) {
    const a = (deg * Math.PI) / 180;
    const [x, z] = pol(14.2, a);
    lights.push(lamp(ctx, f, x, Y0, z, { poolR: 5 }));
  }
  ctx.squareLamps = lights;
  // café terrace on the NW corner court, flower beds on the NE court
  const cafeCols = ["#e05d5d", "#4d96ff", "#3fa66b"];
  [-38, -50, -62].forEach((deg, i) => {
    const a = (deg * Math.PI) / 180;
    const [x, z] = pol(20.6, a);
    cafeTable(ctx, f, x, CURB_H, z, cafeCols[i], i * 0.7);
  });
  for (const [deg, r] of [[40, 20.6], [57, 20.8]]) {
    const a = (deg * Math.PI) / 180;
    const [x, z] = pol(r, a);
    flowerBed(ctx, f, x, CURB_H, z, 1.3, deg);
  }
}

/**
 * Build the square. Point lights are created by `attachSquareLights` once the
 * merged meshes exist (they only light the central chunk).
 */
export function buildSquare(ctx) {
  plaza(ctx);
  fountain(ctx);
  bunting(ctx);
  furniture(ctx);
  ctx.landmarks.push({ name: "Fountain", x: 0, z: 0, icon: "⛲" });
}

/** Create the 4 plaza point lights restricted to `meshes`. Returns them. */
export function attachSquareLights(ctx, meshes) {
  const out = [];
  (ctx.squareLamps ?? []).forEach((p, i) => {
    const l = new PointLight(`town_plazaLight${i}`, new Vector3(p[0], p[1] - 0.1, p[2]), ctx.scene);
    // Deeper amber with a shorter range: distinct warm pools around each lamp
    // instead of a wash over the whole square. Kept moderate because the
    // additive pool decal under the lamp stacks on top (the sum stays under
    // the night bloom threshold, so only the bulbs glow).
    l.diffuse = Color3.FromHexString(PALETTE.lampGlow).multiplyByFloats(0.8, 0.7, 0.56);
    l.specular = new Color3(0.15, 0.12, 0.08);
    l.range = 12.5;
    l.intensity = 0;
    l.includedOnlyMeshes = meshes;
    out.push(l);
  });
  return out;
}

// Builds all of a character's geometry into one PartBuffer: head & face,
// eyes (eyeball + blinking lid), hair styles, headwear, clothes, shoes and
// accessories. Everything is authored in a joint's local space and tagged
// with that joint's bone, so the result skins as rigid parts.

import {
  PartBuffer, star, superR, implicitR, blob, lathe, capsule, tube, ring, spline,
  affine, compose, frameAt, tangentDir, frameDir, IDENTITY_FRAME,
  norm3, add3, sub3, mul3, dot3, cross3, rgb, mix, shade, clamp, lerp, smoothstep, TAU,
} from "./geometry.js";

const OUTLINE = "#1d2b3a";
const LASH = "#2a1d18";
const MOUTH = "#7b2a35";
const TONGUE = "#ff8593";
const TEETH = "#fffdf8";

// ------------------------------------------------------- outline shapes ---

/** Polar outline (θmax as a function of φ) of an ellipse with radii a (x) and b (up). */
const ellipseOutline = (a, b) => (ph) => (a * b) / Math.hypot(b * Math.cos(ph), a * Math.sin(ph));

/**
 * Polar outline of a polygon (tangent-plane angles [s, t]) as seen from its
 * centroid. Returns { fn, cs, ct } where (cs, ct) is the centroid.
 */
function polyOutline(pts) {
  let cs = 0;
  let ct = 0;
  for (const [s, t] of pts) {
    cs += s;
    ct += t;
  }
  cs /= pts.length;
  ct /= pts.length;
  const N = 256;
  const table = new Float32Array(N + 1);
  for (let k = 0; k <= N; k++) {
    const a = (k / N) * TAU;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    let best = 0;
    for (let j = 0; j < pts.length; j++) {
      const p = pts[j];
      const q = pts[(j + 1) % pts.length];
      const ex = q[0] - p[0];
      const ey = q[1] - p[1];
      const px = p[0] - cs;
      const py = p[1] - ct;
      const den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-9) continue;
      const t = (px * ey - py * ex) / den;
      const u = (px * dy - py * dx) / den;
      if (t > 0 && u >= -1e-6 && u <= 1 + 1e-6) best = Math.max(best, t);
    }
    table[k] = best;
  }
  const fn = (ph) => {
    let x = (((ph % TAU) + TAU) % TAU) / TAU * N;
    const k = Math.floor(x);
    x -= k;
    return lerp(table[k], table[Math.min(N, k + 1)], x);
  };
  return { fn, cs, ct };
}

/** Sample a closed curve f(α) -> [s, t] into polygon points. */
function curvePoly(f, n = 48) {
  const out = [];
  for (let k = 0; k < n; k++) out.push(f(k / n));
  return out;
}

// ------------------------------------------------------------- builder ----

/**
 * @param {object} look  resolved look (see looks.js)
 * @param {object} rig   from buildRig
 * @param {object} dims, head, face  from rig.js
 * @param {{lod:"high"|"low", outline:boolean}} q
 */
export function buildGeometry(look, rig, dims, head, face, q) {
  const hi = q.lod !== "low";
  const S = (h, l) => (hi ? h : l);
  const OL = q.outline ? (hi ? 0.0105 : 0.009) : 0;
  const buf = new PartBuffer();

  const put = (geo, bone, color, o = {}) =>
    buf.add(geo, {
      bone: rig.index[bone],
      bind: rig.binds[bone],
      place: o.place,
      color,
      outline: o.outline ? OL * (o.olScale ?? 1) : 0,
      outlineColor: OUTLINE,
    });
  /** Placement for geometry authored relative to the head center, for a bone hanging off the head. */
  const headPlace = (bone, extra) => {
    const bp = rig.rest[bone].pos;
    const t = bone === "head" ? head.center : sub3(head.center, [bp.x, bp.y, bp.z]);
    return extra ? compose(affine(t), extra) : affine(t);
  };

  const skin = rgb(look.skin);
  const hair = rgb(look.hair);
  const brow = mix(shade(hair, 0.62), "#2a1a12", 0.35);
  const shirt = rgb(look.shirt);
  const shirtDark = shade(shirt, 0.86);
  const pants = rgb(look.pants);

  // ----------------------------------------------------------------- head
  const headGeo = star({ R: head.R, segU: S(56, 26), segV: S(36, 16) });
  put(headGeo, "head", skin, { place: affine(head.center), outline: true });

  // neck (hidden mostly by the collar/head)
  put(capsule({ y0: 0.27, y1: 0.35, r0: 0.062, r1: 0.06, segs: S(14, 8), rings: 3 }), "spine", shade(skin, 0.94));

  // ears (hidden under a bob)
  const showEars = look.hairStyle !== "bob";
  if (showEars) {
    for (const side of [-1, 1]) {
      const d = face.earDir(side);
      const p = head.surf(d, -0.012);
      const place = affine(p, [0, side * 0.35, side * 0.12]);
      const earR = superR(0.034, 0.058, 0.046);
      put(star({ R: earR, segU: S(20, 10), segV: S(12, 6) }), "head", skin, { place, outline: true });
      if (hi) {
        const inner = star({ R: earR, frame: frameAt([side, 0, 0.25]), thetaMax: ellipseOutline(0.62, 0.85), offset: 0.0015, segU: 18, segV: 4 });
        put(inner, "head", mix(skin, "#e07a6a", 0.32), { place });
      }
    }
  }

  // nose
  {
    const d = face.noseDir;
    const p = head.surf(d, -0.014);
    put(blob(0.027, 0.021, 0.021, S(10, 6)), "head", mix(skin, "#ee8f78", 0.22), { place: affine(p, [-0.2, 0, 0]), outline: hi, olScale: 0.5 });
  }

  // decals on the head surface (conform exactly, tiny offset -> no z-fighting)
  const decal = (dir, outlineFn, color, off = 0.0016, segs = [S(28, 14), S(6, 3)], bone = "head") => {
    const g = star({ R: head.R, frame: frameAt(dir), thetaMax: outlineFn, offset: off, segU: segs[0], segV: segs[1] });
    put(g, bone, color, { place: headPlace(bone) });
  };

  // rosy cheeks
  const blushC = mix(skin, "#ff6f7d", clamp(look.blush ?? 0.4, 0, 1));
  for (const side of [-1, 1]) decal(face.cheekDir(side), ellipseOutline(0.105, 0.062), blushC, 0.0012);
  if (look.freckles && hi) {
    const fc = mix(skin, "#8a4a2a", 0.45);
    for (const side of [-1, 1]) {
      const fr = frameAt(face.cheekDir(side));
      for (const [s, t] of [[-0.05, 0.035], [0.0, 0.05], [0.05, 0.03], [0.025, 0.0]]) decal(tangentDir(fr, s * side, t), ellipseOutline(0.011, 0.011), fc, 0.0022, [10, 2]);
    }
  }

  // eyebrows: arched strokes hugging the forehead (own bone so they can lift)
  for (const side of [-1, 1]) {
    const fr = frameAt(face.browDir(side));
    const pts = [];
    const n = S(11, 7);
    for (let k = 0; k < n; k++) {
      const u = k / (n - 1);
      const s = lerp(-0.085, 0.085, u);
      const t = 0.022 * (1 - (s / 0.085) ** 2) - 0.01 * ((side * s) / 0.085);
      const d = tangentDir(fr, s, t);
      pts.push(head.surf(d, 0.004));
    }
    const geo = tube({
      path: pts,
      radius: (u) => {
        const towardInner = side > 0 ? 1 - u : u;
        return (0.0078 + 0.0042 * towardInner) * Math.sqrt(Math.max(0.02, Math.sin(Math.PI * u)));
      },
      segs: S(8, 5),
    });
    put(geo, "brows", brow, { place: headPlace("brows", affine(mul3(head.center, -1))) });
  }

  // a bushy mustache for some elder townsfolk (on the head bone, above the mouth)
  if (look.mustache) {
    const fr = frameAt(norm3([0, -0.262, 0.965]));
    for (const side of [-1, 1]) {
      const pts = [];
      for (let k = 0; k < 9; k++) {
        const u = k / 8;
        const s = side * lerp(0.005, 0.27, u);
        pts.push(head.surf(tangentDir(fr, s, 0.02 * Math.sin(Math.PI * u) - 0.075 * u * u), 0.012 - 0.008 * u));
      }
      const g = tube({ path: pts, radius: (u) => 0.026 * Math.sqrt(Math.max(0.03, 1 - u)) * (0.8 + 0.4 * Math.sin(Math.PI * Math.min(1, u + 0.25))), segs: S(10, 6) });
      put(g, "head", mix(hair, "#ffffff", 0.08), { place: headPlace("head", affine(mul3(head.center, -1))), outline: true, olScale: 0.7 });
    }
  }

  // mouths: A = resting expression, B = excited open mouth (swapped by scaling bones)
  buildMouth(look.mouth, "mouthA");
  buildMouth("open", "mouthB");

  function buildMouth(kind, bone) {
    const fr = frameAt(face.mouthDir);
    const place = headPlace(bone, affine(mul3(head.center, -1))); // for head-bone-space points
    const decalPlace = headPlace(bone); // for head-center-space surfaces
    const onSurf = (s, t, off) => head.surf(tangentDir(fr, s, t), off);
    const mouthDecal = (pts, color, off) => {
      const { fn, cs, ct } = polyOutline(pts);
      const g = star({ R: head.R, frame: frameAt(tangentDir(fr, cs, ct)), thetaMax: fn, offset: off, segU: S(40, 18), segV: S(6, 3) });
      put(g, bone, color, { place: decalPlace });
    };
    if (kind === "smile") {
      const pts = [];
      const n = S(13, 7);
      for (let k = 0; k < n; k++) {
        const u = k / (n - 1);
        const s = lerp(-0.075, 0.075, u);
        pts.push(onSurf(s, 0.028 * (s / 0.075) ** 2 - 0.01, 0.003));
      }
      put(tube({ path: pts, radius: (u) => 0.0068 * Math.sqrt(Math.max(0.05, Math.sin(Math.PI * u))), segs: S(8, 5) }), bone, MOUTH, { place });
      return;
    }
    // "D"-shaped open smile: gently curved top edge, round bottom
    const dSmile = (W, depth, curve) => {
      const top = (s) => curve * (s / W) ** 2 - 0.008;
      const poly = curvePoly((a) => {
        if (a < 0.5) {
          const s = lerp(-W, W, a * 2);
          return [s, top(s)];
        }
        const b = (a - 0.5) * 2 * Math.PI;
        return [W * Math.cos(b), top(W) - 0.02 - depth * Math.sin(b) ** 0.9];
      }, S(64, 32));
      mouthDecal(poly, MOUTH, 0.0018);
      return top;
    };
    if (kind === "grin") {
      // wide smile with teeth and tongue
      const top = dSmile(0.15, 0.088, 0.03);
      const teeth = curvePoly((a) => {
        if (a < 0.5) {
          const s = lerp(-0.1, 0.1, a * 2);
          return [s, top(s) - 0.001];
        }
        const s = lerp(0.1, -0.1, (a - 0.5) * 2);
        return [s, top(s) - 0.024 + 0.008 * (s / 0.1) ** 2];
      }, 32);
      mouthDecal(teeth, TEETH, 0.0028);
      mouthDecal(curvePoly((a) => [0.064 * Math.cos(a * TAU), -0.079 + 0.024 * Math.sin(a * TAU)], 28), TONGUE, 0.0028);
      return;
    }
    // "open": happy open mouth (excited / greeting); bigger on the B (excited) bone
    const big = bone === "mouthB";
    const W = big ? 0.125 : 0.1;
    const depth = big ? 0.125 : 0.085;
    dSmile(W, depth, 0.025);
    const ty = -0.028 - depth * 0.78;
    mouthDecal(curvePoly((u) => [W * 0.55 * Math.cos(u * TAU), ty + depth * 0.26 * Math.sin(u * TAU)], 28), TONGUE, 0.0028);
  }

  // ----------------------------------------------------------------- eyes
  // Eye space is a unit sphere (the eye node scales it into an oval).
  const irisC = rgb(look.iris ?? "#4a2c17");
  for (const side of ["L", "R"]) {
    const ball = `eyeball${side}`;
    put(star({ R: () => 1, segU: S(32, 14), segV: S(18, 8) }), ball, "#ffffff");
    const fz = frameAt([0, 0, 1]);
    const iris = star({
      R: () => 1, frame: fz, thetaMax: 0.98, offset: 0.018, segU: S(32, 14), segV: S(6, 3),
      colorFn: (p) => mix(shade(irisC, 0.62), mix(irisC, "#ffffff", 0.28), smoothstep(0.55, -0.85, p[1])),
    });
    put(iris, ball, irisC);
    put(star({ R: () => 1, frame: fz, thetaMax: 0.5, offset: 0.034, segU: S(24, 12), segV: S(4, 2) }), ball, "#170f0c");
    put(star({ R: () => 1, frame: frameAt(norm3([0.36, 0.42, 0.83])), thetaMax: 0.25, offset: 0.05, segU: S(18, 10), segV: 3 }), ball, "#ffffff");
    if (hi) put(star({ R: () => 1, frame: frameAt(norm3([-0.3, -0.36, 0.88])), thetaMax: 0.11, offset: 0.05, segU: 12, segV: 2 }), ball, "#ffffff");
    // lid: skin shell around the +Y pole; rotates down over the eye to blink.
    const lid = `lid${side}`;
    put(star({ R: () => 1, frame: IDENTITY_FRAME, thetaMax: 1.8, offset: 0.068, segU: S(32, 14), segV: S(10, 5) }), lid, skin);
    put(star({ R: () => 1, frame: IDENTITY_FRAME, thetaMin: 1.66, thetaMax: 1.93, offset: 0.08, segU: S(32, 14), segV: 2 }), lid, LASH);
  }

  // ----------------------------------------------------------------- hair
  buildHair();

  function hairShell(edge, { offset = 0.014, flare = null, thetaMin = 0 } = {}) {
    const g = star({
      R: head.R,
      segU: S(64, 28),
      segV: S(18, 9),
      thetaMin,
      thetaMax: (ph, eq) => edge(Math.atan2(eq[0], eq[2])),
      offset: flare ? (d, th) => offset + flare(th) : offset,
      rim: 0.02,
    });
    put(g, "head", hair, { place: affine(head.center), outline: true });
  }

  /**
   * Bangs: a strip of hair over the forehead with a zigzag lower edge.
   * top = polar angle where it starts (hidden under hair/cap), notch/tip = edge
   * angles between and at the tooth tips, span = half-width (azimuth), sweep
   * skews the teeth sideways.
   */
  function fringe({ top, notch, tip, span = 0.85, teeth = 5, sweep = 1.3, offset = 0.021 }) {
    const az = (eq) => Math.atan2(eq[0], eq[2]);
    const edge = (a) => {
      if (Math.abs(a) >= span) return top;
      const u = ((a + span) / (2 * span)) * teeth;
      const v = (u - Math.floor(u)) ** sweep;
      const toothShape = (1 - Math.abs(2 * v - 1)) ** 0.75;
      const taper = 1 - smoothstep(0.7, 1, Math.abs(a) / span) * 0.6;
      return lerp(top, lerp(notch, tip, toothShape), taper);
    };
    const g = star({
      R: head.R,
      segU: S(240, 96),
      segV: S(4, 2),
      thetaMin: top,
      thetaMax: (ph, eq) => edge(az(eq)),
      offset,
      rim: 0.02,
    });
    put(g, "head", hair, { place: affine(head.center), outline: true });
  }

  /** A tapered, curving hair tuft rooted at head direction (th, az). */
  function tuft(th, az, dir, len, r0 = 0.04, bone = "head") {
    const d0 = head.dirAt(th, az);
    const base = head.surf(d0, 0.0);
    const n = head.normal(d0);
    const dd = norm3(dir);
    const ctrl = [base, add3(base, mul3(n, len * 0.45)), add3(add3(base, mul3(n, len * 0.55)), mul3(dd, len * 0.55)), add3(add3(base, mul3(n, len * 0.45)), mul3(dd, len * 1.0))];
    const path = spline(ctrl, S(9, 6));
    const g = tube({ path, radius: (u) => r0 * (1 - u) ** 0.85 * (0.8 + 0.2 * Math.sin(Math.PI * Math.min(1, u * 1.6))), segs: S(9, 6) });
    put(g, bone, hair, { place: headPlace(bone, affine(mul3(head.center, -1))), outline: true });
  }

  function buildHair() {
    const style = look.hairStyle;
    const capped = look.headwear === "cap" || look.headwear === "beanie";
    if (style === "bald") {
      // a fringe around the back and sides (collapses to nothing at the front)
      const band = (eq) => {
        // starts just behind the ears with a rounded end, thickest at the back
        const a = Math.abs(Math.atan2(eq[0], eq[2]));
        const s0 = clamp((a - 1.72) / 0.32, 0, 1);
        return Math.sqrt(1 - (1 - s0) ** 2) * (1 - 0.2 * smoothstep(2.3, 3.1, a));
      };
      const g = star({
        R: head.R,
        segU: S(72, 32),
        segV: S(6, 3),
        thetaMin: (ph, eq) => {
          const a = Math.abs(Math.atan2(eq[0], eq[2]));
          return lerp(1.6, lerp(1.48, 1.66, smoothstep(1.9, 2.8, a)), band(eq));
        },
        thetaMax: (ph, eq) => {
          const a = Math.abs(Math.atan2(eq[0], eq[2]));
          return lerp(1.6, lerp(1.8, 2.16, smoothstep(1.9, 2.8, a)), band(eq));
        },
        offset: (d, th, ph) => 0.014 + 0.005 * Math.sin(ph * 9),
        rim: 0.015,
      });
      put(g, "head", hair, { place: affine(head.center), outline: true });
      // soft puffs behind the ears
      for (const sd of [-1, 1]) {
        for (const [th, az, r] of [[1.55, 1.85, 0.05], [1.72, 2.25, 0.054]]) {
          put(blob(r, r * 1.1, r, S(10, 8)), "head", hair, { place: affine(head.surf(head.dirAt(th, sd * az), 0.012)), outline: true, olScale: 0.8 });
        }
      }
      return;
    }
    if (style === "bob") {
      hairShell((az) => {
        const a = Math.abs(az);
        return lerp(1.22, 2.08, smoothstep(0.78, 1.3, a)) - 0.12 * smoothstep(2.0, 3.1, a);
      }, { flare: (th) => 0.034 * smoothstep(0.9, 2.0, th) });
      return;
    }
    if (style === "curly") {
      const edge = (az) => 1.55 - 0.45 * Math.cos(az);
      hairShell(edge, { offset: 0.018 });
      const rng = mulberry(look.hair.length * 977 + 31);
      const n = S(46, 26);
      for (let k = 0; k < n; k++) {
        // fibonacci spread over the cap region
        const y = 1 - (k + 0.5) / n * 1.15;
        const th = Math.acos(clamp(y, -1, 1));
        const az = k * 2.399963;
        if (th > edge(az) - 0.12) continue;
        const d = head.dirAt(th, az);
        const p = head.surf(d, 0.032);
        const r = 0.048 + rng() * 0.02;
        put(blob(r, r * 0.92, r, S(10, 9)), "head", shade(hair, 0.94 + rng() * 0.12), { place: affine(p), outline: true, olScale: 0.8 });
      }
      return;
    }
    // spiky / bun / ponytail share a classic hairline
    if (style === "spiky") {
      hairShell((az) => 1.57 - 0.63 * Math.cos(az) + 0.14 * Math.exp(-(((Math.abs(az) - 1.12) / 0.26) ** 2)));
      const back = [0, 0.15, -1];
      if (look.headwear === "cap") {
        if (look.capBackwards) {
          // bangs peeking out under the cap edge
          fringe({ top: 1.08, notch: 1.23, tip: 1.33, span: 0.9, teeth: 5 });
        } else {
          fringe({ top: 1.2, notch: 1.3, tip: 1.38, span: 0.8, teeth: 4 });
        }
        for (const s of [-1, 1]) {
          tuft(1.38, s * 1.3, [s * 0.5, -0.9, -0.2], 0.08, 0.036);
          tuft(1.5, s * 1.85, [s * 0.4, -0.9, -0.6], 0.085, 0.036);
        }
        tuft(2.05, Math.PI, [0, -1, -0.35], 0.07, 0.04);
        tuft(1.95, Math.PI - 0.55, [-0.35, -1, -0.4], 0.07, 0.038);
        tuft(1.95, Math.PI + 0.55, [0.35, -1, -0.4], 0.07, 0.038);
      } else if (!capped) {
        const crown = 7;
        for (let k = 0; k < crown; k++) {
          const az = Math.PI + (k - (crown - 1) / 2) * 0.62;
          const out = [Math.sin(az), 0, Math.cos(az)];
          tuft(0.75, az, add3(mul3(out, 0.6), [0, 0.55, -0.75]), 0.12, 0.05);
        }
        tuft(0.25, 0.3, [0.2, 0.8, -0.6], 0.12, 0.05);
        tuft(0.35, -2.5, [-0.3, 0.7, -0.7], 0.12, 0.05);
        fringe({ top: 0.9, notch: 1.12, tip: 1.32, span: 0.95, teeth: 5 });
        tuft(0.85, 0.0, [0, 0.6, 1], 0.1, 0.045);
        for (const s of [-1, 1]) tuft(1.35, s * 1.5, [s * 0.5, -0.6, -0.4], 0.08, 0.036);
        tuft(1.6, Math.PI, back.map((v, i) => (i === 1 ? -0.8 : v)), 0.08, 0.04);
      } else {
        fringe({ top: 1.4, notch: 1.45, tip: 1.5, span: 0.7, teeth: 4 });
        for (const s of [-1, 1]) tuft(1.45, s * 1.35, [s * 0.4, -0.9, -0.2], 0.07, 0.032);
      }
      return;
    }
    hairShell((az) => 1.52 - 0.52 * Math.cos(az));
    if (style === "bun") {
      const d = norm3([0, 0.78, -0.62]);
      const p = head.surf(d, 0.07);
      put(blob(0.092, 0.085, 0.088, S(14, 8)), "head", hair, { place: affine(p), outline: true });
      const tie = ring({ rx: 0.062, y: 0, radius: 0.014, segs: S(8, 5), samples: S(24, 12) });
      put(tie, "head", look.accessoryColor ?? "#ff6b9d", { place: affine(head.surf(d, 0.005), [Math.acos(d[1]) * -1, 0, 0]) });
      fringe({ top: 0.95, notch: 1.12, tip: 1.3, span: 0.85, teeth: 3, sweep: 1.8 });
    }
    if (style === "ponytail") {
      // tail hangs off the dangle bone so it can swing
      const ctrl = [[0, 0.01, 0.02], [0, 0.0, -0.07], [0, -0.1, -0.12], [0, -0.22, -0.1], [0, -0.3, -0.06]];
      const path = spline(ctrl, S(12, 7));
      const g = tube({ path, radius: (u) => 0.05 * (1 - u) ** 0.7 * (0.75 + 0.6 * Math.sin(Math.PI * Math.min(1, u * 1.4 + 0.15))), segs: S(10, 6) });
      put(g, "dangle", hair, { outline: true });
      put(ring({ rx: 0.036, y: 0, radius: 0.013, segs: S(8, 5), samples: S(20, 10) }), "dangle", look.accessoryColor ?? "#ff6b9d", { place: affine([0, 0.0, -0.035], [Math.PI / 2 - 0.3, 0, 0]) });
      fringe({ top: 0.95, notch: 1.1, tip: 1.3, span: 0.85, teeth: 4, sweep: 0.7 });
    }
  }

  // ------------------------------------------------------------- headwear
  if (look.headwear === "cap") buildCap();
  if (look.headwear === "beanie") buildBeanie();

  function buildCap() {
    const capC = rgb(look.headwearColor);
    const back = !!look.capBackwards;
    const brimAz = back ? Math.PI : 0;
    const edge = (az) => 1.25 + 0.05 * Math.sin(az) ** 2 - 0.06 * Math.cos(az - brimAz + Math.PI);
    const domeOff = (d, th) => 0.03 + 0.012 * (1 - th / 1.3);
    const dome = star({ R: head.R, segU: S(56, 24), segV: S(16, 8), thetaMax: (ph, eq) => edge(Math.atan2(eq[0], eq[2])), offset: domeOff, rim: 0.03 });
    put(dome, "head", capC, { place: affine(head.center), outline: true });
    // top button
    const top = head.surf([0, 1, 0], 0.042);
    put(blob(0.022, 0.012, 0.022, S(8, 5)), "head", capC, { place: affine(top), outline: true, olScale: 0.6 });
    // panel seams
    if (hi) {
      for (let k = 0; k < 6; k++) {
        const az = (k / 6) * TAU + Math.PI / 6;
        const pts = [];
        for (let j = 0; j <= 8; j++) {
          const th = lerp(0.05, edge(az) - 0.02, j / 8);
          const d = head.dirAt(th, az);
          pts.push(head.surf(d, domeOff(d, th) + 0.002));
        }
        put(tube({ path: pts, radius: 0.0032, segs: 4 }), "head", shade(capC, 0.78));
      }
    }
    // brim: a gently curved slab
    const brimTh = edge(brimAz);
    const d = head.dirAt(brimTh - 0.05, brimAz);
    const anchor = head.surf(d, 0.02);
    const out = [Math.sin(brimAz), 0, Math.cos(brimAz)];
    const center = add3(add3(anchor, mul3(out, 0.085)), [0, -0.012, 0]);
    const brim = star({ R: superR(0.15, 0.011, 0.105, 2.6, 2), segU: S(48, 24), segV: S(14, 8) });
    // bend the brim down at its sides
    bend(brim, 1.6);
    put(brim, "head", shade(capC, 0.96), { place: affine(center, [back ? 0.22 : -0.22, brimAz, 0]), outline: true });
    if (back) {
      // the adjustment strap now faces forward
      const strap = [];
      for (let k = 0; k <= 10; k++) {
        const azk = lerp(-0.42, 0.42, k / 10);
        const dk = head.dirAt(edge(azk) - 0.025, azk);
        strap.push(head.surf(dk, domeOff(dk, edge(azk)) + 0.004));
      }
      put(tube({ path: strap, radius: 0.011, segs: S(8, 5), flat: 0.55, up: [0, 0, 1] }), "head", shade(capC, 0.85));
    }
  }

  function bend(g, k) {
    for (let v = 0; v < g.p.length; v += 3) {
      const x = g.p[v];
      g.p[v + 1] -= k * x * x;
      const nx = g.n[v] + 2 * k * x * g.n[v + 1];
      const l = Math.hypot(nx, g.n[v + 1], g.n[v + 2]) || 1;
      g.n[v] = nx / l;
      g.n[v + 1] /= l;
      g.n[v + 2] /= l;
    }
  }

  function buildBeanie() {
    // snug knit cap: a dome hugging the head down to the brows, a thick folded
    // cuff following the head's shape, and a pompom
    const c = rgb(look.headwearColor);
    const edge = (eq) => 1.44 - 0.16 * Math.cos(Math.atan2(eq[0], eq[2]));
    const dome = star({ R: head.R, segU: S(56, 24), segV: S(16, 8), thetaMax: (ph, eq) => edge(eq) - 0.1, offset: (d, th) => 0.03 + 0.016 * Math.cos(Math.min(th, 1.5)), rim: 0.02 });
    put(dome, "head", c, { place: affine(head.center), outline: true });
    const cuff = star({ R: head.R, segU: S(56, 24), segV: S(4, 2), thetaMin: (ph, eq) => edge(eq) - 0.26, thetaMax: (ph, eq) => edge(eq), offset: 0.046, rim: 0.035 });
    put(cuff, "head", shade(c, 0.86), { place: affine(head.center), outline: true });
    put(blob(0.06, 0.056, 0.06, S(10, 7)), "head", mix(c, "#ffffff", 0.35), { place: affine(head.surf([0, 1, 0], 0.085)), outline: true });
  }


  // ---------------------------------------------------------------- torso
  const W = dims.W;
  const TC = dims.torsoC;
  const TB = 0.19;
  const TA = 0.172 * W;
  const TZ = 0.138 * W;
  const torsoF = (x, y, z) => {
    const yn = y / TB;
    const f = 1 - 0.14 * yn;
    const hx = Math.abs(x) / (TA * f);
    const hz = Math.abs(z) / (TZ * f);
    return (hx ** 2.3 + hz ** 2.3) ** (2 / 2.3) + yn * yn;
  };
  const torsoR = implicitR(torsoF, 0.4);
  const torsoAt = affine([0, TC, 0]);
  /** Torso horizontal radius at local height y (relative to torso center) along angle a (0 = front). */
  const torsoRing = (yl, a) => {
    const yn = yl / TB;
    const k = Math.sqrt(Math.max(0, 1 - yn * yn));
    const f = 1 - 0.14 * yn;
    const ca = Math.abs(Math.sin(a));
    const sa = Math.abs(Math.cos(a));
    return (k ** (2 / 2.3) * f) / ((ca / TA) ** 2.3 + (sa / TZ) ** 2.3) ** (1 / 2.3);
  };
  const torsoSurfPoint = (d, off) => add3([0, TC, 0], mul3(d, torsoR(d) + off));

  const topKind = look.top;
  put(star({ R: torsoR, segU: S(40, 20), segV: S(22, 11) }), "chest", shirt, { place: torsoAt, outline: true });
  // pelvis / shorts
  const bottomKind = look.bottom;
  const pelvisC = bottomKind === "skirt" ? pants : pants;
  put(blob(0.152 * W, 0.104, 0.124 * W, S(16, 8)), "hips", pelvisC, { outline: true });

  // hem band
  {
    const yl = -0.135;
    const pts = [];
    const n = S(40, 20);
    for (let k = 0; k < n; k++) {
      const a = (k / n) * TAU;
      const r = torsoRing(yl, a) + 0.004;
      pts.push([Math.sin(a) * r, TC + yl, Math.cos(a) * r]);
    }
    put(tube({ path: pts, radius: topKind === "hoodie" ? 0.02 : 0.012, segs: S(8, 5), closed: true, flat: 0.8 }), "chest", shirtDark, { outline: true });
  }
  // collar / hood
  if (topKind === "hoodie") {
    put(ring({ rx: 0.108, rz: 0.098, y: 0.302, radius: 0.034, segs: S(10, 6), samples: S(28, 14), flat: 0.85 }), "chest", shirtDark, { place: affine([0, 0, -0.008]), outline: true });
    if (look.accessory !== "backpack") {
      put(star({ R: superR(0.13, 0.1, 0.06, 2.4, 2.2), segU: S(28, 14), segV: S(14, 7) }), "chest", shirtDark, { place: affine([0, 0.25, -0.115], [0.35, 0, 0]), outline: true });
    }
    // kangaroo pocket
    const pd = norm3([0, -0.42, 1]);
    {
      const pts = [[-0.5, -0.2], [0.5, -0.2], [0.36, 0.16], [-0.36, 0.16]];
      const { fn, cs, ct } = polyOutline(pts);
      const fr = frameAt(pd);
      const g = star({ R: torsoR, frame: frameAt(tangentDir(fr, cs, ct)), thetaMax: fn, offset: 0.004, segU: S(32, 14), segV: S(5, 3) });
      put(g, "chest", shade(shirt, 0.92), { place: torsoAt, outline: hi, olScale: 0.45 });
    }
    // drawstrings
    if (hi) {
      for (const s of [-1, 1]) {
        const pts = [];
        for (let k = 0; k <= 6; k++) {
          const y = lerp(0.135, 0.02, k / 6);
          const d = norm3([s * 0.2, y / 0.19, 0.95]);
          pts.push(torsoSurfPoint(d, 0.008));
        }
        put(tube({ path: pts, radius: 0.0065, segs: 5 }), "chest", "#fff6e6");
        put(blob(0.009, 0.014, 0.009, 5), "chest", "#fff6e6", { place: affine(add3(pts[pts.length - 1], [0, -0.006, 0.002])) });
      }
    }
  } else {
    put(ring({ rx: 0.085, rz: 0.08, y: 0.31, radius: 0.016, segs: S(8, 5), samples: S(24, 12) }), "chest", shirtDark, { outline: true, olScale: 0.6 });
  }

  // ---------------------------------------------------------------- arms
  for (const side of [-1, 1]) {
    const sh = side < 0 ? "shoulderL" : "shoulderR";
    const el = side < 0 ? "elbowL" : "elbowR";
    const inner = -side;
    const sleeveLong = topKind !== "tee";
    if (sleeveLong) {
      put(capsule({ y0: -dims.upperArm, y1: 0, r0: 0.052, r1: 0.058, segs: S(16, 8), rings: S(5, 3) }), sh, shirt, { outline: true });
      put(capsule({ y0: -0.118, y1: 0, r0: 0.049, r1: 0.052, segs: S(16, 8), rings: S(5, 3) }), el, shirt, { outline: true });
      put(ring({ rx: 0.051, y: -0.118, radius: 0.0145, segs: S(8, 5), samples: S(18, 10) }), el, shirtDark, { outline: true });
    } else {
      put(capsule({ y0: -dims.upperArm, y1: 0, r0: 0.041, r1: 0.046, segs: S(14, 8), rings: S(4, 3) }), sh, skin, { outline: true });
      put(lathe({ profile: [[-0.078, 0.044], [-0.078, 0.059], [-0.068, 0.063], [0.0, 0.064], [0.04, 0.052], [0.066, 0.0]], segs: S(16, 8) }), sh, shirt, { outline: true });
      put(capsule({ y0: -0.118, y1: 0, r0: 0.039, r1: 0.042, segs: S(14, 8), rings: S(4, 3) }), el, skin, { outline: true });
    }
    // mitten hand + thumb
    const hp = [0, dims.handY, 0.004];
    put(blob(0.055, 0.061, 0.047, S(12, 7)), el, skin, { place: affine(hp, [0.1, 0, 0]), outline: true });
    put(blob(0.021, 0.031, 0.021, S(8, 5)), el, skin, { place: affine(add3(hp, [inner * 0.03, 0.016, 0.037]), [0.5, 0, inner * 0.5]), outline: true, olScale: 0.8 });
  }

  // ---------------------------------------------------------------- legs
  const sockC = look.socks ? rgb(look.socks) : null;
  for (const side of [-1, 1]) {
    const th = side < 0 ? "thighL" : "thighR";
    const kn = side < 0 ? "kneeL" : "kneeR";
    const an = side < 0 ? "ankleL" : "ankleR";
    const L1 = dims.thigh;
    const L2 = dims.shin;
    if (bottomKind === "pants") {
      put(capsule({ y0: -L1, y1: 0, r0: 0.064, r1: 0.072, segs: S(16, 8), rings: S(4, 3) }), th, pants, { outline: true });
      put(capsule({ y0: -L2 + 0.03, y1: 0, r0: 0.063, r1: 0.064, segs: S(16, 8), rings: S(4, 3) }), kn, pants, { outline: true });
      put(ring({ rx: 0.063, y: -L2 + 0.03, radius: 0.013, segs: S(8, 5), samples: S(18, 10) }), kn, shade(pants, 0.85), { outline: true });
    } else {
      put(capsule({ y0: -L1, y1: 0, r0: 0.056, r1: 0.064, segs: S(16, 8), rings: S(4, 3) }), th, skin, { outline: true });
      if (bottomKind === "shorts") {
        put(lathe({ profile: [[-0.118, 0.056], [-0.118, 0.079], [-0.112, 0.085], [-0.03, 0.087], [0.04, 0.07], [0.078, 0.0]], segs: S(18, 9) }), th, pants, { outline: true });
      }
      put(capsule({ y0: -L2 + 0.012, y1: 0, r0: 0.05, r1: 0.056, segs: S(16, 8), rings: S(4, 3) }), kn, skin, { outline: true });
      if (sockC) {
        put(capsule({ y0: -L2 + 0.01, y1: -0.12, r0: 0.054, r1: 0.055, segs: S(16, 8), rings: S(3, 2) }), kn, sockC, { outline: true });
        put(ring({ rx: 0.055, y: -0.118, radius: 0.01, segs: S(8, 4), samples: S(18, 10) }), kn, shade(sockC, 0.94), { outline: true });
        if (look.sockStripe && hi) put(ring({ rx: 0.0565, y: -0.142, radius: 0.0062, segs: 5, samples: 18 }), kn, look.sockStripe);
      }
    }
    // shoe
    const shoeC = rgb(look.shoes);
    const shoeR = superR(0.068, 0.058, 0.118, 2.4, 2.6);
    const shoeAt = [0, -0.022, 0.042];
    put(star({ R: shoeR, segU: S(32, 14), segV: S(16, 8) }), an, shoeC, { place: affine(shoeAt), outline: true });
    put(star({ R: superR(0.075, 0.022, 0.127, 2.6, 2.2), segU: S(32, 14), segV: S(10, 6) }), an, look.sole ?? "#efe8dc", { place: affine([0, -0.063, 0.04]), outline: true });
    if (look.shoeAccent) {
      const R = shoeR;
      const pts = [];
      for (let k = 0; k <= 10; k++) {
        const b = lerp(-1.25, 1.25, k / 10);
        const d = norm3([Math.sin(b), Math.cos(b), 0.55]);
        pts.push(add3(mul3(d, R(d) + 0.004), shoeAt));
      }
      put(tube({ path: pts, radius: 0.019, segs: S(8, 5), flat: 0.42, up: [0, 0, 1] }), an, look.shoeAccent, { outline: hi, olScale: 0.5 });
      put(blob(0.025, 0.034, 0.016, S(8, 5)), an, look.shoeAccent, { place: affine([0, 0.0, -0.068], [0.25, 0, 0]), outline: hi, olScale: 0.6 });
    }
  }

  if (bottomKind === "skirt") {
    const prof = [[0.085, 0.0], [0.085, 0.13], [0.03, 0.162], [-0.1, 0.205], [-0.16, 0.226], [-0.168, 0.222], [-0.162, 0.21], [-0.1, 0.19], [0.02, 0.148], [0.07, 0.12], [0.075, 0.0]];
    put(lathe({ profile: prof, segs: S(28, 14), sx: W, sz: W * 0.9 }), "hips", pants, { outline: true });
  }

  // ---------------------------------------------------------- accessories
  if (look.accessory === "backpack") {
    const c = rgb(look.accessoryColor ?? "#1fb3a3");
    const pk = rig.rest.pack.pos;
    const rel = (p) => sub3(p, [pk.x, pk.y, pk.z]);
    put(star({ R: superR(0.128, 0.138, 0.066, 3, 3), segU: S(28, 14), segV: S(16, 8) }), "pack", c, { place: affine(rel([0, 0.145, -0.19])), outline: true });
    put(star({ R: superR(0.092, 0.07, 0.03, 3, 3), segU: S(24, 12), segV: S(10, 6) }), "pack", shade(c, 1.12), { place: affine(rel([0, 0.09, -0.252])), outline: true, olScale: 0.7 });
    put(star({ R: superR(0.132, 0.036, 0.072, 3, 2.2), segU: S(24, 12), segV: S(10, 6) }), "pack", shade(c, 0.85), { place: affine(rel([0, 0.268, -0.19])), outline: true, olScale: 0.8 });
    const loop = [];
    for (let k = 0; k <= 8; k++) {
      const a = (k / 8) * Math.PI;
      loop.push(rel([Math.cos(a) * 0.04, 0.3 + Math.sin(a) * 0.028, -0.19]));
    }
    put(tube({ path: loop, radius: 0.008, segs: 5 }), "pack", shade(c, 0.7));
    // shoulder straps hugging the torso
    for (const s of [-1, 1]) {
      const pts = [];
      for (let k = 0; k <= S(14, 8); k++) {
        const g = lerp(-1.9, 2.05, k / S(14, 8));
        const d = norm3([s * 0.62, Math.cos(g), Math.sin(g)]);
        pts.push(torsoSurfPoint(d, 0.008));
      }
      put(tube({ path: pts, radius: 0.019, segs: S(8, 5), flat: 0.4, up: [1, 0, 0] }), "chest", shade(c, 0.72), { outline: true, olScale: 0.7 });
    }
  }
  if (look.accessory === "scarf") {
    const c = rgb(look.accessoryColor);
    const c2 = mix(c, "#ffffff", 0.6);
    const stripes = (p, t) => (Math.sin(t * TAU * 6) > 0 ? c : c2);
    const pts = [];
    const n = S(30, 16);
    for (let k = 0; k < n; k++) {
      const a = (k / n) * TAU;
      pts.push([Math.sin(a) * 0.112, 0.31 - 0.02 * Math.cos(a), Math.cos(a) * 0.105]);
    }
    put(tube({ path: pts, radius: 0.04, segs: S(10, 6), closed: true, flat: 0.8, colorFn: stripes }), "chest", c, { outline: true });
    const tail = [];
    for (let k = 0; k <= 6; k++) {
      const y = lerp(0.3, 0.1, k / 6);
      const d = norm3([0.35, (y - TC) / 0.19, 0.95]);
      tail.push(torsoSurfPoint(d, 0.03 - 0.012 * (k / 6)));
    }
    put(tube({ path: tail, radius: 0.038, segs: S(8, 5), flat: 0.35, up: [0, 0, 1], colorFn: (p, t) => (Math.sin(t * TAU * 2.5) > 0 ? c : c2) }), "chest", c, { outline: true });
  }
  if (look.accessory === "glasses") {
    const fc = "#2b2b36";
    const rims = [];
    for (const e of [face.eyeL, face.eyeR]) {
      const fr = frameAt(e.normal);
      const cen = add3(head.surf(e.dir), mul3(e.normal, 0.026));
      const pts = [];
      const rr = 0.064 * (look.eyeScale ?? 1);
      for (let k = 0; k < 28; k++) {
        const a = (k / 28) * TAU;
        pts.push(add3(cen, add3(mul3(fr.x, Math.cos(a) * rr), mul3(fr.z, Math.sin(a) * rr * 0.9))));
      }
      put(tube({ path: pts, radius: 0.0065, segs: S(6, 4), closed: true }), "head", fc);
      rims.push({ cen, fr, rr });
    }
    const [L, R] = rims;
    const a = add3(L.cen, mul3(L.fr.x, L.rr));
    const b = add3(R.cen, mul3(R.fr.x, -R.rr));
    const mid = add3(mul3(add3(a, b), 0.5), [0, 0.012, 0.006]);
    put(tube({ path: spline([a, mid, b], 7), radius: 0.006, segs: 5 }), "head", fc);
    for (const [rim, s] of [[L, -1], [R, 1]]) {
      const start = add3(rim.cen, mul3(rim.fr.x, s * rim.rr));
      const ear = head.surf(head.dirAt(1.58, s * 1.45), 0.012);
      const midT = head.surf(head.dirAt(1.5, s * 0.95), 0.016);
      put(tube({ path: spline([start, midT, ear], 8), radius: 0.0055, segs: 5 }), "head", fc);
    }
  }

  return buf;
}

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

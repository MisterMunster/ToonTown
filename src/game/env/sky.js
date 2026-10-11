// Stylized gradient sky dome: zenith / near-horizon / horizon / below-horizon
// colours, a soft sun disc with a warm halo, a cartoon crescent moon and
// twinkling procedural stars. Rendered at the far plane (z = w) so it sits
// behind everything regardless of the camera's maxZ.
import { Matrix, Mesh, MeshBuilder, ShaderMaterial, Vector3 } from "@babylonjs/core";

const VERTEX = /* glsl */ `
precision highp float;
attribute vec3 position;
uniform mat4 worldViewProjection;
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = worldViewProjection * vec4(position, 1.0);
  // Push to (just inside) the far plane: never clipped, never occludes anything.
  gl_Position = vec4(p.xy, p.w * 0.999999, p.w);
}`;

const FRAGMENT = /* glsl */ `
precision highp float;
varying vec3 vDir;
uniform vec3 uZenith;
uniform vec3 uMid;
uniform vec3 uHorizon;
uniform vec3 uBelow;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uGlowColor;
uniform vec3 uMoonDir;
uniform float uSunVis;
uniform float uMoonVis;
uniform float uStars;
uniform float uTime;
uniform float uLinear;
uniform mat4 uStarRot;

float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
vec3 hash33(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}

// One layer of stars: a jittered point per 3D cell around the unit sphere.
float starLayer(vec3 d, float scale, float density, float size) {
  vec3 p = d * scale;
  vec3 cell = floor(p);
  float h = hash13(cell);
  if (h > density) return 0.0;
  vec3 c = 0.3 + 0.4 * hash33(cell);
  float dist = length(p - cell - c);
  float twinkle = 0.55 + 0.45 * sin(uTime * (1.3 + 2.7 * fract(h * 7.31)) + h * 61.0);
  float bright = 0.45 + 0.55 * fract(h * 17.13);
  return smoothstep(size, size * 0.15, dist) * twinkle * bright;
}

// Soft shoulder above 0.8 so the sky itself never crosses the bloom threshold
// (only the sun/moon discs, drawn afterwards, are allowed to glow).
vec3 softLimit(vec3 c) {
  vec3 over = max(c - 0.8, 0.0);
  return min(c, vec3(0.8)) + 0.2 * (1.0 - exp(-over / 0.2));
}

// Soft-edged disc around direction c with angular radius given as cosines.
float disc(vec3 d, vec3 c, float cosOuter, float cosInner) {
  return smoothstep(cosOuter, cosInner, dot(d, c));
}

void main() {
  vec3 d = normalize(vDir);
  float e = d.y;

  // Gradient: horizon band -> near-horizon sky -> zenith; below horizon fades to uBelow.
  vec3 col;
  if (e >= 0.0) {
    col = mix(uHorizon, uMid, smoothstep(0.0, 0.16, e));
    col = mix(col, uZenith, smoothstep(0.08, 0.92, pow(e, 0.85)));
  } else {
    col = mix(uHorizon, uBelow, smoothstep(0.0, 0.22, -e));
  }

  // Warm glow hugging the horizon on the sun's side (sunrise / sunset magic).
  float sd = dot(d, uSunDir);
  float sunSide = max(sd, 0.0);
  float lowBand = 1.0 - smoothstep(-0.05, 0.45, abs(e - 0.02));
  col += uGlowColor * (pow(sunSide, 6.0) * lowBand * 0.42 + pow(sunSide, 32.0) * 0.2);

  // Stars (rotate slowly through the night), hidden near the horizon and the moon.
  if (uStars > 0.001 && e > -0.02) {
    vec3 sd3 = (uStarRot * vec4(d, 0.0)).xyz;
    float s = starLayer(sd3, 70.0, 0.32, 0.16) * 0.8 + starLayer(sd3, 34.0, 0.10, 0.11) * 1.35;
    float hide = smoothstep(0.0, 0.18, e) * (1.0 - disc(d, uMoonDir, 0.9925, 0.9975));
    col += vec3(1.0, 0.97, 0.88) * s * uStars * hide;
  }

  col = softLimit(col);
  float aboveHorizon = smoothstep(-0.012, 0.006, e);

  // Moon: a cartoon crescent (a disc minus an offset disc) with a soft glow.
  if (uMoonVis > 0.001) {
    vec3 side = normalize(cross(uMoonDir, vec3(0.0, 1.0, 0.0)) + vec3(0.0, 0.0001, 0.0));
    vec3 cut = normalize(uMoonDir + side * 0.024 + vec3(0.0, 0.012, 0.0));
    float m = disc(d, uMoonDir, 0.99855, 0.99878);
    float bite = disc(d, cut, 0.99862, 0.99885);
    float lit = m * (1.0 - bite);
    float md = max(dot(d, uMoonDir), 0.0);
    vec3 moonCol = vec3(1.0, 0.96, 0.8) * 1.2;
    col += vec3(0.5, 0.62, 1.0) * (pow(md, 700.0) * 0.25 + pow(md, 60.0) * 0.07) * uMoonVis * aboveHorizon;
    // Faint "earthshine" on the dark part so the whole disc still reads.
    col = mix(col, col * 0.8 + vec3(0.05, 0.07, 0.14), m * bite * uMoonVis * aboveHorizon);
    col = mix(col, moonCol, lit * uMoonVis * aboveHorizon);
  }

  // Sun: clean disc with a soft rim, a tight warm corona and a wide faint halo.
  if (uSunVis > 0.001) {
    float halo = pow(sunSide, 900.0) * 0.4 + pow(sunSide, 110.0) * 0.1;
    col = softLimit(col + uSunColor * halo * uSunVis * aboveHorizon);
    float sdisc = disc(d, uSunDir, 0.99875, 0.99895);
    col = mix(col, uSunColor, sdisc * uSunVis * aboveHorizon);
  }

  // Tiny dither so gradients never band.
  col += (hash13(vec3(gl_FragCoord.xy, 7.0)) - 0.5) / 255.0;
  // The image-processing post-process expects linear input (like StandardMaterial gives it).
  col = max(col, 0.0);
  gl_FragColor = vec4(mix(col, pow(col, vec3(2.2)), uLinear), 1.0);
}`;

/**
 * @param {import("@babylonjs/core").Scene} scene
 * @returns {{ mesh: Mesh, material: ShaderMaterial, update(state: object, elapsed: number): void }}
 */
export function createSky(scene) {
  const material = new ShaderMaterial(
    "skyMat",
    scene,
    { vertexSource: VERTEX, fragmentSource: FRAGMENT },
    {
      attributes: ["position"],
      uniforms: [
        "worldViewProjection", "uZenith", "uMid", "uHorizon", "uBelow", "uSunDir", "uSunColor",
        "uGlowColor", "uMoonDir", "uSunVis", "uMoonVis", "uStars", "uTime", "uStarRot", "uLinear",
      ],
    },
  );
  material.backFaceCulling = false;

  const mesh = MeshBuilder.CreateSphere("skyDome", { diameter: 900, segments: 24, sideOrientation: Mesh.BACKSIDE }, scene);
  mesh.material = material;
  mesh.infiniteDistance = true; // follows the camera
  mesh.isPickable = false;
  mesh.applyFog = false;
  mesh.receiveShadows = false;
  mesh.alwaysSelectAsActiveMesh = true;
  mesh.doNotSyncBoundingInfo = true;
  mesh.renderingGroupId = 0;

  // Stars turn around a tilted "celestial pole" over the day.
  const starAxis = new Vector3(0, Math.sin(0.7), Math.cos(0.7)).normalize();
  const starRot = new Matrix();

  return {
    mesh,
    material,
    /**
     * @param {object} s sky state from evaluateSky()
     * @param {number} elapsed seconds (drives star twinkle)
     * @param {number} linear 1 when image processing runs as a post-process (output linear colour)
     */
    update(s, elapsed, linear) {
      material.setFloat("uLinear", linear);
      material.setColor3("uZenith", s.zenith);
      material.setColor3("uMid", s.mid);
      material.setColor3("uHorizon", s.horizon);
      material.setColor3("uBelow", s.below);
      material.setVector3("uSunDir", s.sunDir);
      material.setColor3("uSunColor", s.sunDiscColor);
      material.setColor3("uGlowColor", s.glowColor);
      material.setVector3("uMoonDir", s.moonDir);
      material.setFloat("uSunVis", s.sunVisibility);
      material.setFloat("uMoonVis", s.moonVisibility);
      material.setFloat("uStars", s.starAmount);
      material.setFloat("uTime", elapsed % 100000); // wraps after ~28 h; float precision stays fine
      Matrix.RotationAxisToRef(starAxis, (s.hours / 24) * Math.PI * 2, starRot);
      material.setMatrix("uStarRot", starRot);
    },
  };
}

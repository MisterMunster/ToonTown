// Chunky cartoon clouds: clusters of flattened, flat-bottomed spheres merged
// into ONE mesh (one draw call). Each vertex carries its cloud's centre and
// speed in a custom `cloud` attribute, so drifting and wrap-around happen in
// the vertex shader (no per-frame CPU work). Clouds shrink to nothing at the
// wrap edge, so they never pop. Two-tone toon shading driven by uniforms.
import { CreateSphereVertexData, Mesh, ShaderMaterial, VertexData } from "@babylonjs/core";
import { makeRng } from "../palette.js";

const RANGE = 300; // clouds live in x,z ∈ [-RANGE, RANGE]
const WIND_SPEED = 2.2; // m/s along +X (east)

const VERTEX = /* glsl */ `
precision highp float;
attribute vec3 position;
attribute vec3 normal;
attribute vec4 cloud; // xyz = cloud centre, w = speed multiplier
uniform mat4 viewProjection;
uniform float uDrift;
uniform float uRange;
varying vec3 vN;
varying vec3 vW;
void main() {
  float x = mod(cloud.x + uDrift * cloud.w + uRange, 2.0 * uRange) - uRange;
  float grow = smoothstep(uRange, uRange - 45.0, abs(x));
  vec3 w = vec3(x, cloud.y, cloud.z) + position * grow;
  vN = normal;
  vW = w;
  gl_Position = viewProjection * vec4(w, 1.0);
}`;

const FRAGMENT = /* glsl */ `
precision highp float;
varying vec3 vN;
varying vec3 vW;
uniform vec3 uLightDir;
uniform vec3 uLit;
uniform vec3 uShade;
uniform vec3 uHaze;
uniform vec3 cameraPosition;
uniform float uLinear;
void main() {
  vec3 n = normalize(vN);
  float ndl = dot(n, uLightDir) * 0.5 + 0.5;
  float up = n.y * 0.5 + 0.5;
  float k = smoothstep(0.36, 0.7, mix(ndl, up, 0.55));
  vec3 col = mix(uShade, uLit, k);
  vec3 v = normalize(cameraPosition - vW);
  float rim = pow(1.0 - clamp(dot(n, v), 0.0, 1.0), 3.0);
  col += uLit * rim * 0.12;
  float dist = length(vW.xz - cameraPosition.xz);
  col = mix(col, uHaze, smoothstep(170.0, 470.0, dist) * 0.45);
  col = max(col, 0.0);
  gl_FragColor = vec4(mix(col, pow(col, vec3(2.2)), uLinear), 1.0);
}`;

/** Build the merged cloud geometry (deterministic). */
function buildGeometry(count, seed) {
  const rng = makeRng(seed);
  const unit = CreateSphereVertexData({ segments: 7, diameter: 2 });
  const up = unit.positions;
  const ui = unit.indices;
  const vPer = up.length / 3;

  const positions = [];
  const normals = [];
  const attrs = [];
  const indices = [];

  // Stratified along X so they never clump. Most clouds sit in bands 130–300 m
  // north/south of town, where a third-person camera (looking slightly down)
  // actually sees sky; the rest drift overhead. Distant ones are bigger.
  for (let c = 0; c < count; c++) {
    const cx = -RANGE + ((c + 0.1 + rng() * 0.8) / count) * 2 * RANGE;
    const far = rng() < 0.65;
    const side = rng() < 0.5 ? -1 : 1;
    const cz = far ? side * (130 + rng() * (RANGE - 140)) : (rng() - 0.5) * 260;
    const cy = 60 + rng() * 38;
    const dist = Math.hypot(cx, cz);
    const size = (0.7 + rng() * 0.5) * (0.85 + 0.5 * Math.min(1, dist / RANGE));
    const speed = 0.7 + rng() * 0.6;
    const yaw = (rng() - 0.5) * 0.8; // mostly aligned with the wind
    const cosY = Math.cos(yaw);
    const sinY = Math.sin(yaw);
    const base = -3.2 * size; // flat cartoon bottom

    // Puffs: a row of big round bumps, bigger in the middle, plus a few on top.
    const puffs = [];
    const n = 4 + Math.floor(rng() * 3);
    const length = (14 + rng() * 10) * size;
    for (let p = 0; p < n; p++) {
      const t = n === 1 ? 0 : (p / (n - 1)) * 2 - 1;
      const mid = 1 - Math.abs(t);
      const r = size * (5.5 + 5 * mid) * (0.88 + rng() * 0.24);
      puffs.push([t * length, mid * 2.5 * size + rng() * size, (rng() - 0.5) * 6 * size, r]);
    }
    const tops = 1 + Math.floor(rng() * 3);
    for (let p = 0; p < tops; p++) {
      const t = (rng() - 0.5) * 1.1;
      const r = size * (6 + rng() * 3.5);
      puffs.push([t * length, 5.5 * size + rng() * 2 * size, (rng() - 0.5) * 4 * size, r]);
    }

    for (const [px, py, pz, r] of puffs) {
      const ry = r * 0.82;
      const start = positions.length / 3;
      for (let v = 0; v < vPer; v++) {
        const ux = up[v * 3];
        const uy = up[v * 3 + 1];
        const uz = up[v * 3 + 2];
        let lx = px + ux * r;
        let ly = py + uy * ry;
        let lz = pz + uz * r;
        // Ellipsoid normal.
        let nx = ux / r;
        let ny = uy / ry;
        let nz = uz / r;
        if (ly < base) {
          ly = base;
          nx *= 0.25;
          nz *= 0.25;
          ny = -Math.abs(ny) - 1 / r;
        }
        const nl = Math.hypot(nx, ny, nz) || 1;
        nx /= nl;
        ny /= nl;
        nz /= nl;
        positions.push(lx * cosY + lz * sinY, ly, -lx * sinY + lz * cosY);
        normals.push(nx * cosY + nz * sinY, ny, -nx * sinY + nz * cosY);
        attrs.push(cx, cy, cz, speed);
      }
      for (let i = 0; i < ui.length; i++) indices.push(ui[i] + start);
    }
  }
  return { positions, normals, attrs, indices };
}

/**
 * @param {import("@babylonjs/core").Scene} scene
 * @param {{ count?: number, seed?: number }} [opts]
 */
export function createClouds(scene, { count = 20, seed = 4242 } = {}) {
  const geo = buildGeometry(count, seed);
  const mesh = new Mesh("clouds", scene);
  const vd = new VertexData();
  vd.positions = geo.positions;
  vd.normals = geo.normals;
  vd.indices = geo.indices;
  vd.applyToMesh(mesh, false);
  mesh.setVerticesData("cloud", new Float32Array(geo.attrs), false, 4);

  const material = new ShaderMaterial(
    "cloudMat",
    scene,
    { vertexSource: VERTEX, fragmentSource: FRAGMENT },
    {
      attributes: ["position", "normal", "cloud"],
      uniforms: ["viewProjection", "cameraPosition", "uDrift", "uRange", "uLightDir", "uLit", "uShade", "uHaze", "uLinear"],
    },
  );
  material.setFloat("uRange", RANGE);
  mesh.material = material;
  mesh.isPickable = false;
  mesh.applyFog = false;
  mesh.receiveShadows = false;
  // Real positions are computed in the shader, so the CPU bounding box is meaningless.
  mesh.alwaysSelectAsActiveMesh = true;
  mesh.doNotSyncBoundingInfo = true;
  mesh.freezeWorldMatrix();

  let drift = 0;
  return {
    mesh,
    material,
    count,
    /** @param {number} linear 1 when image processing runs as a post-process */
    update(dt, s, linear) {
      material.setFloat("uLinear", linear);
      drift += dt * WIND_SPEED;
      if (drift > 1e5) drift = 0; // float-precision guard after many hours
      material.setFloat("uDrift", drift);
      material.setVector3("uLightDir", s.cloudLightDir);
      material.setColor3("uLit", s.cloudLit);
      material.setColor3("uShade", s.cloudShade);
      material.setColor3("uHaze", s.horizon);
    },
  };
}

// Rig: proportions, the head shape (shared by geometry and the eye layout),
// the TransformNode joint hierarchy and the skeleton that skins the single
// character mesh. Every bone is linked to a TransformNode, so the animator
// simply sets node rotations/positions and Babylon updates the bones.

import { TransformNode, Skeleton, Bone, Matrix, Quaternion } from "@babylonjs/core";
import { superR, norm3, dot3, add3, mul3, sub3, cross3, smoothstep, lerp, fromMatrix } from "./geometry.js";

/** Body proportions in meters (before the per-character height scale). */
export function makeDims(look) {
  const W = look.width ?? 1;
  return {
    W,
    ankleH: 0.085, // ankle joint above the sole
    thigh: 0.21,
    shin: 0.21,
    hipX: 0.085 * lerp(1, W, 0.6),
    hipDY: -0.045, // hip joints relative to the hips node
    hipsY: 0.55, // => hip joints at 0.505 = ankleH + thigh + shin
    pivotY: 0.74, // somersault pivot (belly)
    spineDY: 0.07,
    neckDY: 0.34,
    headCY: 0.26, // head center above the neck pivot
    shoulderX: 0.168 * W,
    shoulderY: 0.25,
    upperArm: 0.145,
    handY: -0.17, // hand center below the elbow
    torsoC: 0.14, // torso (egg) center above the spine joint
  };
}

/**
 * Head shape: a slightly wide ellipsoid with soft chubby cheeks.
 * R(d) gives the surface radius along unit direction d from the head center.
 */
export function makeHead(dims) {
  const base = superR(0.282, 0.262, 0.266);
  const cheekL = norm3([-0.62, -0.5, 0.6]);
  const cheekR = norm3([0.62, -0.5, 0.6]);
  const R = (d) => {
    let r = base(d);
    const a = Math.max(dot3(d, cheekL), dot3(d, cheekR));
    r *= 1 + 0.03 * smoothstep(0.75, 1, a);
    // a touch flatter at the very back so caps/hair sit nicely
    if (d[2] < -0.6) r *= 1 - 0.02 * smoothstep(-0.6, -1, d[2]);
    return r;
  };
  const center = [0, dims.headCY, 0];
  /** Point on (or `off` above) the head surface, in head-bone space. */
  const surf = (d, off = 0) => add3(center, mul3(d, R(d) + off));
  /** Outward surface normal along direction d (numeric). */
  const normal = (d) => {
    const h = 1e-3;
    const up = Math.abs(d[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
    const t1 = norm3(cross3(up, d));
    const t2 = cross3(d, t1);
    const P = (dd) => mul3(dd, R(dd));
    const a = sub3(P(norm3(add3(d, mul3(t1, h)))), P(norm3(sub3(d, mul3(t1, h)))));
    const b = sub3(P(norm3(add3(d, mul3(t2, h)))), P(norm3(sub3(d, mul3(t2, h)))));
    let n = norm3(cross3(a, b));
    if (dot3(n, d) < 0) n = mul3(n, -1);
    return n;
  };
  /** Unit direction from a polar angle th (from the top) and azimuth az (0 = front, +π/2 = +X). */
  const dirAt = (th, az) => [Math.sin(th) * Math.sin(az), Math.cos(th), Math.sin(th) * Math.cos(az)];
  return { R, center, surf, normal, dirAt };
}

/** Face anchor directions (from the head center) and eye placement. */
export function makeFace(look, head) {
  const es = look.eyeScale ?? 1;
  const eyeDir = (side) => norm3([0.37 * side, -0.07, 0.93]);
  const eye = (side) => {
    const d = eyeDir(side);
    const n = head.normal(d);
    const facing = norm3([n[0] * 0.8, n[1] * 0.35 + 0.02, n[2]]);
    const scale = [0.049 * es, 0.064 * es, 0.031 * es];
    const pos = sub3(head.surf(d), mul3(n, 0.5 * scale[2]));
    const rot = [Math.asin(-facing[1]), Math.atan2(facing[0], facing[2]), 0];
    return { dir: d, pos, rot, scale, normal: n };
  };
  return {
    eyeL: eye(-1),
    eyeR: eye(1),
    browDir: (side) => norm3([0.36 * side, 0.2, 0.92]),
    noseDir: norm3([0, -0.19, 1]),
    mouthDir: norm3([0, -0.35, 0.93]),
    cheekDir: (side) => norm3([0.57 * side, -0.33, 0.76]),
    earDir: (side) => norm3([side, -0.1, 0.06]),
  };
}

/**
 * Build the joint hierarchy under `root`. Returns { nodes, names, binds, index }.
 * binds[name] is the bone's rest transform in mesh (root) space.
 */
export function buildRig(scene, root, look, dims, head, face, prefix) {
  const d = dims;
  const mouthP = head.surf(face.mouthDir, 0);
  const spec = [
    ["body", null, [0, 0, 0]],
    ["pivot", "body", [0, d.pivotY, 0]],
    ["hips", "pivot", [0, d.hipsY - d.pivotY, 0]],
    ["spine", "hips", [0, d.spineDY, 0]],
    ["chest", "spine", [0, 0, 0]],
    ["pack", "chest", [0, 0.29, -0.15]],
    ["head", "spine", [0, d.neckDY, 0]],
    ["brows", "head", head.center],
    ["mouthA", "head", mouthP],
    ["mouthB", "head", mouthP],
    ["eyeL", "head", face.eyeL.pos, face.eyeL.rot, face.eyeL.scale],
    ["eyeballL", "eyeL", [0, 0, 0]],
    ["lidL", "eyeL", [0, 0, 0]],
    ["eyeR", "head", face.eyeR.pos, face.eyeR.rot, face.eyeR.scale],
    ["eyeballR", "eyeR", [0, 0, 0]],
    ["lidR", "eyeR", [0, 0, 0]],
    ["dangle", "head", head.surf(norm3([0, 0.3, -0.95]), 0.0)],
    ["shoulderL", "spine", [-d.shoulderX, d.shoulderY, 0]],
    ["elbowL", "shoulderL", [0, -d.upperArm, 0]],
    ["shoulderR", "spine", [d.shoulderX, d.shoulderY, 0]],
    ["elbowR", "shoulderR", [0, -d.upperArm, 0]],
    ["thighL", "hips", [-d.hipX, d.hipDY, 0]],
    ["kneeL", "thighL", [0, -d.thigh, 0]],
    ["ankleL", "kneeL", [0, -d.shin, 0]],
    ["thighR", "hips", [d.hipX, d.hipDY, 0]],
    ["kneeR", "thighR", [0, -d.thigh, 0]],
    ["ankleR", "kneeR", [0, -d.shin, 0]],
  ];
  const nodes = {};
  const names = [];
  const rest = {};
  const parents = {};
  for (const [name, parent, pos, rot, scl] of spec) {
    parents[name] = parent;
    const n = new TransformNode(`${prefix}_${name}`, scene);
    n.parent = parent ? nodes[parent] : root;
    n.position.set(pos[0], pos[1], pos[2]);
    if (rot) n.rotation.set(rot[0], rot[1], rot[2]);
    if (scl) n.scaling.set(scl[0], scl[1], scl[2]);
    nodes[name] = n;
    names.push(name);
    rest[name] = { pos: n.position.clone(), rot: n.rotation.clone(), scl: n.scaling.clone() };
  }
  // Bind transforms (root is fresh/identity, so world == mesh space).
  root.computeWorldMatrix(true);
  const binds = {};
  const index = {};
  names.forEach((name, i) => {
    binds[name] = fromMatrix(nodes[name].computeWorldMatrix(true));
    index[name] = i;
  });
  return { nodes, names, binds, index, rest, parents };
}

let skeletonCount = 0;

/** Create a skeleton whose bones follow the rig's TransformNodes. */
export function attachSkeleton(scene, mesh, rig, prefix) {
  const skeleton = new Skeleton(`${prefix}_skeleton`, `${prefix}_skeleton_${++skeletonCount}`, scene);
  const bones = {};
  const q = new Quaternion();
  for (const name of rig.names) {
    const node = rig.nodes[name];
    Quaternion.FromEulerAnglesToRef(node.rotation.x, node.rotation.y, node.rotation.z, q);
    const local = Matrix.Compose(node.scaling, q, node.position);
    const parentName = rig.parents[name];
    const bone = new Bone(`${prefix}_${name}_bone`, skeleton, parentName ? bones[parentName] : null, local);
    bone.linkTransformNode(node);
    bones[name] = bone;
  }
  mesh.skeleton = skeleton;
  mesh.numBoneInfluencers = 1;
  return skeleton;
}

// createCharacter — a procedural cartoon person (the hero "Pip" and the
// townsfolk), built from primitives and animated in code.
//
// The whole body is ONE vertex-colored mesh (a single draw call) that is
// rigidly skinned to a skeleton whose bones follow a TransformNode joint
// hierarchy (body → pivot → hips → spine → head / arms, hips → legs). The
// hero's cartoon outline is an inverted hull baked into the same mesh.
// See ARCHITECTURE.md "Character" for the contract.

import { TransformNode, BoundingInfo, Vector3 } from "@babylonjs/core";
import { toonMat } from "./materials.js";
import { makeRng } from "./palette.js";
import { resolveLook } from "./character/looks.js";
import { makeDims, makeHead, makeFace, buildRig, attachSkeleton } from "./character/rig.js";
import { buildGeometry } from "./character/parts.js";
import { Animator } from "./character/animator.js";

let instanceCount = 0;

/**
 * @param {import("@babylonjs/core").Scene} scene
 * @param {{name?:string, preset?:"hero"|"random", seed?:number, skin?:string, hair?:string,
 *   hairStyle?:string, shirt?:string, pants?:string, shoes?:string, accessory?:string,
 *   headwear?:string, scale?:number, outline?:boolean, lod?:"high"|"low"}} [opts]
 * @returns {{root: TransformNode, meshes: import("@babylonjs/core").AbstractMesh[], state: string,
 *   setState(s:string):void, update(dt:number, o?:{speed?:number}):void,
 *   setLookAt(p:import("@babylonjs/core").Vector3|null):void, dispose():void}}
 */
export function createCharacter(scene, opts = {}) {
  const id = ++instanceCount;
  const name = String(opts.name ?? (opts.preset === "hero" ? "Pip" : `Townsfolk${opts.seed ?? id}`));
  const prefix = `char${id}_${name.replace(/\W+/g, "")}`;
  const lod = opts.lod === "low" ? "low" : "high";
  const outline = opts.outline !== false;
  const look = resolveLook(opts);
  const scale = (Number.isFinite(opts.scale) && opts.scale > 0 ? opts.scale : 1) * (look.height ?? 1);

  const root = new TransformNode(prefix, scene);
  const dims = makeDims(look);
  const head = makeHead(dims);
  const face = makeFace(look, head);
  const rig = buildRig(scene, root, look, dims, head, face, prefix);

  // Shared by every character. A little self-illumination keeps the toon
  // colors bright in shadow and the faces readable at night.
  const material = toonMat(scene, "#ffffff", { specular: 0.05, emissive: 0.1, name: "character_vertexColor" });
  const buf = buildGeometry(look, rig, dims, head, face, { lod, outline });
  const mesh = buf.toMesh(`${prefix}_mesh`, scene, material);
  mesh.parent = root;
  mesh.receiveShadows = true;
  attachSkeleton(scene, mesh, rig, prefix);
  // Skinned vertices move outside the rest-pose box (flips, waving arms):
  // use a generous fixed box so the character is never culled while visible.
  mesh.setBoundingInfo(new BoundingInfo(new Vector3(-1, -0.6, -1).scaleInPlace(scale), new Vector3(1, 2.4, 1).scaleInPlace(scale)));

  const seed = opts.preset === "hero" ? 7 : (opts.seed ?? id) * 31 + 5;
  const anim = new Animator(root, rig, dims, makeRng(seed), scale);
  anim.update(0, 0);

  let disposed = false;
  return {
    root,
    meshes: [mesh],
    /** Joint TransformNodes (e.g. attach props to `nodes.elbowR`). */
    nodes: rig.nodes,
    look,
    height: 1.55 * scale,
    get state() {
      return anim.state;
    },
    setState(s) {
      anim.setState(s);
    },
    update(dt, o) {
      if (disposed) return;
      try {
        anim.update(dt, o?.speed);
      } catch (err) {
        // never throw from update(); log once per character
        if (!anim.failed) console.warn(`[character] ${name} update failed`, err);
        anim.failed = true;
      }
    },
    setLookAt(p) {
      anim.setLookAt(p);
    },
    /** Optional: callback(side) fired when a foot plants while walking/running (for footstep sounds/dust). */
    get onStep() {
      return anim.onStep;
    },
    set onStep(fn) {
      anim.onStep = typeof fn === "function" ? fn : null;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      const skeleton = mesh.skeleton;
      mesh.dispose(false, false); // shared material stays cached
      skeleton?.dispose();
      root.dispose(false, false);
    },
  };
}

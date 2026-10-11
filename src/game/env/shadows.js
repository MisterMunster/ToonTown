// One PCF ShadowGenerator on the key (sun/moon) light. The orthographic shadow
// frustum is a fixed ~70 m square that follows the focus point every frame,
// snapped to whole shadow-map texels in light space so edges never shimmer as
// the player moves. Casters are tracked by root node so TransformNode roots
// (e.g. the hero) work, and meshes parented later are picked up automatically.
import { AbstractMesh, Material, ShadowGenerator, Vector3 } from "@babylonjs/core";

const FRUSTUM_SIZE = 70; // metres, square
const EYE_DISTANCE = 220; // light "eye" distance behind the focus point
const Z_RANGE_BEHIND = 180; // depth kept past the focus (long low-sun shadows)

const MAP_SIZE = { low: 1024, medium: 2048, high: 2048 };
const FRONT_FACE_BIAS = 0.0003; // characters & flagged meshes (≈ 6 cm over the 400 m range)
const FRONT_FACE_NORMAL_BIAS = 0.03; // metres
const NORMAL_BIAS = { low: 0.02, medium: 0.015, high: 0.015 }; // metres
const FILTER = { low: ShadowGenerator.QUALITY_MEDIUM, medium: ShadowGenerator.QUALITY_HIGH, high: ShadowGenerator.QUALITY_HIGH };

/**
 * @param {import("@babylonjs/core").Scene} scene
 * @param {import("@babylonjs/core").DirectionalLight} light
 * @param {"low"|"medium"|"high"} quality
 */
export function createShadows(scene, light, quality) {
  let level = MAP_SIZE[quality] ? quality : "high";
  const generator = new ShadowGenerator(MAP_SIZE[level], light);
  generator.usePercentageCloserFiltering = true;
  generator.filteringQuality = FILTER[level];
  // Closed static meshes put only their back faces in the map, so lit faces
  // are compared against the far side of their own mesh: no acne even on
  // walls lit at grazing angles at golden hour, and the depth bias can stay
  // tiny (≈ 4 cm) so contact shadows stay glued to feet and building bases.
  // Exceptions get normal culling (see meshPass below).
  generator.forceBackFacesOnly = true;
  generator.bias = 0.0002;
  generator.normalBias = NORMAL_BIAS[level];

  // Per-mesh override, applied right before each shadow-map draw:
  //  - double-sided materials (flags, cards) cast from both sides;
  //  - skinned meshes (characters carry a baked inverted-hull outline whose
  //    flipped near side would otherwise land in front of the body and
  //    self-shadow it) and meshes flagged metadata.shadowFrontFaces use normal
  //    culling, with a slightly larger bias since they lose the back-face trick.
  const engine = scene.getEngine();
  let frontFaceMesh = false;
  const meshPass = generator.onBeforeShadowMapRenderMeshObservable.add((mesh) => {
    const mat = mesh.material;
    frontFaceMesh = false;
    if (!mat) return;
    if (mat.backFaceCulling === false) {
      engine.setState(false, 0, false, false, mat.cullBackFaces);
    } else if (mesh.skeleton || mesh.metadata?.shadowFrontFaces) {
      const orientation = mat.sideOrientation ?? mesh.sideOrientation;
      engine.setState(true, 0, false, orientation === Material.ClockWiseSideOrientation, mat.cullBackFaces);
      frontFaceMesh = true;
    }
  });
  const effectPass = generator.onBeforeShadowMapRenderObservable.add((effect) => {
    if (frontFaceMesh) effect.setFloat3("biasAndScaleSM", FRONT_FACE_BIAS, FRONT_FACE_NORMAL_BIAS, generator.depthScale);
  });
  generator.darkness = 0.3;
  generator.frustumEdgeFalloff = 0.2;

  light.autoUpdateExtends = false;
  light.autoCalcShadowZBounds = false;
  light.shadowFrustumSize = FRUSTUM_SIZE;
  light.shadowMinZ = 1;
  light.shadowMaxZ = EYE_DISTANCE + Z_RANGE_BEHIND;

  // ---- caster tracking ---------------------------------------------------
  /** root node -> includeDescendants */
  const roots = new Map();
  /** meshes we put in the render list (fast membership test) */
  const registered = new Set();
  let dirty = false;
  let framesSinceScan = 0;
  const newMeshObserver = scene.onNewMeshAddedObservable.add(() => {
    dirty = true;
  });

  const renderList = () => {
    const map = generator.getShadowMap();
    if (!map) return null;
    if (!map.renderList) map.renderList = [];
    return map.renderList;
  };

  function addMesh(list, m) {
    if (!(m instanceof AbstractMesh) || registered.has(m) || m.isDisposed()) return;
    registered.add(m);
    if (list.indexOf(m) === -1) list.push(m);
  }

  function registerRoot(node, includeDescendants) {
    const list = renderList();
    if (!list) return;
    addMesh(list, node); // TransformNode roots (e.g. the hero) are skipped, their meshes are not
    if (includeDescendants && typeof node.getChildMeshes === "function") {
      for (const m of node.getChildMeshes(false)) addMesh(list, m);
    }
  }

  /** Pick up meshes created/parented under registered roots since the last scan. */
  function rescan() {
    dirty = false;
    framesSinceScan = 0;
    for (const m of registered) if (m.isDisposed()) registered.delete(m);
    for (const [node, incl] of roots) {
      if (node.isDisposed?.()) roots.delete(node);
      else if (incl) registerRoot(node, true);
    }
  }

  function addShadowCaster(node, includeDescendants = true) {
    if (!node) return;
    roots.set(node, includeDescendants);
    registerRoot(node, includeDescendants);
  }

  function removeShadowCaster(node) {
    if (!node) return;
    const incl = roots.get(node) ?? true;
    roots.delete(node);
    const list = renderList();
    const drop = (m) => {
      registered.delete(m);
      const i = list ? list.indexOf(m) : -1;
      if (i !== -1) list.splice(i, 1);
    };
    drop(node);
    if (incl && typeof node.getChildMeshes === "function") {
      for (const m of node.getChildMeshes(false)) drop(m);
    }
  }

  // ---- frustum follow (allocation-free) ------------------------------------
  const up = new Vector3(0, 1, 0);
  const zAxis = new Vector3();
  const xAxis = new Vector3();
  const yAxis = new Vector3();
  const eye = new Vector3();
  light.position = eye; // we mutate this vector in place each frame

  /**
   * @param {Vector3} focus world point to centre the shadow square on
   * @param {Vector3} dir   direction the light travels (normalised)
   */
  function follow(focus, dir) {
    // Throttled: meshes parented under a registered root show up within a few frames.
    if (dirty && ++framesSinceScan >= 8) rescan();
    // Same basis Babylon's LookAtLH builds for the shadow view matrix.
    zAxis.copyFrom(dir).normalize();
    Vector3.CrossToRef(up, zAxis, xAxis);
    const lx = xAxis.lengthSquared();
    if (lx < 1e-10) xAxis.set(1, 0, 0);
    else xAxis.scaleInPlace(1 / Math.sqrt(lx));
    Vector3.CrossToRef(zAxis, xAxis, yAxis);
    yAxis.normalize();

    const texel = FRUSTUM_SIZE / generator.mapSize;
    const sx = Math.round(Vector3.Dot(focus, xAxis) / texel) * texel;
    const sy = Math.round(Vector3.Dot(focus, yAxis) / texel) * texel;
    const sz = Vector3.Dot(focus, zAxis) - EYE_DISTANCE;
    eye.set(
      xAxis.x * sx + yAxis.x * sy + zAxis.x * sz,
      xAxis.y * sx + yAxis.y * sy + zAxis.y * sz,
      xAxis.z * sx + yAxis.z * sy + zAxis.z * sz,
    );
  }

  function setQuality(q) {
    if (!MAP_SIZE[q] || q === level) return;
    level = q;
    generator.filteringQuality = FILTER[q];
    generator.normalBias = NORMAL_BIAS[q];
    if (generator.mapSize !== MAP_SIZE[q]) generator.mapSize = MAP_SIZE[q]; // keeps the render list
  }

  function dispose() {
    scene.onNewMeshAddedObservable.remove(newMeshObserver);
    generator.onBeforeShadowMapRenderMeshObservable.remove(meshPass);
    generator.onBeforeShadowMapRenderObservable.remove(effectPass);
    generator.dispose();
  }

  return { generator, addShadowCaster, removeShadowCaster, follow, setQuality, dispose };
}

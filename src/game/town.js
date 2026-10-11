// Toon Town — the static world. Builds roads, the square with its fountain,
// ~35 buildings, Maple Park, street furniture and the countryside, registers
// every solid thing with the collider world, and exposes the gameplay data
// described in ARCHITECTURE.md (spawn, bounds, map, landmarks, zones, NPC
// paths, coin spots) plus per-frame animation and night lighting hooks.
//
// Rendering strategy: nearly everything is modelled into a few shared,
// vertex-coloured buckets (see town/geo.js) that are merged into one mesh per
// material per 56 m chunk, so the whole town costs well under 100 draw calls.
import { Vector3, TransformNode } from "@babylonjs/core";
import { makeRng } from "./palette.js";
import { Geo, soloMesh } from "./town/geo.js";
import { BOUNDS, PLAZA_Y, chunkOf } from "./town/layout.js";
import { createTownMaterials } from "./town/mats.js";
import { createSignAtlas } from "./town/signs.js";
import { buildStreets } from "./town/roads.js";
import { buildSquare, attachSquareLights } from "./town/square.js";
import { buildBuildings } from "./town/buildings.js";
import { buildStreetLife } from "./town/street.js";
import { buildPark } from "./town/park.js";
import { buildOutskirts } from "./town/outskirts.js";
import { makeZones, makeNpcPaths, makeCoins } from "./town/data.js";

const smooth = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function defineBuckets(geo, mats) {
  const chunk = chunkOf;
  geo.define("solid", { material: mats.solid, chunk, cast: true });
  geo.define("flat", { material: mats.solid, chunk });
  geo.define("cloth", { material: mats.cloth, cast: true });
  for (const g of ["glass0", "glass1", "glass2", "glassShop", "glassDark"]) {
    geo.define(g, { material: mats[g], uvs: true, colors: false });
  }
  geo.define("bulb", { material: mats.bulb, colors: false, receive: false });
  geo.define("fairy", { material: mats.fairy, receive: false });
  geo.define("sign", { material: mats.sign, uvs: true, colors: false });
  geo.define("water", { material: mats.water, uvs: true, colors: false });
  geo.define("stream", { material: mats.stream, uvs: true, colors: false, receive: false });
  geo.define("pool", { material: mats.pool, uvs: true, colors: false, receive: false });
}

/** Clock hands on every Town Hall clock face, driven by env.timeOfDay. */
function makeClock(ctx) {
  const { scene, mats } = ctx;
  const hands = [];
  ctx.clockFaces.forEach((face, i) => {
    const pivot = new TransformNode(`town_clock${i}`, scene);
    pivot.position.set(face.pos[0], face.pos[1], face.pos[2]);
    pivot.rotation.y = face.yaw;
    const hour = soloMesh(scene, `town_clockHour${i}`, mats.solid, (m) => {
      m.box("m", "#2b2b35", 0, 0.32, 0.02, 0.13, 0.72, 0.04);
      m.box("m", "#2b2b35", 0, 0.62, 0.02, 0.2, 0.14, 0.04, [0, 0, Math.PI / 4]);
    });
    const minute = soloMesh(scene, `town_clockMinute${i}`, mats.solid, (m) => {
      m.box("m", "#2b2b35", 0, 0.46, 0.05, 0.08, 1.02, 0.04);
      m.sphere("m", "#d4a017", 0, 0, 0.08, 0.16, 0.16, 0.08, 6);
    });
    hour.parent = pivot;
    minute.parent = pivot;
    hands.push({ hour, minute });
  });
  return (hours) => {
    const h = ((hours % 24) + 24) % 24;
    // positive z-rotation turns clockwise for a viewer in front of the face
    const ha = ((h % 12) / 12) * Math.PI * 2;
    const ma = (h % 1) * Math.PI * 2;
    for (const { hour, minute } of hands) {
      hour.rotation.z = ha;
      minute.rotation.z = ma;
    }
  };
}

/**
 * Build the whole town.
 * @param {import("@babylonjs/core").Scene} scene
 * @param {object} env  environment API (addShadowCaster, timeOfDay, nightFactor)
 * @param {import("./colliders.js").ColliderWorld} colliders
 * @param {{ quality?: "low"|"medium"|"high" }} [opts]
 */
export function createTown(scene, env, colliders, { quality = "high" } = {}) {
  const mats = createTownMaterials(scene);
  const atlas = createSignAtlas(scene, quality === "low" ? 1024 : 2048);
  mats.sign.diffuseTexture = atlas.texture;
  const geo = new Geo(scene);
  defineBuckets(geo, mats);

  const ctx = {
    scene,
    env,
    colliders,
    quality,
    lowDetail: quality === "low",
    rng: makeRng(20261010),
    geo,
    root: geo.root(),
    mats,
    atlas,
    map: [],
    landmarks: [],
    footprints: [],
    clockFaces: [],
    anim: [],
  };

  buildStreets(ctx);
  buildSquare(ctx);
  buildBuildings(ctx);
  buildStreetLife(ctx);
  buildPark(ctx);
  buildOutskirts(ctx);
  atlas.finish();

  // ---- bake buckets into meshes, register shadows ---------------------------
  const built = geo.build("town");
  const centre = [];
  for (const { mesh, cast, chunk, bucket } of built) {
    if (cast && env?.addShadowCaster) env.addShadowCaster(mesh, false);
    if (chunk === "c0_0" && (bucket === "solid" || bucket === "flat")) centre.push(mesh);
  }
  const lights = attachSquareLights(ctx, centre);
  const setClock = makeClock(ctx);

  // ---- gameplay data -------------------------------------------------------
  const spawnPoint = new Vector3(0, PLAZA_Y, -10);
  const zones = makeZones();
  const npcPaths = makeNpcPaths(ctx);
  const coinSpots = makeCoins(ctx);
  const poolMesh = built.find((b) => b.bucket === "pool")?.mesh ?? null;

  let night = -1;
  function setNightFactor(f) {
    const v = Math.max(0, Math.min(1, Number(f) || 0));
    if (Math.abs(v - night) < 0.004) return;
    night = v;
    mats.setNight(v);
    const li = 1.15 * smooth(0.15, 0.6, v);
    // lights stay enabled (intensity 0 by day) so no shader variant swap at dusk
    for (const l of lights) l.intensity = li;
    if (poolMesh) poolMesh.isVisible = v > 0.05;
  }
  setNightFactor(env?.nightFactor ?? 0);

  let warned = false;
  function update(dt, t) {
    try {
      mats.tick(t);
      for (const fn of ctx.anim) fn(dt, t);
      const hours = env?.timeOfDay;
      setClock(Number.isFinite(hours) ? hours : 12);
    } catch (err) {
      if (!warned) console.warn("[town] update failed", err);
      warned = true;
    }
  }
  update(0, 0);

  return {
    spawnPoint,
    spawnHeading: 0,
    bounds: { ...BOUNDS },
    mapFeatures: ctx.map,
    landmarks: ctx.landmarks,
    zones,
    npcPaths,
    coinSpots,
    setNightFactor,
    update,
    /** Debug info: mesh / vertex counts per bucket. */
    stats: {
      meshes: built.length,
      vertices: built.reduce((n, b) => n + b.mesh.getTotalVertices(), 0),
      colliders: colliders.list?.length ?? 0,
    },
  };
}

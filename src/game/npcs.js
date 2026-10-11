// NPCs & ambient wildlife: named townsfolk strolling the sidewalks (they wave
// and chat when Pip comes close), a flock of birds over the rooftops,
// butterflies in the park and Biscuit the park dog. See ARCHITECTURE.md
// ("NPCs") for the contract.
//
// Pieces live in ./npcs/: townsfolk.js (walkers, avoidance, greetings),
// bubbles.js (speech bubbles), birds.js, butterflies.js, dog.js, partmesh.js
// (one-mesh CPU-animated critters), collide.js, path.js, places.js (where
// things happen) and lines.js (dialogue).

import { toonMat } from "./materials.js";
import { createTownsfolk } from "./npcs/townsfolk.js";
import { createBirds } from "./npcs/birds.js";
import { createButterflies } from "./npcs/butterflies.js";
import { createDog } from "./npcs/dog.js";
import { butterflyAnchors, townCentre, findPark } from "./npcs/places.js";

/**
 * @param {import("@babylonjs/core").Scene} scene
 * @param {object} env  environment API (addShadowCaster, nightFactor)
 * @param {import("./colliders.js").ColliderWorld} colliders
 * @param {object} town  town API (npcPaths, mapFeatures, landmarks, zones, spawnPoint)
 * @param {{ quality?: "low"|"medium"|"high", events?: any }} [opts]
 * @returns {{ update(dt:number, playerPos:import("@babylonjs/core").Vector3):void, positions:Array<{x:number,z:number}> }}
 */
export function createNPCs(scene, env, colliders, town, { quality = "high", events } = {}) {
  const low = quality === "low";
  const folk = createTownsfolk(scene, env, colliders, town, { quality, events });

  // Critters share the characters' matte vertex-colour material.
  const critterMat = toonMat(scene, "#ffffff", { specular: 0.05, emissive: 0.1, name: "character_vertexColor" });
  let birds = null;
  let butterflies = null;
  const anchors = butterflyAnchors(town, colliders);
  try {
    birds = createBirds(scene, env, critterMat, { count: low ? 7 : 11, center: townCentre(town), castShadows: !low });
  } catch (err) {
    console.warn("[npcs] birds unavailable", err);
  }
  try {
    butterflies = createButterflies(scene, env, colliders, critterMat, {
      count: low ? 6 : 9,
      anchors,
      castShadows: !low,
    });
  } catch (err) {
    console.warn("[npcs] butterflies unavailable", err);
  }

  // Biscuit the park dog (only if the town has a park)
  let dog = null;
  const park = findPark(town);
  const home = anchors[0];
  if (park && home && home.x > park.minX && home.x < park.maxX && home.z > park.minZ && home.z < park.maxZ) {
    try {
      dog = createDog(scene, env, colliders, critterMat, {
        park,
        home,
        paths: town?.npcPaths,
        townsfolk: folk.npcs,
        bubbles: folk.bubbles,
        events,
        castShadows: !low,
      });
    } catch (err) {
      console.warn("[npcs] dog unavailable", err);
    }
  }

  let warned = false;

  return {
    positions: folk.positions,
    /** Debug / tests: the townsfolk state objects and the butterfly hangouts. */
    townsfolk: folk.npcs,
    butterflyAnchors: anchors,
    /** Debug: wildlife state (birds.birds / butterflies.list). */
    wildlife: { birds, butterflies, dog },
    /**
     * @param {number} dt seconds
     * @param {import("@babylonjs/core").Vector3} playerPos hero feet position
     */
    update(dt, playerPos) {
      if (!(dt > 0)) return;
      try {
        const cam = scene.activeCamera;
        const camPos = cam ? cam.globalPosition : null;
        folk.update(dt, playerPos, camPos);
        birds?.update(dt);
        butterflies?.update(dt, playerPos, camPos);
        dog?.update(dt, playerPos, camPos);
      } catch (err) {
        if (!warned) console.warn("[npcs] update failed", err);
        warned = true;
      }
    },
    dispose() {
      folk.dispose();
      birds?.mesh.dispose();
      butterflies?.mesh.dispose();
      dog?.dispose();
    },
  };
}

#!/usr/bin/env node
/**
 * One-time (re-runnable, idempotent) source-asset fix for
 * public/models/modsnation_7416_assets_assembled.glb — see docs/INTEGRATION_GUIDE.md §3, "Two
 * defects found in the asset itself", for the full history. This is the closest thing to "fixing
 * it in Blender" achievable without Blender or the original .blend file: editing the shipped GLB
 * directly via gltf-transform, with the same verifiable result a Blender re-export would produce.
 *
 * Two independent fixes, both derived from data already present in the file — no geometry is
 * invented or guessed:
 *
 * 1. Reposition the four PLACED_AOOA_caliper_* nodes. They ship with no translation at all, so
 *    they render at BODY's local origin instead of at their wheel — an authoring defect, not
 *    donor junk (they are real, load-bearing geometry the catalog's hiddenNodeNames workaround
 *    was hiding). Every other per-wheel node (PLACED_KO3_*, PLACED_WEISU_*) already carries the
 *    correct translation for its wheel position, matching MOUNT_WHEEL_*'s own; copying that same
 *    translation onto the matching caliper node is a precise fix, not a 3D-authoring guess.
 *
 * 2. Delete the true donor nodes outright: 322-1790(MD010)(.001), BFGoodrich_ALL_Terrain_TA_KO2,
 *    FRONT_BRAKES, REAR_BRAKES, "Jet Black" — duplicate/unused geometry sitting at the world
 *    origin as siblings of the real vehicle hierarchy, previously hidden at runtime via
 *    `hiddenNodeNames` rather than actually removed. Their materials are reused BY INDEX (not by
 *    duplicated definition) by real, visible nodes elsewhere in the file (verified before writing
 *    this script — e.g. PLACED_AOOA_caliper_front_left's mesh and FRONT_BRAKES's mesh share the
 *    same four material indices but distinct geometry/accessors), so deleting the donor nodes and
 *    pruning their now-unreferenced meshes leaves every surviving material correctly bound.
 */
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { prune } from "@gltf-transform/functions";

const GLB_PATH = new URL("../public/models/modsnation_7416_assets_assembled.glb", import.meta.url);

const CALIPER_TO_WHEEL_NODE = {
  PLACED_AOOA_caliper_front_left: "PLACED_KO3_front_left",
  PLACED_AOOA_caliper_front_right: "PLACED_KO3_front_right",
  PLACED_AOOA_caliper_rear_left: "PLACED_KO3_rear_left",
  PLACED_AOOA_caliper_rear_right: "PLACED_KO3_rear_right",
};

const DONOR_NODE_NAMES = [
  "322-1790(MD010)",
  "322-1790(MD010).001",
  "BFGoodrich_ALL_Terrain_TA_KO2",
  "FRONT_BRAKES",
  "REAR_BRAKES",
  "Jet Black",
];

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const document = await io.read(GLB_PATH.pathname);
const root = document.getRoot();

let repositioned = 0;
for (const [caliperName, wheelName] of Object.entries(CALIPER_TO_WHEEL_NODE)) {
  const caliper = root.listNodes().find((n) => n.getName() === caliperName);
  const wheel = root.listNodes().find((n) => n.getName() === wheelName);
  if (!caliper) throw new Error(`Expected node "${caliperName}" not found — asset structure changed?`);
  if (!wheel) throw new Error(`Expected node "${wheelName}" not found — asset structure changed?`);
  caliper.setTranslation(wheel.getTranslation());
  repositioned += 1;
}

let removed = 0;
for (const name of DONOR_NODE_NAMES) {
  const node = root.listNodes().find((n) => n.getName() === name);
  if (!node) throw new Error(`Expected donor node "${name}" not found — already removed, or asset structure changed?`);
  node.dispose();
  removed += 1;
}

// Cleans up the meshes/accessors/buffer views the donor nodes leave unreferenced. Materials are
// pruned too where genuinely orphaned (one is: the donor "Jet Black" swatch sphere's material,
// used nowhere else — verified before writing this script) but left alone everywhere a real,
// surviving node still references the same material by index, which `prune()`'s reachability
// analysis handles correctly on its own.
//
// `keepLeaves: true` is required: without it, `prune()` also deletes every empty, mesh-less,
// child-less "leaf" node — which describes MOUNT_WHEEL_*, MOUNT_LICENSE_PLATE_*, and
// MOUNT_SOUND_EXHAUST just as well as it describes actual donor junk. Those mount nodes are real,
// load-bearing markers `VehicleCanvas.tsx`'s `installWheelAndTireAssets` and
// `lib/data/vehicles/4runner.ts`'s `wheelMountNames` resolve by name at runtime — nothing *inside*
// the glTF document itself references them, so a default `prune()` silently removed all seven and
// broke wheel/tire mounting entirely. Caught before this fix ever reached a commit by re-inspecting
// the node list after the first run.
await document.transform(prune({ keepLeaves: true }));

await io.write(GLB_PATH.pathname, document);

console.log(`Repositioned ${repositioned} caliper node(s); removed ${removed} donor node(s).`);

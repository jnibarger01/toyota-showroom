import type { SceneMapEntry } from "../../types/sceneMap";

/**
 * Semantic scene identity for `modsnation_7416_assets_assembled.glb` and, by construction, the
 * procedural fallback (`lib/three/proceduralParts.ts`'s `createProceduralVehicle` deliberately
 * mirrors this GLB's node and material names, per its own header comment) — one map serves both,
 * which is what "graceful behavior for vehicles whose node contracts are incomplete" means in
 * practice for this vehicle: the fallback resolves the object-level entries (wheels, tyres) and
 * the single-material `body.exterior` region, while multi-material regions the fallback has no
 * separate slots for (chrome, glass, individual light types) come back unsatisfied instead of
 * throwing.
 *
 * Node and material names are the same ones already load-bearing in
 * `lib/data/vehicles/4runner.ts` and `lib/data/options/4runner.ts` — read from the shipped asset,
 * not invented here.
 *
 * Entries for parts this GLB does not model as separate geometry (doors, mirrors, badge, roof, a
 * distinct interior) are still declared, exactly as `lib/data/vehicles/4runner.ts` forward-declares
 * `interior.seat`: `buildSceneRegistry` reports them unsatisfied so callers get a typed "not
 * available on this vehicle" instead of `SceneRegistry.get()` silently returning `undefined` for a
 * reason nobody recorded.
 */
export const FOUR_RUNNER_SCENE_MAP: SceneMapEntry[] = [
  {
    id: "vehicle.root",
    type: "vehicle",
    label: "Vehicle",
    capabilities: ["selectable"],
    match: { kind: "object", objectName: "VEHICLE_ROOT" },
  },

  {
    id: "body.exterior",
    type: "body",
    label: "Exterior paint",
    capabilities: ["selectable", "paintable", "highlightable"],
    match: { kind: "material-region", objectName: "BODY", materialNames: ["body.carmain"] },
  },
  {
    id: "body.trim.chrome",
    type: "trim",
    label: "Chrome trim",
    capabilities: ["selectable", "highlightable"],
    match: { kind: "material-region", objectName: "BODY", materialNames: ["metal.chrome.004"] },
  },
  {
    id: "body.grille",
    type: "trim",
    label: "Grille",
    capabilities: ["selectable", "highlightable"],
    match: { kind: "object", objectName: "Tun_GRILLE" },
  },

  {
    id: "glass.windshield",
    type: "glass",
    label: "Windshield",
    capabilities: ["selectable"],
    match: { kind: "material-region", objectName: "BODY", materialNames: ["glass.windows.windshield"] },
  },
  {
    id: "glass.rear-windshield",
    type: "glass",
    label: "Rear windshield",
    capabilities: ["selectable"],
    match: { kind: "material-region", objectName: "BODY", materialNames: ["glass.windows.rear.windshield"] },
  },
  {
    id: "glass.windows",
    type: "glass",
    label: "Side windows",
    capabilities: ["selectable"],
    match: { kind: "material-region", objectName: "BODY", materialNames: ["glass.windows"] },
  },

  {
    id: "headlight.assembly",
    type: "light",
    label: "Headlights",
    capabilities: ["selectable", "highlightable", "light"],
    match: { kind: "material-region", objectName: "BODY", materialNames: ["glass.light.002"] },
  },
  {
    id: "light.foglight",
    type: "light",
    label: "Fog lights",
    capabilities: ["selectable", "light"],
    match: { kind: "material-region", objectName: "BODY", materialNames: ["emissive.foglight"] },
  },
  {
    id: "light.brakelight",
    type: "light",
    label: "Brake lights",
    capabilities: ["selectable", "light"],
    match: { kind: "material-region", objectName: "BODY", materialNames: ["emissive.brakelights.001"] },
  },
  {
    id: "light.turnsignal",
    type: "light",
    label: "Turn signals",
    capabilities: ["selectable", "light"],
    match: { kind: "material-region", objectName: "BODY", materialNames: ["emissive.turnsignal.002"] },
  },

  {
    id: "wheel.front-left",
    type: "wheel",
    label: "Front-left wheel",
    capabilities: ["selectable", "highlightable", "wheel"],
    match: { kind: "object", objectName: "PLACED_WEISU_front_left" },
  },
  {
    id: "wheel.front-right",
    type: "wheel",
    label: "Front-right wheel",
    capabilities: ["selectable", "highlightable", "wheel"],
    match: { kind: "object", objectName: "PLACED_WEISU_front_right" },
  },
  {
    id: "wheel.rear-left",
    type: "wheel",
    label: "Rear-left wheel",
    capabilities: ["selectable", "highlightable", "wheel"],
    match: { kind: "object", objectName: "PLACED_WEISU_rear_left" },
  },
  {
    id: "wheel.rear-right",
    type: "wheel",
    label: "Rear-right wheel",
    capabilities: ["selectable", "highlightable", "wheel"],
    match: { kind: "object", objectName: "PLACED_WEISU_rear_right" },
  },

  {
    id: "tire.front-left",
    type: "tire",
    label: "Front-left tire",
    capabilities: ["selectable", "tire"],
    match: { kind: "object", objectName: "PLACED_KO3_front_left" },
  },
  {
    id: "tire.front-right",
    type: "tire",
    label: "Front-right tire",
    capabilities: ["selectable", "tire"],
    match: { kind: "object", objectName: "PLACED_KO3_front_right" },
  },
  {
    id: "tire.rear-left",
    type: "tire",
    label: "Rear-left tire",
    capabilities: ["selectable", "tire"],
    match: { kind: "object", objectName: "PLACED_KO3_rear_left" },
  },
  {
    id: "tire.rear-right",
    type: "tire",
    label: "Rear-right tire",
    capabilities: ["selectable", "tire"],
    match: { kind: "object", objectName: "PLACED_KO3_rear_right" },
  },

  {
    id: "accessory.roof-rack",
    type: "accessory",
    label: "Roof rack",
    capabilities: ["selectable", "highlightable", "accessory"],
    match: { kind: "object", objectName: "ACCESSORY_ROOF_RACK" },
  },
  {
    id: "accessory.light-bar",
    type: "accessory",
    label: "Light bar",
    capabilities: ["selectable", "highlightable", "accessory"],
    match: { kind: "object", objectName: "ACCESSORY_LIGHT_BAR" },
  },
  {
    id: "accessory.rock-sliders",
    type: "accessory",
    label: "Rock sliders",
    capabilities: ["selectable", "highlightable", "accessory"],
    match: { kind: "object", objectName: "ACCESSORY_ROCK_SLIDERS" },
  },
  {
    id: "accessory.underglow",
    type: "accessory",
    label: "Underglow",
    capabilities: ["selectable", "accessory"],
    match: { kind: "object", objectName: "ACCESSORY_UNDERGLOW" },
  },
  {
    id: "accessory.fog-lights",
    type: "accessory",
    label: "Fog lights (accessory)",
    capabilities: ["selectable", "accessory"],
    match: { kind: "object", objectName: "ACCESSORY_FOG_LIGHTS" },
  },

  // --- Real, previously-unmapped geometry (P2 evidence pass) -----------------------------------
  // The five families below are nodes `npx tsx` dumped directly out of
  // `modsnation_7416_assets_assembled.glb` via `@gltf-transform/core`'s `NodeIO` — confirmed
  // present with real triangles and material names, not assumed from naming convention. All five
  // were previously absent from this map entirely: classification is REAL GEOMETRY EXISTS BUT MAP
  // IS INCOMPLETE for every entry below, the P2 case distinct from the door/mirror/interior/roof
  // block further down (ASSET DOES NOT CONTAIN SEPARATE GEOMETRY — confirmed absent from the same
  // node dump).

  // `LOGO` (2 materials: `plastik.all.001` backing, `metal.chrome.002` emblem) is the real front
  // badge — this replaces the previous `badge.front` entry, which forward-declared against
  // `BADGE_FRONT`, a name that does not exist anywhere in the asset and could never resolve. That
  // was a genuine defect (an incomplete map, not a missing asset), corrected here rather than left
  // forward-declared next to the parts that really are absent.
  {
    id: "badge.front",
    type: "badge",
    label: "Front badge",
    capabilities: ["selectable", "highlightable"],
    match: { kind: "material-region", objectName: "LOGO", materialNames: ["metal.chrome.002"] },
  },
  {
    id: "badge.backing",
    type: "badge",
    label: "Badge backing plate",
    capabilities: ["selectable", "highlightable"],
    match: { kind: "material-region", objectName: "LOGO", materialNames: ["plastik.all.001"] },
  },

  // `DEFAULT_HEADLIGHTS` is a real, separately-modeled headlight assembly (six materials, one per
  // primitive — the same one-primitive-one-material shape `findDedicatedMeshForMaterials`
  // documents for `BODY`), distinct from `headlight.assembly` above, which addresses a glass-lens
  // patch baked directly into the `BODY` shell mesh itself. Both are real; they are not the same
  // geometry, so they keep separate IDs rather than one entry silently picking one over the other.
  {
    id: "headlight.lens",
    type: "light",
    label: "Headlight lens",
    capabilities: ["selectable", "highlightable"],
    match: { kind: "material-region", objectName: "DEFAULT_HEADLIGHTS", materialNames: ["glass.light"] },
  },
  {
    id: "headlight.bezel",
    type: "trim",
    label: "Headlight bezel",
    capabilities: ["selectable", "highlightable"],
    match: { kind: "material-region", objectName: "DEFAULT_HEADLIGHTS", materialNames: ["metal.chrome.001"] },
  },
  {
    id: "headlight.housing",
    type: "trim",
    label: "Headlight housing",
    capabilities: ["selectable", "highlightable"],
    match: { kind: "material-region", objectName: "DEFAULT_HEADLIGHTS", materialNames: ["plastik.all"] },
  },
  {
    id: "headlight.sidelight",
    type: "light",
    label: "Headlight sidelight",
    capabilities: ["selectable", "light"],
    match: { kind: "material-region", objectName: "DEFAULT_HEADLIGHTS", materialNames: ["emissive.sidelights"] },
  },
  {
    id: "headlight.turnsignal",
    type: "light",
    label: "Front turn signal",
    capabilities: ["selectable", "light"],
    match: { kind: "material-region", objectName: "DEFAULT_HEADLIGHTS", materialNames: ["emissive.turnsignal"] },
  },
  {
    id: "headlight.beam",
    type: "light",
    label: "Headlight beam",
    capabilities: ["selectable", "light"],
    match: { kind: "material-region", objectName: "DEFAULT_HEADLIGHTS", materialNames: ["emissive.headlight"] },
  },

  // `DEFAULT_TAILLIGHTS` mirrors `DEFAULT_HEADLIGHTS`'s shape at the rear (six materials, six
  // primitives), distinct from `light.brakelight`/`light.turnsignal` above, which address the
  // `BODY` shell's own emissive regions.
  {
    id: "taillight.lens",
    type: "light",
    label: "Taillight lens",
    capabilities: ["selectable", "highlightable"],
    match: { kind: "material-region", objectName: "DEFAULT_TAILLIGHTS", materialNames: ["glass.light.001"] },
  },
  {
    id: "taillight.bezel",
    type: "trim",
    label: "Taillight bezel",
    capabilities: ["selectable", "highlightable"],
    match: { kind: "material-region", objectName: "DEFAULT_TAILLIGHTS", materialNames: ["metal.chrome.003"] },
  },
  {
    id: "taillight.housing",
    type: "trim",
    label: "Taillight housing",
    capabilities: ["selectable", "highlightable"],
    match: { kind: "material-region", objectName: "DEFAULT_TAILLIGHTS", materialNames: ["plastik.all.002"] },
  },
  {
    id: "taillight.brakelight",
    type: "light",
    label: "Rear brake light",
    capabilities: ["selectable", "light"],
    match: { kind: "material-region", objectName: "DEFAULT_TAILLIGHTS", materialNames: ["emissive.brakelights"] },
  },
  {
    id: "taillight.turnsignal",
    type: "light",
    label: "Rear turn signal",
    capabilities: ["selectable", "light"],
    match: { kind: "material-region", objectName: "DEFAULT_TAILLIGHTS", materialNames: ["emissive.turnsignal.001"] },
  },
  {
    id: "taillight.beam",
    type: "light",
    label: "Taillight beam",
    capabilities: ["selectable", "light"],
    match: { kind: "material-region", objectName: "DEFAULT_TAILLIGHTS", materialNames: ["emissive.taillight"] },
  },

  // `EXHAUST` and `Tow Hooks Compatible` are each a single primitive with one material — a plain
  // `THREE.Mesh`, not a `Group` (GLTFLoader only wraps multi-primitive meshes — see
  // `findDedicatedMeshForMaterials`'s doc comment), so an `object` match resolves them directly
  // with no material-region indirection needed.
  {
    id: "trim.exhaust-tip",
    type: "trim",
    label: "Exhaust tip",
    capabilities: ["selectable", "highlightable"],
    match: { kind: "object", objectName: "EXHAUST" },
  },
  {
    id: "trim.tow-hook",
    type: "trim",
    label: "Tow hook",
    capabilities: ["selectable", "highlightable"],
    match: { kind: "object", objectName: "Tow Hooks Compatible" },
  },

  // `PLACED_AOOA_caliper_*` — real brake calipers at all four corners, each with four materials
  // (`paint_brake_caliper`, `metal.chrome`, `Caliper_cover_logo`, `Red_wilwood`). Only the
  // paintable body of the caliper gets a semantic entry here — the Wilwood-branded cover and
  // chrome piston details are real but decorative, and P2 is scene identity coverage, not a new
  // customization option; a future caliper-color option could target `paint_brake_caliper`
  // directly through these same four ids with no scene-map change.
  {
    id: "caliper.front-left",
    type: "trim",
    label: "Front-left brake caliper",
    capabilities: ["selectable", "highlightable"],
    match: { kind: "material-region", objectName: "PLACED_AOOA_caliper_front_left", materialNames: ["paint_brake_caliper"] },
  },
  {
    id: "caliper.front-right",
    type: "trim",
    label: "Front-right brake caliper",
    capabilities: ["selectable", "highlightable"],
    match: { kind: "material-region", objectName: "PLACED_AOOA_caliper_front_right", materialNames: ["paint_brake_caliper"] },
  },
  {
    id: "caliper.rear-left",
    type: "trim",
    label: "Rear-left brake caliper",
    capabilities: ["selectable", "highlightable"],
    match: { kind: "material-region", objectName: "PLACED_AOOA_caliper_rear_left", materialNames: ["paint_brake_caliper"] },
  },
  {
    id: "caliper.rear-right",
    type: "trim",
    label: "Rear-right brake caliper",
    capabilities: ["selectable", "highlightable"],
    match: { kind: "material-region", objectName: "PLACED_AOOA_caliper_rear_right", materialNames: ["paint_brake_caliper"] },
  },

  // --- Forward-declared: confirmed absent from the asset (ASSET DOES NOT CONTAIN SEPARATE
  // GEOMETRY) --------------------------------------------------------------------------------
  // No separate geometry for these exists in the shipped GLB (it is an exterior body-shell
  // export). See file header.
  {
    id: "door.front-left",
    type: "door",
    label: "Front-left door",
    capabilities: ["selectable"],
    match: { kind: "object", objectName: "DOOR_FRONT_LEFT" },
  },
  {
    id: "door.front-right",
    type: "door",
    label: "Front-right door",
    capabilities: ["selectable"],
    match: { kind: "object", objectName: "DOOR_FRONT_RIGHT" },
  },
  {
    id: "mirror.left",
    type: "mirror",
    label: "Left mirror",
    capabilities: ["selectable"],
    match: { kind: "object", objectName: "MIRROR_LEFT" },
  },
  {
    id: "mirror.right",
    type: "mirror",
    label: "Right mirror",
    capabilities: ["selectable"],
    match: { kind: "object", objectName: "MIRROR_RIGHT" },
  },
  {
    id: "interior",
    type: "interior",
    label: "Interior",
    capabilities: ["selectable", "paintable"],
    match: { kind: "material-region", objectName: "BODY", materialNames: ["interior.seat"] },
  },
  {
    id: "roof",
    type: "roof",
    label: "Roof",
    capabilities: ["selectable"],
    match: { kind: "object", objectName: "ROOF" },
  },
];

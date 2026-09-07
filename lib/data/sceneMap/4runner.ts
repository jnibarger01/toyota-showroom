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

  // Forward-declared — no separate geometry for these exists in the shipped GLB yet (it is an
  // exterior body-shell export). See file header.
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
    id: "badge.front",
    type: "badge",
    label: "Front badge",
    capabilities: ["selectable"],
    match: { kind: "object", objectName: "BADGE_FRONT" },
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

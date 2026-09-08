import type { SceneMapEntry } from "../../types/sceneMap";

/**
 * Semantic scene identity for `public/models/rav4-2024/rav4_2024_limited_decoded.glb` — see
 * `docs/RAV4_PROVENANCE.md` for the full capture history.
 *
 * Every node and material name below was read directly from the shipped file (`node -e` dump of
 * the glTF JSON, not assumed from the 4Runner's naming): the asset's single scene root is one node
 * named `BODY` — a 10-primitive mesh (`body.carmain`, `metal.chrome`, `glass.windows`,
 * `glass.windows.windshield`, `glass.windows.rear.windshield`, `plastik.all`, `glass.light`,
 * `emissive.foglight`, `emissive.brakelights`, `emissive.turnsignal`, in that exact spelling — no
 * `.001`/`.002`/`.004` suffixes, unlike the 4Runner's equivalents) — plus seven transform-only
 * children (`MOUNT_LICENSE_PLATE_FRONT/REAR`, `MOUNT_SOUND_EXHAUST`, `MOUNT_WHEEL_FRONT_LEFT/
 * RIGHT`, `MOUNT_WHEEL_REAR_LEFT/RIGHT`). `VehicleCanvas.tsx`'s `prepareVehicleRoot` wraps the
 * loaded scene in a container it renames to `VEHICLE_ROOT` regardless of source asset — the same
 * runtime convention `lib/data/sceneMap/4runner.ts` relies on — so that entry carries over unchanged.
 *
 * This capture has no separate geometry at all for wheels, tires, an interior, doors, mirrors, a
 * front badge, or a grille (confirmed against the node list above, not assumed from the 4Runner's
 * shape) — every one of those is forward-declared here exactly the way
 * `lib/data/sceneMap/4runner.ts` forward-declares its own body-shell gaps: pointed at a node name
 * that does not exist in this asset, so `buildSceneRegistry` reports it unsatisfied rather than
 * `SceneRegistry.get()` silently returning `undefined` for an unrecorded reason. The
 * `MOUNT_WHEEL_*` nodes are real and are exposed through `threeDConfig.wheelMountNames`
 * (`lib/data/vehicles/rav4.ts`) as attachment points for a future wheel asset delivery — but they
 * carry no mesh of their own, so registering a `wheel.*` entry directly against one of them would
 * report a wheel "satisfied" when nothing is actually there to select or highlight. The forward
 * declarations below deliberately target distinct, not-yet-real node names instead, keeping the
 * unsatisfied count honest until real wheel geometry exists.
 */
export const RAV4_SCENE_MAP: SceneMapEntry[] = [
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
    match: { kind: "material-region", objectName: "BODY", materialNames: ["metal.chrome"] },
  },
  {
    id: "body.trim.plastic",
    type: "trim",
    label: "Black plastic trim",
    capabilities: ["selectable", "highlightable"],
    match: { kind: "material-region", objectName: "BODY", materialNames: ["plastik.all"] },
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
    match: { kind: "material-region", objectName: "BODY", materialNames: ["glass.light"] },
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
    match: { kind: "material-region", objectName: "BODY", materialNames: ["emissive.brakelights"] },
  },
  {
    id: "light.turnsignal",
    type: "light",
    label: "Turn signals",
    capabilities: ["selectable", "light"],
    match: { kind: "material-region", objectName: "BODY", materialNames: ["emissive.turnsignal"] },
  },

  // Forward-declared — no wheel/tire mesh exists in this capture at all (only the four empty
  // `MOUNT_WHEEL_*` transform nodes; see file header). Targeting a name distinct from those real
  // mount nodes keeps these correctly unsatisfied instead of vacuously "satisfied" against a node
  // with no geometry.
  {
    id: "wheel.front-left",
    type: "wheel",
    label: "Front-left wheel",
    capabilities: ["selectable", "highlightable", "wheel"],
    match: { kind: "object", objectName: "WHEEL_MESH_FRONT_LEFT" },
  },
  {
    id: "wheel.front-right",
    type: "wheel",
    label: "Front-right wheel",
    capabilities: ["selectable", "highlightable", "wheel"],
    match: { kind: "object", objectName: "WHEEL_MESH_FRONT_RIGHT" },
  },
  {
    id: "wheel.rear-left",
    type: "wheel",
    label: "Rear-left wheel",
    capabilities: ["selectable", "highlightable", "wheel"],
    match: { kind: "object", objectName: "WHEEL_MESH_REAR_LEFT" },
  },
  {
    id: "wheel.rear-right",
    type: "wheel",
    label: "Rear-right wheel",
    capabilities: ["selectable", "highlightable", "wheel"],
    match: { kind: "object", objectName: "WHEEL_MESH_REAR_RIGHT" },
  },
  {
    id: "tire.front-left",
    type: "tire",
    label: "Front-left tire",
    capabilities: ["selectable", "tire"],
    match: { kind: "object", objectName: "TIRE_MESH_FRONT_LEFT" },
  },
  {
    id: "tire.front-right",
    type: "tire",
    label: "Front-right tire",
    capabilities: ["selectable", "tire"],
    match: { kind: "object", objectName: "TIRE_MESH_FRONT_RIGHT" },
  },
  {
    id: "tire.rear-left",
    type: "tire",
    label: "Rear-left tire",
    capabilities: ["selectable", "tire"],
    match: { kind: "object", objectName: "TIRE_MESH_REAR_LEFT" },
  },
  {
    id: "tire.rear-right",
    type: "tire",
    label: "Rear-right tire",
    capabilities: ["selectable", "tire"],
    match: { kind: "object", objectName: "TIRE_MESH_REAR_RIGHT" },
  },

  // Forward-declared — same body-shell-only gaps `lib/data/sceneMap/4runner.ts` documents for its
  // own asset, confirmed absent from this capture's node list rather than assumed.
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
    id: "grille",
    type: "trim",
    label: "Grille",
    capabilities: ["selectable", "highlightable"],
    match: { kind: "object", objectName: "GRILLE" },
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

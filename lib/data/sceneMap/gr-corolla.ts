import type { SceneMapEntry } from "../../types/sceneMap";

const region = (id: string, type: string, label: string, objectName: string, materialNames: string[], capabilities: SceneMapEntry["capabilities"] = ["selectable", "highlightable"]): SceneMapEntry => ({ id, type, label, capabilities, match: { kind: "material-region", objectName, materialNames } });
const object = (id: string, type: string, label: string, objectName: string, capabilities: SceneMapEntry["capabilities"] = ["selectable", "highlightable"]): SceneMapEntry => ({ id, type, label, capabilities, match: { kind: "object", objectName } });

/**
 * Sketchfab export: mesh names are generic `Object_N`. Wheels are keyed on each assembly's tyre
 * mesh rather than its `wheel.00N_*` group: three.js strips `.` from node names on load, so those
 * group names differ between the file (tests/assetPipelineReport) and the runtime scene.
 */
export const GR_COROLLA_SCENE_MAP: SceneMapEntry[] = [
  object("vehicle.root", "vehicle", "Vehicle", "Sketchfab_model", ["selectable"]),
  region("body.paint", "body", "Exterior paint", "Object_7", ["paint"], ["selectable", "paintable", "highlightable"]),
  region("roof", "body", "Roof", "Object_8", ["roof"]),
  region("aero.spoiler", "aero", "Rear spoiler", "Object_12", ["spoiler"], ["selectable", "highlightable", "accessory"]),
  region("light.main", "light", "Lights", "Object_16", ["lights"], ["selectable", "highlightable", "light"]),
  object("wheel.a", "wheel", "Wheel", "Object_28", ["selectable", "highlightable", "wheel"]),
  object("wheel.b", "wheel", "Wheel", "Object_41", ["selectable", "highlightable", "wheel"]),
  object("wheel.c", "wheel", "Wheel", "Object_49", ["selectable", "highlightable", "wheel"]),
  object("wheel.d", "wheel", "Wheel", "Object_57", ["selectable", "highlightable", "wheel"]),
  region("wheel.finish", "wheel", "Wheel finish", "Object_29", ["material_18"], ["selectable", "highlightable", "wheel"]),
  region("accessory.calipers", "accessory", "Brake calipers", "Object_4", ["calliper"], ["selectable", "highlightable", "accessory"]),
  region("interior", "interior", "Interior", "Object_36", ["colored"]),
];

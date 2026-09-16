import type { SceneMapEntry } from "../../types/sceneMap";

const region = (
  id: string,
  type: string,
  label: string,
  objectName: string,
  materialNames: string[],
  capabilities: SceneMapEntry["capabilities"] = ["selectable", "highlightable"],
): SceneMapEntry => ({
  id, type, label, capabilities,
  match: { kind: "material-region", objectName, materialNames },
});

export const GR_COROLLA_SCENE_MAP: SceneMapEntry[] = [
  region("body.paint", "body", "Exterior paint", "Object_7", ["paint"], ["selectable", "paintable", "highlightable"]),
  region("roof.finish", "roof", "Roof", "Object_8", ["roof"]),
  region("spoiler.finish", "spoiler", "Rear spoiler", "Object_12", ["spoiler"], ["selectable", "highlightable", "accessory"]),
  region("mirror.finish", "mirror", "Mirror caps", "Object_14", ["mirror"]),
  region("light.main", "light", "Lighting", "Object_16", ["lights"], ["selectable", "highlightable", "light"]),
  region("glass", "glass", "Glass", "Object_23", ["glass"]),
  region("wheel.front-left", "wheel", "Front-left wheel", "Object_31", ["rim_detail"], ["selectable", "highlightable", "wheel"]),
  region("wheel.front-right", "wheel", "Front-right wheel", "Object_44", ["rim_detail"], ["selectable", "highlightable", "wheel"]),
  region("wheel.rear-left", "wheel", "Rear-left wheel", "Object_52", ["rim_detail"], ["selectable", "highlightable", "wheel"]),
  region("wheel.rear-right", "wheel", "Rear-right wheel", "Object_60", ["rim_detail"], ["selectable", "highlightable", "wheel"]),
  region("interior.trim", "interior", "Interior", "Object_33", ["int_2"]),
  region("brakes.caliper", "brake", "Brake caliper", "Object_4", ["calliper"], ["selectable", "highlightable", "accessory"]),
];
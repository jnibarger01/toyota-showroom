import type { SceneMapEntry } from "../../types/sceneMap";

const region = (
  id: string,
  type: string,
  label: string,
  objectName: string,
  materialNames: string[],
  capabilities: SceneMapEntry["capabilities"] = ["selectable", "highlightable"],
): SceneMapEntry => ({
  id,
  type,
  label,
  capabilities,
  match: { kind: "material-region", objectName, materialNames },
});

export const GT86_SCENE_MAP: SceneMapEntry[] = [
  region("body.paint", "body", "Exterior paint", "Object_10", ["body.001"], ["selectable", "paintable", "highlightable"]),
  region("glass.front", "glass", "Front glass", "Object_5", ["glass.001"]),
  region("light.rear", "light", "Rear lighting", "Object_53", ["red.001"], ["selectable", "highlightable", "light"]),
  region("wheel.finish", "wheel", "Wheel finish", "Object_57", ["silver.002"], ["selectable", "highlightable", "wheel"]),
];

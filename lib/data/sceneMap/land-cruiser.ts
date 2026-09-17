import type { SceneMapEntry } from "../../types/sceneMap";

const region = (
  id: string,
  type: string,
  label: string,
  objectName: string,
  materialNames: string[],
  capabilities: SceneMapEntry["capabilities"] = ["selectable", "highlightable"],
): SceneMapEntry => ({ id, type, label, capabilities, match: { kind: "material-region", objectName, materialNames } });

export const LAND_CRUISER_SCENE_MAP: SceneMapEntry[] = [
  { id: "vehicle.root", type: "vehicle", label: "Vehicle", capabilities: ["selectable"], match: { kind: "object", objectName: "Sketchfab_model" } },
  region("body.paint", "body", "Exterior paint", "_608501c7_ac7f_4b39_969f_4e63c702c159__CarPaint_0", ["CarPaint"], ["selectable", "paintable", "highlightable"]),
  region("body.paint-secondary", "body", "Secondary exterior paint", "68105_60520_02_shell_CarPaint_N2_0", ["CarPaint_N2"], ["selectable", "paintable", "highlightable"]),
  region("light.front", "light", "Headlights", "polySurface_01_Light_glass_0", ["Light_glass"], ["selectable", "highlightable", "light"]),
  region("light.rear", "light", "Rear lights", "polySurface_14003_red_glasss_0", ["red_glasss"], ["selectable", "highlightable", "light"]),
];

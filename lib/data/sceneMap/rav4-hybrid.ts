import type { SceneMapEntry } from "../../types/sceneMap";

const region = (
  id: string,
  type: string,
  label: string,
  objectName: string,
  materialNames: string[],
  capabilities: SceneMapEntry["capabilities"] = ["selectable", "highlightable"],
): SceneMapEntry => ({ id, type, label, capabilities, match: { kind: "material-region", objectName, materialNames } });

export const RAV4_HYBRID_SCENE_MAP: SceneMapEntry[] = [
  { id: "vehicle.root", type: "vehicle", label: "Vehicle", capabilities: ["selectable"], match: { kind: "object", objectName: "Sketchfab_model" } },
  region("body.paint", "body", "Exterior paint", "TSM_Body_101_SM_Body_101_dummy_material_0_055_Tdummy_material_0_085_0", ["Tdummy_material_0_085"], ["selectable", "paintable", "highlightable"]),
  region("hood.paint", "hood", "Hood", "TSK_Hood_101_003_SK_Hood_101_003_dummy_material_0_062_Tdummy_material_0_085_0", ["Tdummy_material_0_085"], ["selectable", "paintable", "highlightable"]),
  region("light.rear", "light", "Rear lights", "TSM_Light_B_101_SM_Light_B_101_dummy_material_0_065_red_glass_0", ["red_glass"], ["selectable", "highlightable", "light"]),
];

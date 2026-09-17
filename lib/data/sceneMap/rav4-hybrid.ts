import type { SceneMapEntry } from "../../types/sceneMap";

const region = (id: string, type: string, label: string, objectName: string, materialNames: string[], capabilities: SceneMapEntry["capabilities"] = ["selectable", "highlightable"]): SceneMapEntry => ({
  id, type, label, capabilities, match: { kind: "material-region", objectName, materialNames },
});

export const RAV4_HYBRID_SCENE_MAP: SceneMapEntry[] = [
  region("body.paint", "body", "Exterior paint", "T:SM_Body_101_SM_Body_101_dummy_material_0_055_T:dummy_material_0_085_0", ["Tdummy_material_0_085"], ["selectable", "paintable", "highlightable"]),
  region("body.grille", "trim", "Grille", "T:SM_Body_101_SM_Body_101_dummy_material_0_059_grilla_0", ["grilla"]),
  region("mirror.left", "mirror", "Left mirror", "T:SM_SideMirror_L_101_SM_SideMirror_L_101_dummy_material_0_077_mirrors_0", ["mirrors"]),
  region("light.front", "light", "Front lighting", "T:SM_Light_F_101_SM_Light_F_101_dummy_material_0_066_T:dummy_material_2_027_0", ["Tdummy_material_2_027"], ["selectable", "highlightable", "light"]),
  region("light.rear", "light", "Rear lighting", "T:SM_Light_B_101_SM_Light_B_101_dummy_material_0_065_red_glass_0", ["red_glass"], ["selectable", "highlightable", "light"]),
  region("wheel.front-left", "wheel", "Front-left wheel", "polySurface1_T:dummy_material_0_101_0", ["Tdummy_material_0_101"], ["selectable", "highlightable", "wheel"]),
  region("wheel.front-right", "wheel", "Front-right wheel", "polySurface2_T:dummy_material_0_101_0", ["Tdummy_material_0_101"], ["selectable", "highlightable", "wheel"]),
  region("wheel.rear-left", "wheel", "Rear-left wheel", "polySurface51_T:dummy_material_0_101_0", ["Tdummy_material_0_101"], ["selectable", "highlightable", "wheel"]),
  region("wheel.rear-right", "wheel", "Rear-right wheel", "polySurface76_T:dummy_material_0_101_0", ["Tdummy_material_0_101"], ["selectable", "highlightable", "wheel"]),
  region("interior.leather", "interior", "Interior", "T:SM_Body_101_SM_Body_101_dummy_material_0_050_int_Leather_0", ["int_Leather"]),
  region("exhaust", "exhaust", "Exhaust", "T:SK_Exhaust_101_002_SK_Exhaust_101_002_dummy_material_0_056_T:dummy_material_0_055_0", ["Tdummy_material_0_055"]),
];

import type { SceneMapEntry } from "../../types/sceneMap";

const region = (id: string, type: string, label: string, objectName: string, materialNames: string[], capabilities: SceneMapEntry["capabilities"] = ["selectable", "highlightable"]): SceneMapEntry => ({
  id, type, label, capabilities, match: { kind: "material-region", objectName, materialNames },
});

export const LAND_CRUISER_SCENE_MAP: SceneMapEntry[] = [
  region("body.paint", "body", "Exterior paint", "_150cda98_1ce1_4669_8db6_f9db82877b7f__CarPaint_0", ["CarPaint"], ["selectable", "paintable", "highlightable"]),
  region("roof.paint", "roof", "Roof paint", "_1811d776_ef04_4524_ae2c_baac6e1afae0__CarPaint_N2_0", ["CarPaint_N2"], ["selectable", "paintable", "highlightable"]),
  region("grille.main", "trim", "Grille", "_2a6fa0f4_1c24_4165_b12a_4743afed9cf5__grille_0", ["grille"]),
  region("glass.windshield", "glass", "Windshield", "56101_60K20_01_shell_Window_0", ["Window"]),
  region("wheel.front-left", "wheel", "Front-left wheel", "_95dc5532_e30a_4aa8_8fd4_7039df86edb1_2_black_metal_0", ["black_metal"], ["selectable", "highlightable", "wheel"]),
  region("wheel.rear-left", "wheel", "Rear-left wheel", "_95dc5532_e30a_4aa8_8fd4_7039df86edb1_004_black_metal_0", ["black_metal"], ["selectable", "highlightable", "wheel"]),
  region("wheel.front-right", "wheel", "Front-right wheel", "_95dc5532_e30a_4aa8_8fd4_7039df86edb1_008_black_metal_0", ["black_metal"], ["selectable", "highlightable", "wheel"]),
  region("wheel.rear-right", "wheel", "Rear-right wheel", "_95dc5532_e30a_4aa8_8fd4_7039df86edb1_007_black_metal_0", ["black_metal"], ["selectable", "highlightable", "wheel"]),
  region("interior.leather", "interior", "Leather interior", "67630_60Y80_07_shell_Cuero_1_0", ["Cuero_1"]),
  region("lighting.front", "light", "Front lighting", "polySurface_06_Light_emiss_0", ["Light_emiss"], ["selectable", "highlightable", "light"]),
];

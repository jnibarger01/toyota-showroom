import type { CustomizationOption, MaterialConfig } from "../../types/customization";

const V = ["rav4-hybrid"];
const PAINT_NODES = [
  "T:SM_Body_101_SM_Body_101_dummy_material_0_055_T:dummy_material_0_085_0",
  "T:SM_Bumper_B_101_SM_Bumper_B_101_dummy_material_0_045_T:dummy_material_0_085_0",
  "T:SM_Bumper_F_101_SM_Bumper_F_101_dummy_material_0_048_T:dummy_material_0_085_0",
  "T:SK_Door_BL_101_002_SK_Door_BL_101_002_dummy_material_0_051_T:dummy_material_0_085_0",
  "T:SK_Door_BR_101_002_SK_Door_BR_101_002_dummy_material_0_053_T:dummy_material_0_085_0",
  "T:SK_Door_FL_101_003_SK_Door_FL_101_003_dummy_material_0_056_T:dummy_material_0_085_0",
  "T:SK_Door_FR_101_003_SK_Door_FR_101_003_dummy_material_0_052_T:dummy_material_0_085_0",
  "T:SM_Fender_B_101_SM_Fender_B_101_dummy_material_0_059_T:dummy_material_0_085_0",
  "T:SM_Fender_B_101_SM_Fender_B_101_dummy_material_0_059_Color_2_0",
  "T:SM_Fender_F_101_SM_Fender_F_101_dummy_material_0_060_T:dummy_material_0_085_0",
  "T:SK_Hood_101_003_SK_Hood_101_003_dummy_material_0_062_T:dummy_material_0_085_0",
  "T:SM_Roof_101_SM_Roof_101_dummy_material_0_071_Color_2_0",
  "T:SM_SideMirror_L_101_SM_SideMirror_L_101_dummy_material_0_075_T:dummy_material_0_085_0",
  "T:SM_SideMirror_R_101_SM_SideMirror_R_101_dummy_material_0_078_T:dummy_material_0_085_0",
  "T:SK_Trunk_101_003_SK_Trunk_101_003_dummy_material_0_086_T:dummy_material_0_085_0",
  "T:SK_Trunk_101_003_SK_Trunk_101_003_dummy_material_0_086_Color_2_0",
];
const WHEELS = ["polySurface1_T:dummy_material_0_101_0", "polySurface2_T:dummy_material_0_101_0", "polySurface51_T:dummy_material_0_101_0", "polySurface76_T:dummy_material_0_101_0"];
const TIRES = ["T1_T:dummy_material_0_133_0", "T2_T:dummy_material_0_133_0", "T3_T:dummy_material_0_133_0", "T4_T:dummy_material_0_133_0"];
const BRAKES = ["polySurface771_T:dummy_material_0_047_0", "polySurface647_T:dummy_material_0_047_0", "polySurface447_T:dummy_material_0_047_0", "polySurface629_T:dummy_material_0_047_0"];
const option = (id: string, category: CustomizationOption["category"], label: string, targetNodes: string[], targetMaterials: string[], materialConfig: MaterialConfig, priceDelta = 0, selectionGroup?: string): CustomizationOption => ({
  id, category, label, operation: "material-update", targetNodes, targetMaterials, materialConfig, priceDelta, compatibleVehicleIds: V, ...(selectionGroup ? { selectionGroup } : {}),
});
const paint = (id: string, label: string, color: string, priceDelta = 0) => option(id, "paint", label, PAINT_NODES, ["Tdummy_material_0_085", "Color_2"], { color, metalness: 0.4, roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.08 }, priceDelta);

export const rav4HybridOptions: CustomizationOption[] = [
  paint("rav4h-paint-ice-cap", "Ice Cap", "#f3f3ef"),
  paint("rav4h-paint-magnetic-gray", "Magnetic Gray Metallic", "#555a60"),
  paint("rav4h-paint-midnight-black", "Midnight Black Metallic", "#111317"),
  paint("rav4h-paint-blueprint", "Blueprint", "#184b85"),
  paint("rav4h-paint-ruby-flare", "Ruby Flare Pearl", "#8b1820", 425),
  option("rav4h-wheel-silver", "wheels", "Machined Silver Wheels", WHEELS, ["Tdummy_material_0_101"], { color: "#9ba0a6", metalness: 0.9, roughness: 0.22 }, 0, "wheels"),
  option("rav4h-wheel-black", "wheels", "Gloss Black Wheels", WHEELS, ["Tdummy_material_0_101"], { color: "#111317", metalness: 0.82, roughness: 0.2 }, 650, "wheels"),
  option("rav4h-wheel-bronze", "wheels", "Bronze Wheels", WHEELS, ["Tdummy_material_0_101"], { color: "#80603c", metalness: 0.82, roughness: 0.28 }, 850, "wheels"),
  option("rav4h-tire-black", "tires", "Street Black Sidewall", TIRES, ["Tdummy_material_0_133"], { color: "#171819", metalness: 0.05, roughness: 0.84 }),
  option("rav4h-tire-charcoal", "tires", "Track Charcoal Sidewall", TIRES, ["Tdummy_material_0_133"], { color: "#292a2c", metalness: 0.08, roughness: 0.72 }, 450),
  option("rav4h-brake-steel", "brakes", "OEM Brake Finish", BRAKES, ["Tdummy_material_0_047"], { color: "#8c9094", metalness: 0.88, roughness: 0.28 }),
  option("rav4h-brake-dark", "brakes", "Dark Performance Brake Finish", BRAKES, ["Tdummy_material_0_047"], { color: "#36383b", metalness: 0.82, roughness: 0.32 }, 550),
  option("rav4h-grille-black", "trim", "Black Grille", ["T:SM_Body_101_SM_Body_101_dummy_material_0_059_grilla_0"], ["grilla"], { color: "#111214", metalness: 0.28, roughness: 0.52 }, 250, "grille"),
  option("rav4h-grille-graphite", "trim", "Graphite Grille", ["T:SM_Body_101_SM_Body_101_dummy_material_0_059_grilla_0"], ["grilla"], { color: "#34383d", metalness: 0.45, roughness: 0.38 }, 325, "grille"),
];

import type { CustomizationOption } from "../../types/customization";

const VEHICLE = ["rav4-hybrid"];
const PAINT_MATERIAL = ["Tdummy_material_0_085"];

// Exact mesh-node names that carry the exterior paint slot in the optimized runtime GLB.
const PAINT_NODES = [
  "TSM_Body_101_SM_Body_101_dummy_material_0_055_Tdummy_material_0_085_0",
  "TSM_Bumper_B_101_SM_Bumper_B_101_dummy_material_0_045_Tdummy_material_0_085_0",
  "TSM_Bumper_F_101_SM_Bumper_F_101_dummy_material_0_048_Tdummy_material_0_085_0",
  "TSK_Door_BL_101_002_SK_Door_BL_101_002_dummy_material_0_051_Tdummy_material_0_085_0",
  "TSK_Door_BR_101_002_SK_Door_BR_101_002_dummy_material_0_053_Tdummy_material_0_085_0",
  "TSK_Door_FL_101_003_SK_Door_FL_101_003_dummy_material_0_056_Tdummy_material_0_085_0",
  "TSK_Door_FR_101_003_SK_Door_FR_101_003_dummy_material_0_052_Tdummy_material_0_085_0",
  "TSM_Fender_B_101_SM_Fender_B_101_dummy_material_0_059_Tdummy_material_0_085_0",
  "TSM_Fender_F_101_SM_Fender_F_101_dummy_material_0_060_Tdummy_material_0_085_0",
  "TSK_Hood_101_003_SK_Hood_101_003_dummy_material_0_062_Tdummy_material_0_085_0",
  "TSM_SideMirror_L_101_SM_SideMirror_L_101_dummy_material_0_075_Tdummy_material_0_085_0",
  "TSM_SideMirror_R_101_SM_SideMirror_R_101_dummy_material_0_078_Tdummy_material_0_085_0",
  "TSK_Trunk_101_003_SK_Trunk_101_003_dummy_material_0_086_Tdummy_material_0_085_0",
];

function paint(id: string, label: string, color: string): CustomizationOption {
  return {
    id,
    category: "paint",
    label,
    operation: "material-update",
    targetNodes: PAINT_NODES,
    targetMaterials: PAINT_MATERIAL,
    materialConfig: { color, metalness: 0.65, roughness: 0.26, clearcoat: 1, clearcoatRoughness: 0.06 },
    compatibleVehicleIds: VEHICLE,
  };
}

export const rav4HybridOptions: CustomizationOption[] = [
  paint("rav4-hybrid-paint-040-ice-cap", "Ice Cap", "#f2f2ef"),
  paint("rav4-hybrid-paint-1g3-magnetic-gray", "Magnetic Gray Metallic", "#555a5e"),
  paint("rav4-hybrid-paint-218-midnight-black", "Midnight Black Metallic", "#101215"),
  paint("rav4-hybrid-paint-3u5-ruby-flare", "Ruby Flare Pearl", "#8d1825"),
];

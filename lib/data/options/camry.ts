import type { CustomizationOption, MaterialConfig } from "../../types/customization";

const VEHICLE = ["camry"];
const PAINT_NODES = [
  "CAMRY_EX_CARBODY_MESH_CarPaint_0",
  "CAMRY_EX_CARBODY_DECAL_MESH_CarPaint_0",
  "CAMRY_EX_FL_DOOR_MESH_CarPaint_0",
  "CAMRY_EX_FR_DOOR_MESH_CarPaint_0",
  "CAMRY_EX_RL_DOOR_MESH_CarPaint_0",
  "CAMRY_EX_RR_DOOR_MESH_CarPaint_0",
  "CAMRY_EX_BOOT_DOOR_MESH_CarPaint_0",
];
const WHEEL_NODES = [
  "polySurface6103_Wheel_Alloy_0",
  "polySurface5883_Wheel_Alloy_0",
  "polySurface5881_Wheel_Alloy_0",
  "polySurface5650_Wheel_Alloy_0",
  "polySurface5643_Wheel_Alloy_0",
];
const CALIPER_NODES = [
  "polySurface6103_Caliper_0",
  "polySurface5872_Caliper_0",
  "polySurface5871_Caliper_0",
  "polySurface5640_Caliper_0",
  "polySurface5639_Caliper_0",
];
function option(
  id: string,
  category: CustomizationOption["category"],
  label: string,
  targetNodes: string[],
  targetMaterials: string[],
  materialConfig: MaterialConfig,
  priceDelta = 0,
): CustomizationOption {
  return {
    id, category, label, operation: "material-update", targetNodes, targetMaterials,
    materialConfig, priceDelta, compatibleVehicleIds: VEHICLE,
  };
}

function paint(id: string, label: string, color: string, gradeIds?: string[]): CustomizationOption {
  return {
    ...option(id, "paint", label, PAINT_NODES, ["CarPaint"], {
      color, metalness: 0.68, roughness: 0.24, clearcoat: 1, clearcoatRoughness: 0.06,
    }),
    ...(gradeIds ? { compatibleGradeIds: gradeIds } : {}),
  };
}

export const camryOptions: CustomizationOption[] = [
  paint("paint-040-super-white", "Super White", "#f2f2ef", ["le", "xle"]),
  paint("paint-1g3-underground", "Underground", "#4f545a"),
  paint("paint-070-midnight-black", "Midnight Black Metallic", "#101215"),
  paint("paint-3u5-barcelona-red", "Barcelona Red Metallic", "#9d1d20", ["xle", "xse"]),
  option("wheels-sport-machined", "wheels", "Sport Machined", WHEEL_NODES, ["Wheel_Alloy"], {
    color: "#a7acb3", metalness: 0.92, roughness: 0.18,
  }),
  option("wheels-gloss-black", "wheels", "Gloss Black", WHEEL_NODES, ["Wheel_Alloy"], {
    color: "#0e0f11", metalness: 0.68, roughness: 0.16,
  }, 350),
  option("wheels-bronze", "wheels", "Bronze", WHEEL_NODES, ["Wheel_Alloy"], {
    color: "#8a623d", metalness: 0.84, roughness: 0.28,
  }, 650),
  {
    ...option("trim-lighting-oem", "trim", "OEM Lighting", [
      "CAMRY_EX_HEADLIGHT_MESH_Glass_Light_0", "CAMRY_EX_TAILLIGHT_MESH_Glass_Light_0",
    ], ["Glass_Light"], { color: "#f4f7ff", roughness: 0.12 }),
    selectionGroup: "trim-lighting",
  },
  option("accessory-calipers-red", "accessory", "Red Brake Calipers", CALIPER_NODES, ["Caliper"], {
    color: "#b71f2a", metalness: 0.55, roughness: 0.25,
  }, 700),
  option("interior-black", "interior", "Black Interior", ["CAMRY_IN_SEAT_MESH_Seat_Letaher_Color_0"], ["Seat_Letaher_Color"], {
    color: "#171717", metalness: 0.04, roughness: 0.62,
  }),
  option("interior-macadamia", "interior", "Macadamia Interior", ["CAMRY_IN_SEAT_MESH_Seat_Letaher_Color_0"], ["Seat_Letaher_Color"], {
    color: "#a9885f", metalness: 0.03, roughness: 0.58,
  }, 900),
];
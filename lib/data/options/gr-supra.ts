import type { CustomizationOption, MaterialConfig } from "../../types/customization";
const V = ["gr-supra"];
const paintNodes = ["Paint_Paint_0", "DoorLF_Paint_Paint_0", "DoorRF_Paint_Paint_0", "Hood_Paint_Paint_0", "Trunk_Paint_Paint_0"];
const paintSecondary = ["DoorLF_Paint_PaintSecondary_0", "DoorRF_Paint_PaintSecondary_0"];
const wheels = ["Wheel_01_RR_Wheel1A_0", "Wheel_01_RF_Wheel1A_0", "Wheel_01_LR_Wheel1A_0", "Wheel_01_LF_Wheel1A_0"];
const option = (id: string, category: CustomizationOption["category"], label: string, targetNodes: string[], targetMaterials: string[], materialConfig: MaterialConfig, priceDelta = 0): CustomizationOption => ({ id, category, label, operation: "material-update", targetNodes, targetMaterials, materialConfig, priceDelta, compatibleVehicleIds: V });
const paint = (id: string, label: string, color: string, extra: MaterialConfig = {}) => option(id, "paint", label, paintNodes, ["Paint"], { color, metalness: .7, roughness: .25, clearcoat: 1, clearcoatRoughness: .08, ...extra });
export const grSupraOptions: CustomizationOption[] = [
  paint("supra-paint-white", "Absolute Zero White", "#f2f3f1", { metalness: .35 }),
  paint("supra-paint-black", "Black", "#101114"),
  paint("supra-paint-gray", "Steel Gray Metallic", "#59616a"),
  paint("supra-paint-red", "Renaissance Red 2.0", "#b51f2c", { metalness: .6 }),
  paint("supra-paint-blue", "Deep Blue", "#174c93"),
  paint("supra-paint-yellow", "Nitro Yellow", "#e4c21c", { metalness: .5 }),
  option("supra-wheels-stock", "wheels", "Factory wheels", wheels, ["Wheel1A"], { color: "#36383c", metalness: .85, roughness: .3 }),
  option("supra-wheels-dark", "wheels", "Dark forged finish", wheels, ["Wheel1A"], { color: "#111317", metalness: .8, roughness: .42 }, 650),
  option("supra-wheels-machined", "wheels", "Silver machined finish", wheels, ["Wheel1A"], { color: "#b3bac1", metalness: .95, roughness: .18 }, 850),
  option("supra-wheels-bronze", "wheels", "Bronze finish", wheels, ["Wheel1A"], { color: "#8c6239", metalness: .9, roughness: .28 }, 900),
  option("supra-light-oem-white", "lighting", "OEM white", ["Light_Lights_0", "DoorLF_Light_Lights_0", "DoorRF_Light_Lights_0", "Trunk_Light_Lights_0"], ["Lights"], { color: "#f5f7ff", metalness: .05, roughness: .2 }),
  option("supra-light-cool-white", "lighting", "Cool white", ["Light_Lights_0", "DoorLF_Light_Lights_0", "DoorRF_Light_Lights_0", "Trunk_Light_Lights_0"], ["Lights"], { color: "#b9d8ff", metalness: .05, roughness: .18 }),
  option("supra-light-warm-amber", "lighting", "Warm amber", ["Light_Lights_0", "DoorLF_Light_Lights_0", "DoorRF_Light_Lights_0", "Trunk_Light_Lights_0"], ["Lights"], { color: "#ffb347", metalness: .05, roughness: .2 }),
  option("supra-light-show-blue", "lighting", "Show-car blue", ["Light_Lights_0", "DoorLF_Light_Lights_0", "DoorRF_Light_Lights_0", "Trunk_Light_Lights_0"], ["Lights"], { color: "#4d8dff", metalness: .05, roughness: .18 }),
  option("supra-trim-carbon", "accessory", "Carbon fiber trim", ["Carbon1_Carbon1_0"], ["Carbon1"], { color: "#17191c", metalness: .55, roughness: .3 }, 1200),
  option("supra-calipers-red", "accessory", "Red brake calipers", ["CaliperRF_CaliperColor_0", "CaliperRR_CaliperColor_0", "CaliperLR_CaliperColor_0", "CaliperLF_CaliperColor_0"], ["CaliperColor"], { color: "#c21f2b", metalness: .55, roughness: .25 }, 700),
  option("supra-badge-bright", "accessory", "Bright badges", ["Badge_BadgeA_0"], ["BadgeA"], { color: "#e4e8ee", metalness: .9, roughness: .16 }),
  option("supra-interior-red", "interior", "Red interior accents", ["Interior_InteriorColor2_0"], ["InteriorColor2"], { color: "#7b161c", metalness: .15, roughness: .5 }, 900),
  option("supra-engine-display", "accessory", "Engine presentation", ["Engine_Engine_0"], ["Engine"], { color: "#25282d", metalness: .55, roughness: .35 }),
];

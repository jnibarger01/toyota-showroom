import type { CustomizationOption, MaterialConfig } from "../../types/customization";

const V = ["land-cruiser"];
const PAINT_NODES = [
  "_608501c7_ac7f_4b39_969f_4e63c702c159__CarPaint_0", "_c7dac6ab_6350_4649_a4fc_cbf0d9a8e552__CarPaint_0",
  "67663_60030_01_shell.001_CarPaint_0", "67673_60040_01_shell.001_CarPaint_0", "67673_60040_01_shell_CarPaint_0",
  "_cdea0b8b_5ed7_4c99_8440_e0bb31d930a4__CarPaint_0", "_3ad67829_5627_4efb_a10a_992002d1a143__CarPaint_0",
  "_ac6643ac_feff_4c4f_a5b9_91d2e4df2d97__CarPaint_0", "_a54e0edc_0498_4ebd_b373_6d7e5c414d11__CarPaint_0",
  "_150cda98_1ce1_4669_8db6_f9db82877b7f__CarPaint_0", "_6c068811_0bb1_41f3_8bc7_a1089782a774__CarPaint_0",
  "_2bb9de70_ef04_4377_8335_6fb345753ef4__CarPaint_0", "_6460ddf1_9e96_4d96_96e5_bd3122648ded__CarPaint_0",
  "67663_60030_01_shell_CarPaint_0", "68105_60520_02_shell_CarPaint_N2_0", "_1811d776_ef04_4524_ae2c_baac6e1afae0__CarPaint_N2_0",
  "76085_60160_01_shell_CarPaint_N2_0", "_b53a94a6_c7df_4e78_9557_6b864c50fe97__CarPaint_N2_0",
];
const WHEELS = [
  "_95dc5532_e30a_4aa8_8fd4_7039df86edb1_2_black_metal_0", "_95dc5532_e30a_4aa8_8fd4_7039df86edb1__chrome_0",
  "_95dc5532_e30a_4aa8_8fd4_7039df86edb1_004_black_metal_0", "_95dc5532_e30a_4aa8_8fd4_7039df86edb1_003_chrome_0",
  "_95dc5532_e30a_4aa8_8fd4_7039df86edb1_008_black_metal_0", "_95dc5532_e30a_4aa8_8fd4_7039df86edb1_005_chrome_0",
  "_95dc5532_e30a_4aa8_8fd4_7039df86edb1_007_black_metal_0", "_95dc5532_e30a_4aa8_8fd4_7039df86edb1_006_chrome_0",
];
const TIRES = [
  "_a8a3bf22_8cf5_42fc_a19b_f3d09aed8e82_.001_tire_0", "_a8a3bf22_8cf5_42fc_a19b_f3d09aed8e82__side_tire_0",
  "_a8a3bf22_8cf5_42fc_a19b_f3d09aed8e82_.002_tire_0", "_a8a3bf22_8cf5_42fc_a19b_f3d09aed8e82_001_side_tire_0",
  "_a8a3bf22_8cf5_42fc_a19b_f3d09aed8e82_.003_tire_0", "_a8a3bf22_8cf5_42fc_a19b_f3d09aed8e82_002_side_tire_0",
  "_a8a3bf22_8cf5_42fc_a19b_f3d09aed8e82_.004_tire_0", "_a8a3bf22_8cf5_42fc_a19b_f3d09aed8e82_003_side_tire_0",
];
const CALIPERS = ["47710_60480_01_shell_Silver_Metal_0", "47710_60480_01_shell001_Silver_Metal_0", "47710_60480_01_shell002_Silver_Metal_0", "47710_60480_01_shell003_Silver_Metal_0"];
const option = (id: string, category: CustomizationOption["category"], label: string, targetNodes: string[], targetMaterials: string[], materialConfig: MaterialConfig, priceDelta = 0, selectionGroup?: string): CustomizationOption => ({
  id, category, label, operation: "material-update", targetNodes, targetMaterials, materialConfig, priceDelta, compatibleVehicleIds: V, ...(selectionGroup ? { selectionGroup } : {}),
});
const paint = (id: string, label: string, color: string, priceDelta = 0) => option(id, "paint", label, PAINT_NODES, ["CarPaint", "CarPaint_N2"], { color, metalness: 0.42, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.07 }, priceDelta);

export const landCruiserOptions: CustomizationOption[] = [
  paint("lc-paint-ice-cap", "Ice Cap", "#f2f2ef"),
  paint("lc-paint-black", "Black", "#111214"),
  paint("lc-paint-meteor-shower", "Meteor Shower", "#666a6c"),
  paint("lc-paint-trail-dust", "Trail Dust", "#b8a47d", 350),
  paint("lc-paint-heritage-blue", "Heritage Blue", "#4e738f", 350),
  option("lc-wheel-machined", "wheels", "Machined Alloy Wheels", WHEELS, ["black_metal", "chrome"], { color: "#9aa0a6", metalness: 0.9, roughness: 0.22 }, 0, "wheels"),
  option("lc-wheel-black", "wheels", "Black Alloy Wheels", WHEELS, ["black_metal", "chrome"], { color: "#141619", metalness: 0.82, roughness: 0.25 }, 750, "wheels"),
  option("lc-wheel-bronze", "wheels", "Bronze Off-Road Wheels", WHEELS, ["black_metal", "chrome"], { color: "#7a5d3c", metalness: 0.84, roughness: 0.3 }, 950, "wheels"),
  option("lc-tire-black", "tires", "All-Terrain Black Sidewall", TIRES, ["tire", "side_tire"], { color: "#171819", metalness: 0.04, roughness: 0.88 }),
  option("lc-tire-charcoal", "tires", "Trail Charcoal Sidewall", TIRES, ["tire", "side_tire"], { color: "#292a2b", metalness: 0.06, roughness: 0.76 }, 500),
  option("lc-caliper-silver", "brakes", "Silver Brake Calipers", CALIPERS, ["Silver_Metal"], { color: "#a7abb0", metalness: 0.88, roughness: 0.25 }, 0, "brake-caliper"),
  option("lc-caliper-red", "brakes", "Red Brake Calipers", CALIPERS, ["Silver_Metal"], { color: "#b51d25", metalness: 0.58, roughness: 0.24 }, 650, "brake-caliper"),
  option("lc-caliper-yellow", "brakes", "Yellow Brake Calipers", CALIPERS, ["Silver_Metal"], { color: "#d5a91b", metalness: 0.52, roughness: 0.25 }, 700, "brake-caliper"),
  option("lc-grille-black", "trim", "Black Grille", ["_2a6fa0f4_1c24_4165_b12a_4743afed9cf5__grille_0", "polySurface3_grille_2_0", "polySurface3.001_grille_2_0"], ["grille", "grille_2"], { color: "#111214", metalness: 0.3, roughness: 0.5 }, 325, "grille"),
  option("lc-roof-dark", "trim", "Dark Roof Finish", ["63310_6B760_01_01_shell_roof_0"], ["roof"], { color: "#17191c", metalness: 0.3, roughness: 0.36 }, 450, "roof"),
];

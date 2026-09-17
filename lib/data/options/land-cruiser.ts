import type { CustomizationOption } from "../../types/customization";

const VEHICLE = ["land-cruiser"];
const PAINT_MATERIALS = ["CarPaint", "CarPaint_N2"];

// Exact exterior-paint mesh nodes from the optimized 250-series runtime GLB.
const PAINT_NODES = [
  "68105_60520_02_shell_CarPaint_N2_0",
  "_1811d776_ef04_4524_ae2c_baac6e1afae0__CarPaint_N2_0",
  "76085_60160_01_shell_CarPaint_N2_0",
  "_b53a94a6_c7df_4e78_9557_6b864c50fe97__CarPaint_N2_0",
  "_608501c7_ac7f_4b39_969f_4e63c702c159__CarPaint_0",
  "_c7dac6ab_6350_4649_a4fc_cbf0d9a8e552__CarPaint_0",
  "67663_60030_01_shell001_CarPaint_0",
  "67673_60040_01_shell001_CarPaint_0",
  "67673_60040_01_shell_CarPaint_0",
  "_cdea0b8b_5ed7_4c99_8440_e0bb31d930a4__CarPaint_0",
  "_3ad67829_5627_4efb_a10a_992002d1a143__CarPaint_0",
  "_ac6643ac_feff_4c4f_a5b9_91d2e4df2d97__CarPaint_0",
  "_a54e0edc_0498_4ebd_b373_6d7e5c414d11__CarPaint_0",
  "_150cda98_1ce1_4669_8db6_f9db82877b7f__CarPaint_0",
  "_6c068811_0bb1_41f3_8bc7_a1089782a774__CarPaint_0",
  "_2bb9de70_ef04_4377_8335_6fb345753ef4__CarPaint_0",
  "_6460ddf1_9e96_4d96_96e5_bd3122648ded__CarPaint_0",
  "67663_60030_01_shell_CarPaint_0",
];

function paint(id: string, label: string, color: string): CustomizationOption {
  return {
    id,
    category: "paint",
    label,
    operation: "material-update",
    targetNodes: PAINT_NODES,
    targetMaterials: PAINT_MATERIALS,
    materialConfig: { color, metalness: 0.68, roughness: 0.24, clearcoat: 1, clearcoatRoughness: 0.05 },
    compatibleVehicleIds: VEHICLE,
  };
}

export const landCruiserOptions: CustomizationOption[] = [
  paint("land-cruiser-paint-040-ice-cap", "Ice Cap", "#f2f2ef"),
  paint("land-cruiser-paint-202-black", "Black", "#111214"),
  paint("land-cruiser-paint-1l7-meteor-shower", "Meteor Shower", "#55585b"),
  paint("land-cruiser-paint-5c8-trail-dust", "Trail Dust", "#b7a27e"),
];

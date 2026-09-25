import type { CustomizationOption } from "../../types/customization";

/**
 * Corolla customization catalog.
 *
 * Same situation as `lib/data/options/tacoma.ts`: `threeDConfig.hasModel` is `false`, so these
 * options target the procedural fallback's shared node/material names (`BODY`/`body.carmain`,
 * `PLACED_WEISU_*`/`wheel.metal`) and are functional today. Paint labels, hexes, and grade gating
 * come from `lib/data/vehicles/corolla.ts`'s own `exteriorColors`.
 *
 * Off-road accessories (roof rack, light bar, rock sliders) are deliberately not offered on a
 * compact sedan; the runtime modification kit (`runtimeMods.ts`) supplies the street-style parts.
 */

const VEHICLE = ["corolla"];

const PAINT_NODES = ["BODY"];
const PAINT_MATERIALS = ["body.carmain"];
const WHEEL_NODES = [
  "PLACED_WEISU_front_left",
  "PLACED_WEISU_front_right",
  "PLACED_WEISU_rear_left",
  "PLACED_WEISU_rear_right",
];
// The procedural fallback uses one shared rim material for all four wheels.
const WHEEL_MATERIALS = ["wheel.metal"];

function paint(id: string, label: string, color: string, priceDelta?: number, gradeIds?: string[]): CustomizationOption {
  return {
    id,
    category: "paint",
    label,
    operation: "material-update",
    targetNodes: PAINT_NODES,
    targetMaterials: PAINT_MATERIALS,
    materialConfig: { color, metalness: 0.6, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.06 },
    ...(priceDelta ? { priceDelta } : {}),
    ...(gradeIds ? { compatibleGradeIds: gradeIds } : {}),
    compatibleVehicleIds: VEHICLE,
  };
}

function wheelFinish(
  id: string,
  label: string,
  materialConfig: CustomizationOption["materialConfig"],
  priceDelta?: number,
  gradeIds?: string[],
): CustomizationOption {
  return {
    id,
    category: "wheels",
    label,
    operation: "material-update",
    targetNodes: WHEEL_NODES,
    targetMaterials: WHEEL_MATERIALS,
    materialConfig,
    ...(priceDelta ? { priceDelta } : {}),
    ...(gradeIds ? { compatibleGradeIds: gradeIds } : {}),
    compatibleVehicleIds: VEHICLE,
  };
}

export const corollaOptions: CustomizationOption[] = [
  paint("paint-040-super-white", "Super White", "#f2f2ef"),
  paint("paint-1j9-classic-silver", "Classic Silver Metallic", "#b9bdc2", undefined, ["le", "hybrid-le", "se"]),
  paint("paint-1h5-celestite-gray", "Celestite Gray Metallic", "#6f7780"),
  paint("paint-209-black-sand", "Black Sand Pearl", "#15161a"),
  paint("paint-3u5-barcelona-red", "Barcelona Red Metallic", "#9d1d20", 425, ["le", "se", "xse"]),
  paint("paint-8x8-blueprint", "Blueprint", "#1558d6", undefined, ["hybrid-le", "se", "xse"]),

  wheelFinish("wheels-alloy-silver", "Silver Alloy", { color: "#b3bac1", metalness: 0.92, roughness: 0.2 }),
  wheelFinish("wheels-gloss-black", "Gloss Black Alloy", { color: "#121418", metalness: 0.7, roughness: 0.18 }, 350, ["se", "xse"]),
  wheelFinish("wheels-gunmetal", "Gunmetal", { color: "#3d4248", metalness: 0.85, roughness: 0.3 }, 420),

  {
    id: "accessory-fog-lights",
    category: "accessory",
    label: "LED Fog Lights",
    operation: "mesh-visibility",
    targetNodes: ["ACCESSORY_FOG_LIGHTS"],
    priceDelta: 320,
    geometrySource: "procedural-preview",
    compatibleVehicleIds: VEHICLE,
  },
];

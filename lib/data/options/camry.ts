import type { CustomizationOption } from "../../types/customization";

/**
 * Camry customization catalog.
 *
 * Same rationale as `lib/data/options/tacoma.ts`: `hasModel` is `false`
 * (`lib/data/vehicles/camry.ts`), so `VehicleCanvas` renders the procedural fallback vehicle
 * (`lib/three/proceduralParts.ts`), which is deliberately named to match the real 4Runner GLB's
 * node/material contract. These options are genuinely functional against that fallback today.
 *
 * Unlike Tacoma, this catalog omits the off-road accessories (roof rack, light bar, rock sliders)
 * and raised-white-letter tire lettering — all are truck/off-road-coded and would misrepresent what
 * a Camry buyer is actually choosing between, even though the underlying procedural nodes exist and
 * would technically resolve. Catalog scope is a per-vehicle product decision, not just "everything
 * the fallback happens to support."
 */

const VEHICLE = ["camry"];

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
const TIRE_NODES = [
  "PLACED_KO3_front_left",
  "PLACED_KO3_front_right",
  "PLACED_KO3_rear_left",
  "PLACED_KO3_rear_right",
];

function paint(id: string, label: string, color: string, gradeIds?: string[]): CustomizationOption {
  return {
    id,
    category: "paint",
    label,
    operation: "material-update",
    targetNodes: PAINT_NODES,
    targetMaterials: PAINT_MATERIALS,
    materialConfig: { color, metalness: 0.7, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.05 },
    ...(gradeIds ? { compatibleGradeIds: gradeIds } : {}),
    compatibleVehicleIds: VEHICLE,
  };
}

export const camryOptions: CustomizationOption[] = [
  // Matches lib/data/vehicles/camry.ts's exteriorColors exactly: code, name, hex, and grade gating.
  paint("paint-040-super-white", "Super White", "#f2f2ef", ["le", "xle"]),
  paint("paint-1g3-underground", "Underground", "#4f545a"),
  paint("paint-070-midnight-black", "Midnight Black Metallic", "#101215"),
  paint("paint-3u5-barcelona-red", "Barcelona Red Metallic", "#9d1d20", ["xle", "xse"]),

  {
    id: "wheels-sport-machined",
    category: "wheels",
    label: "Sport Machined",
    operation: "material-update",
    targetNodes: WHEEL_NODES,
    targetMaterials: WHEEL_MATERIALS,
    materialConfig: { color: "#a7acb3", metalness: 0.9, roughness: 0.18 },
    compatibleVehicleIds: VEHICLE,
  },
  {
    id: "wheels-gloss-black",
    category: "wheels",
    label: "Gloss Black",
    operation: "material-update",
    targetNodes: WHEEL_NODES,
    targetMaterials: WHEEL_MATERIALS,
    materialConfig: { color: "#0e0f11", metalness: 0.6, roughness: 0.15 },
    priceDelta: 350,
    compatibleVehicleIds: VEHICLE,
    compatibleGradeIds: ["xle", "xse"],
  },

  {
    id: "trim-tire-letters-blackwall",
    category: "trim",
    label: "Blackwall",
    operation: "material-update",
    targetNodes: TIRE_NODES,
    targetMaterials: ["tire.sidewall"],
    materialConfig: { color: "#141414", roughness: 0.94 },
    compatibleVehicleIds: VEHICLE,
  },
];

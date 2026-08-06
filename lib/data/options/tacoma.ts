import type { CustomizationOption } from "../../types/customization";

/**
 * Tacoma customization catalog.
 *
 * `threeDConfig.hasModel` is `false` for this vehicle (`lib/data/vehicles/tacoma.ts`) — there is no
 * Tacoma GLB in this repo, only the shared 4Runner asset. `VehicleCanvas`'s `loadVehicleRoot` falls
 * back to `createProceduralVehicle()` (`lib/three/proceduralParts.ts`) for any vehicle without a
 * model, and that fallback is deliberately built with the *same* node and material names as the real
 * 4Runner GLB ("named to match the detailed asset so the same catalog records resolve against the
 * fallback" — see that file's own comment). These options target those shared names, so they are
 * genuinely functional today against the procedural vehicle, not forward-declared placeholders
 * waiting on an asset — unlike the 4Runner catalog's gated hood/decal entries.
 *
 * Colours are pulled from `lib/data/vehicles/tacoma.ts`'s own `exteriorColors`/`grades`, rather than
 * invented, so a paint option's label, hex, and grade gating always match the vehicle's own data.
 */

const VEHICLE = ["tacoma"];

const PAINT_NODES = ["BODY"];
const PAINT_MATERIALS = ["body.carmain"];
const WHEEL_NODES = [
  "PLACED_WEISU_front_left",
  "PLACED_WEISU_front_right",
  "PLACED_WEISU_rear_left",
  "PLACED_WEISU_rear_right",
];
const WHEEL_MATERIALS = ["wheel.metal", "wheel.metal.001"];
const TIRE_NODES = [
  "PLACED_KO3_front_left",
  "PLACED_KO3_front_right",
  "PLACED_KO3_rear_left",
  "PLACED_KO3_rear_right",
];

function paint(id: string, label: string, color: string, priceDelta?: number, gradeIds?: string[]): CustomizationOption {
  return {
    id,
    category: "paint",
    label,
    operation: "material-update",
    targetNodes: PAINT_NODES,
    targetMaterials: PAINT_MATERIALS,
    materialConfig: { color, metalness: 0.65, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.06 },
    ...(priceDelta ? { priceDelta } : {}),
    ...(gradeIds ? { compatibleGradeIds: gradeIds } : {}),
    compatibleVehicleIds: VEHICLE,
  };
}

export const tacomaOptions: CustomizationOption[] = [
  // Matches lib/data/vehicles/tacoma.ts's exteriorColors exactly: code, name, hex, and grade gating.
  paint("paint-040-super-white", "Super White", "#f2f2ef"),
  paint("paint-218-blueprint", "Blueprint", "#1558d6"),
  paint("paint-1j9-ice-cap", "Ice Cap", "#d8dde2", undefined, ["sr", "trd-off-road", "trd-pro"]),
  paint("paint-3u5-barcelona-red", "Barcelona Red Metallic", "#9d1d20", undefined, ["trd-off-road"]),
  paint("paint-0r2-solar-octane", "Solar Octane", "#ff6a1a", 425, ["trd-pro"]),

  {
    id: "wheels-trail-machined",
    category: "wheels",
    label: "Trail Machined",
    operation: "material-update",
    targetNodes: WHEEL_NODES,
    targetMaterials: WHEEL_MATERIALS,
    materialConfig: { color: "#9aa1ab", metalness: 0.92, roughness: 0.22 },
    compatibleVehicleIds: VEHICLE,
  },
  {
    id: "wheels-trail-satin-black",
    category: "wheels",
    label: "Trail Satin Black",
    operation: "material-update",
    targetNodes: WHEEL_NODES,
    targetMaterials: WHEEL_MATERIALS,
    materialConfig: { color: "#15171a", metalness: 0.55, roughness: 0.52 },
    priceDelta: 380,
    compatibleVehicleIds: VEHICLE,
  },

  {
    id: "trim-tire-letters-raised-white",
    category: "trim",
    selectionGroup: "trim-tire-letters",
    label: "Raised White Letters",
    operation: "material-update",
    targetNodes: TIRE_NODES,
    targetMaterials: ["tire.sidewall"],
    materialConfig: { color: "#6f6f6c", roughness: 0.85 },
    compatibleVehicleIds: VEHICLE,
  },
  {
    id: "trim-tire-letters-blackwall",
    category: "trim",
    selectionGroup: "trim-tire-letters",
    label: "Blackwall",
    operation: "material-update",
    targetNodes: TIRE_NODES,
    targetMaterials: ["tire.sidewall"],
    materialConfig: { color: "#141414", roughness: 0.94 },
    compatibleVehicleIds: VEHICLE,
  },

  // A midsize truck is exactly what these procedural accessories (lib/three/proceduralParts.ts)
  // were modelled for; all three are appropriate here, unlike on a sedan.
  {
    id: "accessory-roof-rack",
    category: "accessory",
    label: "Overland Roof Rack",
    operation: "mesh-visibility",
    targetNodes: ["ACCESSORY_ROOF_RACK"],
    priceDelta: 1150,
    compatibleVehicleIds: VEHICLE,
  },
  {
    id: "accessory-light-bar",
    category: "accessory",
    label: "LED Light Bar",
    operation: "mesh-visibility",
    targetNodes: ["ACCESSORY_LIGHT_BAR"],
    priceDelta: 680,
    compatibleVehicleIds: VEHICLE,
    compatibleGradeIds: ["trd-off-road", "trd-pro"],
  },
  {
    id: "accessory-rock-sliders",
    category: "accessory",
    label: "Rock Sliders",
    operation: "mesh-visibility",
    targetNodes: ["ACCESSORY_ROCK_SLIDERS"],
    priceDelta: 890,
    compatibleVehicleIds: VEHICLE,
    compatibleGradeIds: ["trd-off-road", "trd-pro"],
  },
];

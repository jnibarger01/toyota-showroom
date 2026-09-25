import type { CustomizationOption, MaterialConfig } from "../../types/customization";

/**
 * GR Corolla customization catalog, targeting the shipped Sketchfab GLB
 * (`public/models/gr-corolla-2023/gr-corolla.glb`). The export names meshes generically
 * (`Object_N`), so each target is pinned to the mesh that carries the named material — verified
 * against the file in docs/GR_COROLLA_PROVENANCE.md and re-checked by tests/glbContract.test.ts.
 * Paint labels, hexes, and grade gating match `lib/data/vehicles/gr-corolla.ts`'s exteriorColors.
 */

const VEHICLE = ["gr-corolla"];

const BODY = ["Object_7"];
const ROOF = ["Object_8"];
const SPOILER = ["Object_12"];
// One rim mesh per wheel assembly (wheel_7, wheel.001_11, wheel.002_13, wheel.003_15).
const RIMS = ["Object_29", "Object_42", "Object_50", "Object_58"];
const CALIPERS = ["Object_4", "Object_46", "Object_54", "Object_62"];

function option(
  id: string,
  category: CustomizationOption["category"],
  label: string,
  targetNodes: string[],
  targetMaterials: string[],
  materialConfig: MaterialConfig,
  extra: Partial<CustomizationOption> = {},
): CustomizationOption {
  return {
    id,
    category,
    label,
    operation: "material-update",
    targetNodes,
    targetMaterials,
    materialConfig,
    compatibleVehicleIds: VEHICLE,
    ...extra,
  };
}

const paint = (id: string, label: string, color: string, extra: Partial<CustomizationOption> = {}) =>
  option(id, "paint", label, BODY, ["paint"], { color, metalness: 0.55, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.05 }, extra);

const rims = (id: string, label: string, materialConfig: MaterialConfig, extra: Partial<CustomizationOption> = {}) =>
  // No selectionGroup: like the Supra's finishes, these share the "wheels" group with the procedural
  // wheel packages (lib/data/wheelPackages.ts), so choosing a finish swaps a fitted package back out.
  option(id, "wheels", label, RIMS, ["material_18"], materialConfig, extra);

export const grCorollaOptions: CustomizationOption[] = [
  paint("paint-089-blizzard-pearl", "Blizzard Pearl", "#eceeee", { priceDelta: 425, compatibleGradeIds: ["core", "circuit"] }),
  paint("paint-3u5-supersonic-red", "Supersonic Red", "#b3121c", { compatibleGradeIds: ["core", "circuit"] }),
  paint("paint-202-black", "Black", "#0f1012", { compatibleGradeIds: ["core"] }),
  paint("paint-1k6-heavy-metal", "Heavy Metal", "#4a4e53", { compatibleGradeIds: ["circuit", "morizo"] }),

  rims("wheels-gloss-black", "Gloss Black cast alloy", { color: "#141519", metalness: 0.7, roughness: 0.2 }),
  rims("wheels-matte-bronze", "Matte Bronze forged", { color: "#7a5a34", metalness: 0.85, roughness: 0.45 }, { priceDelta: 1850 }),
  rims("wheels-silver", "Hyper Silver", { color: "#b8bec5", metalness: 0.95, roughness: 0.18 }, { priceDelta: 950 }),

  option("roof-carbon", "accessory", "Forged carbon roof", ROOF, ["roof"], { color: "#16181b", metalness: 0.35, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.1 }, {
    priceDelta: 1400,
    selectionGroup: "gr-corolla-roof",
  }),
  option("roof-body-color", "accessory", "Body-colour roof", ROOF, ["roof"], { color: "#b8bcc1", metalness: 0.5, roughness: 0.3, clearcoat: 1 }, {
    selectionGroup: "gr-corolla-roof",
    compatibleGradeIds: ["core"],
  }),
  option("spoiler-gloss-black", "aero", "Gloss black rear spoiler", SPOILER, ["spoiler"], { color: "#0e0f11", metalness: 0.4, roughness: 0.2, clearcoat: 1 }, { priceDelta: 350 }),
  option("calipers-gr-red", "brakes", "GR red brake calipers", CALIPERS, ["calliper"], { color: "#c1121f", metalness: 0.4, roughness: 0.3 }, { priceDelta: 600 }),
  option("calipers-yellow", "brakes", "Yellow brake calipers", CALIPERS, ["calliper"], { color: "#e2b714", metalness: 0.4, roughness: 0.3 }, { priceDelta: 600 }),
];

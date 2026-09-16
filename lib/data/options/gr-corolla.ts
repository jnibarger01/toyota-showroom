import type { CustomizationOption, MaterialConfig } from "../../types/customization";

const V = ["gr-corolla"];
const wheels = ["Object_31", "Object_44", "Object_52", "Object_60"];
const calipers = ["Object_4", "Object_46", "Object_54", "Object_62"];
const option = (
  id: string,
  category: CustomizationOption["category"],
  label: string,
  targetNodes: string[],
  targetMaterials: string[],
  materialConfig: MaterialConfig,
  priceDelta = 0,
  selectionGroup?: string,
): CustomizationOption => ({
  id, category, label, operation: "material-update", targetNodes, targetMaterials,
  materialConfig, priceDelta, compatibleVehicleIds: V, selectionGroup,
});
const paint = (id: string, label: string, color: string, priceDelta = 0) =>
  option(id, "paint", label, ["Object_7"], ["paint"], { color, metalness: 0.62, roughness: 0.24, clearcoat: 1, clearcoatRoughness: 0.08 }, priceDelta);

export const grCorollaOptions: CustomizationOption[] = [
  paint("grc-paint-ice-cap", "Ice Cap", "#f2f3f1"),
  paint("grc-paint-black", "Black", "#111214"),
  paint("grc-paint-supersonic-red", "Supersonic Red", "#a61f2b", 425),
  paint("grc-paint-heavy-metal", "Heavy Metal", "#62666b", 425),  option("grc-wheels-oem-dark", "wheels", "OEM dark alloy", wheels, ["rim_detail"], { color: "#35383d", metalness: 0.85, roughness: 0.28 }),
  option("grc-wheels-gloss-black", "wheels", "Gloss black wheels", wheels, ["rim_detail"], { color: "#101114", metalness: 0.8, roughness: 0.2 }, 700),
  option("grc-wheels-bronze", "wheels", "Bronze wheels", wheels, ["rim_detail"], { color: "#8b6844", metalness: 0.85, roughness: 0.28 }, 900),
  option("grc-calipers-red", "accessory", "GR red calipers", calipers, ["calliper"], { color: "#c51e2b", metalness: 0.55, roughness: 0.24 }, 500, "brake-caliper"),
  option("grc-calipers-yellow", "accessory", "Yellow calipers", calipers, ["calliper"], { color: "#e0b51c", metalness: 0.5, roughness: 0.25 }, 650, "brake-caliper"),
  option("grc-roof-carbon", "trim", "Carbon-style roof", ["Object_8"], ["roof"], { color: "#15171a", metalness: 0.35, roughness: 0.3 }, 1200, "roof-finish"),
  option("grc-spoiler-black", "trim", "Gloss black spoiler", ["Object_12"], ["spoiler"], { color: "#111214", metalness: 0.4, roughness: 0.2 }, 350, "spoiler-finish"),
  option("grc-mirrors-black", "trim", "Black mirror caps", ["Object_14"], ["mirror"], { color: "#111214", metalness: 0.45, roughness: 0.22 }, 250, "mirror-finish"),
  option("grc-light-cool-white", "lighting", "Cool white lighting", ["Object_16", "Object_17"], ["lights", "light_2"], { color: "#dce9ff", metalness: 0.05, roughness: 0.18 }),
  option("grc-light-ice-blue", "lighting", "Ice blue lighting", ["Object_16", "Object_17"], ["lights", "light_2"], { color: "#9bc8ff", metalness: 0.05, roughness: 0.18 }, 150),
  option("grc-interior-black", "interior", "Black cabin", ["Object_33", "Object_34"], ["int_2", "material_21"], { color: "#18191b", metalness: 0.05, roughness: 0.62 }),
  option("grc-interior-red-accent", "interior", "Red cabin accents", ["Object_33", "Object_34"], ["int_2", "material_21"], { color: "#64171d", metalness: 0.06, roughness: 0.58 }, 600),
];
import type { CustomizationOption, MaterialConfig } from "../../types/customization";

const vehicleIds = ["gt86"];
const bodyNodes = [
  "Object_10",
  "Object_11",
  "Object_12",
  "Object_13",
  "Object_14",
  "Object_15",
  "Object_16",
  "Object_17",
];

function paint(id: string, label: string, color: string, extra: MaterialConfig = {}): CustomizationOption {
  return {
    id,
    category: "paint",
    label,
    operation: "material-update",
    targetNodes: bodyNodes,
    targetMaterials: ["body.001"],
    materialConfig: {
      color,
      metalness: 0.55,
      roughness: 0.26,
      clearcoat: 1,
      clearcoatRoughness: 0.08,
      ...extra,
    },
    compatibleVehicleIds: vehicleIds,
  };
}

export const gt86Options: CustomizationOption[] = [
  paint("gt86-paint-white", "Satin White Pearl", "#f2f1eb", { metalness: 0.28 }),
  paint("gt86-paint-black", "Crystal Black Silica", "#111318"),
  paint("gt86-paint-red", "Lightning Red", "#a51e2a", { metalness: 0.42 }),
  paint("gt86-paint-blue", "Galaxy Blue Silica", "#173d69"),
];

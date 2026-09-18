import type { CustomizationOption } from "../../types/customization";
import { RUNTIME_MOD_NODE_NAMES } from "../../three/proceduralMods";

function geometryOption(
  vehicleId: string,
  suffix: string,
  category: CustomizationOption["category"],
  label: string,
  targetNode: string,
  priceDelta: number,
  selectionGroup?: string,
): CustomizationOption {
  return {
    id: `runtime-${vehicleId}-${suffix}`,
    category,
    label,
    operation: "mesh-visibility",
    targetNodes: [targetNode],
    priceDelta,
    compatibleVehicleIds: [vehicleId],
    geometrySource: "procedural-runtime",
    ...(selectionGroup ? { selectionGroup } : {}),
  };
}

/** Runtime-generated modifications shared by every explorable vehicle. */
export function createRuntimeModificationOptions(
  vehicleId: string,
  baseOptions: readonly CustomizationOption[],
): CustomizationOption[] {
  const options: CustomizationOption[] = [
    geometryOption(vehicleId, "rims-mesh", "wheels", "Mesh Performance Rims", RUNTIME_MOD_NODE_NAMES.rims, 1450, "wheels"),
    geometryOption(vehicleId, "tires-track", "tires", "Track Compound Tires", RUNTIME_MOD_NODE_NAMES.tires, 980),
    geometryOption(vehicleId, "brakes-big-red", "brakes", "Big Brake Kit — Red", RUNTIME_MOD_NODE_NAMES.brakes, 2200),
    geometryOption(vehicleId, "exhaust-titanium-dual", "exhaust", "Titanium Dual Exhaust", RUNTIME_MOD_NODE_NAMES.exhaust, 1650),
    geometryOption(vehicleId, "aero-ducktail", "aero", "Ducktail Spoiler", RUNTIME_MOD_NODE_NAMES.ducktail, 1250, "aero-rear-upper"),
    geometryOption(vehicleId, "aero-front-splitter", "aero", "Front Splitter", RUNTIME_MOD_NODE_NAMES.splitter, 850, "aero-front"),
    geometryOption(vehicleId, "aero-side-skirts", "aero", "Side Skirts", RUNTIME_MOD_NODE_NAMES.sideSkirts, 900, "aero-side"),
    geometryOption(vehicleId, "aero-rear-diffuser", "aero", "Rear Diffuser", RUNTIME_MOD_NODE_NAMES.diffuser, 950, "aero-rear-lower"),
    geometryOption(vehicleId, "carbon-hood-accent", "carbon", "Carbon Hood Accent", RUNTIME_MOD_NODE_NAMES.carbon, 1100),
    geometryOption(vehicleId, "trim-blackout", "trim", "Blackout Trim Package", RUNTIME_MOD_NODE_NAMES.trim, 625, "runtime-body-trim"),
    geometryOption(vehicleId, "lighting-underglow", "lighting", "Ice Blue Underglow", RUNTIME_MOD_NODE_NAMES.underglow, 575, "runtime-underglow"),
  ];

  const paintTemplate = baseOptions.find(
    (option) => option.category === "paint" && option.operation === "material-update" && option.targetNodes?.length,
  );
  if (paintTemplate) {
    options.push({
      id: `runtime-${vehicleId}-paint-satin-graphite`,
      category: "paint",
      label: "Satin Graphite",
      operation: "material-update",
      targetNodes: [...(paintTemplate.targetNodes ?? [])],
      targetMaterials: [...(paintTemplate.targetMaterials ?? [])],
      materialConfig: {
        color: "#30343a",
        metalness: 0.52,
        roughness: 0.46,
        clearcoat: 0.72,
        clearcoatRoughness: 0.18,
      },
      priceDelta: 795,
      compatibleVehicleIds: [vehicleId],
    });
  }

  return options;
}

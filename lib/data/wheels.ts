import type { WheelAndTireAssetConfig } from "../types/vehicle";

export interface GlobalWheelAsset extends WheelAndTireAssetConfig {
  id: string;
  label: string;
  provenance: { source: string; author?: string; license: string; attribution?: string };
  verifiedVehicleIds: string[];
}

/** Shared aftermarket wheels. Compatibility is explicit; unverified assets are never exposed. */
export const GLOBAL_WHEEL_ASSETS: readonly GlobalWheelAsset[] = [
  {
    id: "trd-pro-wheel",
    label: "TRD Pro wheel",
    wheelUrl: "/models/4runner-2024/wheel_trd_pro.glb",
    tireUrl: "/models/4runner-2024/ModsNation_7416_tire.glb",
    scale: 1,
    wheelNodeNames: ["wheel_trd_pro", "wheel_trd_pro", "wheel_trd_pro", "wheel_trd_pro"],
    tireNodeNames: ["PLACED_KO3_front_left", "PLACED_KO3_front_right", "PLACED_KO3_rear_left", "PLACED_KO3_rear_right"],
    provenance: { source: "Supplied wheel_trd_pro.glb", license: "User-provided asset; provenance retained in asset inventory" },
    verifiedVehicleIds: ["4runner"],
  },
  {
    id: "bugatti-wheel-free-download",
    label: "Bugatti wheel (unverified)",
    wheelUrl: "/models/wheels/bugatti-wheel.glb",
    tireUrl: "",
    wheelNodeNames: ["bugatti_wheel_low_Chiron_wheelsShdr_0", "bugatti_wheel_low_Chiron_wheelsShdr_0", "bugatti_wheel_low_Chiron_wheelsShdr_0", "bugatti_wheel_low_Chiron_wheelsShdr_0"],
    tireNodeNames: ["", "", "", ""],
    provenance: { source: "Sketchfab 71618eba5db5478e963fc5df0808b0d6", author: "tulex_art", license: "CC-BY-4.0", attribution: "Bugatti Wheel Free Download by tulex_art" },
    verifiedVehicleIds: [],
  },
];

export function getCompatibleGlobalWheelAssets(vehicleId: string): GlobalWheelAsset[] {
  return GLOBAL_WHEEL_ASSETS.filter((asset) => asset.verifiedVehicleIds.includes(vehicleId) && asset.tireUrl && asset.wheelNodeNames.every(Boolean) && asset.tireNodeNames.every(Boolean));
}

/** Translate verified shared assets into normal declarative options consumed by the builder. */
export function getGlobalWheelOptions(vehicleId: string): import("../types/customization").CustomizationOption[] {
  return getCompatibleGlobalWheelAssets(vehicleId).map((asset) => ({
    id: asset.id === "trd-pro-wheel" ? "wheels-trd-pro-global" : `wheels-global-${asset.id}`,
    category: "wheels",
    label: asset.label,
    operation: "mesh-replacement",
    mountNodes: asset.verifiedVehicleIds.includes("4runner")
      ? ["MOUNT_WHEEL_FRONT_LEFT", "MOUNT_WHEEL_FRONT_RIGHT", "MOUNT_WHEEL_REAR_LEFT", "MOUNT_WHEEL_REAR_RIGHT"]
      : [],
    hidesNodes: ["PLACED_WEISU_front_left", "PLACED_WEISU_front_right", "PLACED_WEISU_rear_left", "PLACED_WEISU_rear_right"],
    assetUrl: asset.wheelUrl,
    priceDelta: 1850,
    compatibleVehicleIds: [vehicleId],
    compatibleGradeIds: ["trd-pro"],
  }));
}

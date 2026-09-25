import type { Vehicle } from "../../types/vehicle";

/** 2025 Land Cruiser 250 catalog entry backed by the authored September 2026 GLB import. */
export const landCruiser: Vehicle = {
  slug: "land-cruiser",
  year: 2025,
  model: "Land Cruiser",
  bodyStyle: "suv",
  categories: ["suv", "off-road", "hybrid"],
  availability: "in_production",
  updatedAt: "2026-09-17T00:00:00.000Z",
  pricing: { baseMsrp: 56700, destinationFee: 1450, currency: "USD" },
  powertrains: {
    "i-force-max": {
      id: "i-force-max", type: "hybrid", engine: "2.4L turbocharged i-FORCE MAX hybrid", horsepowerHp: 326,
      torqueLbFt: 465, transmission: "8-speed automatic", drivetrain: "4wd",
      fuelEconomy: { unit: "mpg", city: 22, highway: 25, combined: 23 }, towingCapacityLbs: 6000,
    },
  },
  grades: [
    { id: "1958", name: "1958", msrp: 56700, powertrainId: "i-force-max", seating: 5, availableExteriorColorCodes: ["040", "202", "1L7", "5C8"], availableInteriorColorCodes: ["black"], standardFeatures: ["Full-time 4WD", "Center locking differential", "Toyota Safety Sense 3.0"], packages: [] },
    { id: "land-cruiser", name: "Land Cruiser", msrp: 61470, powertrainId: "i-force-max", seating: 5, availableExteriorColorCodes: ["040", "202", "1L7", "5C8", "4Z0"], availableInteriorColorCodes: ["black", "java"], standardFeatures: ["Multi-Terrain Select", "Crawl Control", "Stabilizer Disconnect Mechanism"], packages: [] },
  ],
  specs: [
    { category: "dimensions", key: "length_in", label: "Overall length", value: 193.8, unit: "in" },
    { category: "dimensions", key: "width_in", label: "Overall width", value: 77.9, unit: "in" },
    { category: "dimensions", key: "height_in", label: "Overall height", value: 76.1, unit: "in" },
    { category: "capability", key: "ground_clearance_in", label: "Ground clearance", value: 8.7, unit: "in" },
    { category: "capability", key: "towing_lbs", label: "Maximum towing", value: 6000, unit: "lb" },
    { category: "performance", key: "system_hp", label: "i-FORCE MAX output", value: 326, unit: "hp" },
  ],
  exteriorColors: [
    { code: "040", name: "Ice Cap", hex: "#f2f2ef", availableGradeIds: ["1958", "land-cruiser"] },
    { code: "202", name: "Black", hex: "#111214", availableGradeIds: ["1958", "land-cruiser"] },
    { code: "1L7", name: "Meteor Shower", hex: "#666a6c", availableGradeIds: ["1958", "land-cruiser"] },
    { code: "5C8", name: "Trail Dust", hex: "#b8a47d", availableGradeIds: ["1958", "land-cruiser"], isPremium: true },
    { code: "4Z0", name: "Heritage Blue", hex: "#4e738f", availableGradeIds: ["land-cruiser"], isPremium: true },
  ],
  interiorColors: [
    { code: "black", name: "Black", hex: "#17181a", material: "fabric", availableGradeIds: ["1958", "land-cruiser"] },
    { code: "java", name: "Java", hex: "#5b3828", material: "leather", availableGradeIds: ["land-cruiser"] },
  ],
  media: {
    // Thumbnail rendered from the runtime GLB by scripts/render-thumbnails.ts.
    hero: { url: "/images/vehicles/land-cruiser/land-cruiser-thumbnail.webp", alt: "2025 Toyota Land Cruiser, front three-quarter 3D render", width: 800, height: 500 },
    gallery: [{ url: "/images/vehicles/land-cruiser/land-cruiser-thumbnail.webp", alt: "2025 Toyota Land Cruiser, front three-quarter 3D render", width: 800, height: 500 }],
    thumbnails: [{ url: "/images/vehicles/land-cruiser/land-cruiser-thumbnail.webp", alt: "2025 Toyota Land Cruiser, front three-quarter 3D render", width: 800, height: 500 }],
    videos: [],
    environmentMaps: [],
  },
  threeDConfig: {
    hasModel: true,
    modelUrl: "/models/land-cruiser-250-2025/land-cruiser-250.glb",
    lodModelUrl: "/models/land-cruiser-250-2025/land-cruiser-250.lod1.glb",
    rotation: [0, 0, 0],
    texturePolicy: "preserve",
    cameraPresets: [
      { id: "hero", label: "Hero", position: [7.4, 3.2, -8.0], target: [0, 1.1, 0] },
      { id: "front", label: "Front", position: [0, 2.0, -9.5], target: [0, 1.0, 0] },
      { id: "side", label: "Side", position: [9.5, 2.0, 0], target: [0, 1.0, 0] },
      { id: "rear", label: "Rear", position: [0, 2.0, 9.5], target: [0, 1.0, 0] },
      { id: "wheels", label: "Wheels", position: [6.0, 1.1, 5.5], target: [0.75, 0.5, 1.35] },
    ],
    paintableMaterialNames: ["CarPaint", "CarPaint_N2"],
    wheelMountNames: [
      "_a8a3bf22_8cf5_42fc_a19b_f3d09aed8e82_.001_tire_0",
      "_a8a3bf22_8cf5_42fc_a19b_f3d09aed8e82_.002_tire_0",
      "_a8a3bf22_8cf5_42fc_a19b_f3d09aed8e82_.003_tire_0",
      "_a8a3bf22_8cf5_42fc_a19b_f3d09aed8e82_.004_tire_0",
    ],
    interiorMaterialNames: ["Cuero_1", "Cuero_PErf"],
  },
};

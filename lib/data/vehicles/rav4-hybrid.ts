import type { Vehicle } from "../../types/vehicle";

/** 2023 RAV4 Hybrid catalog entry backed by the authored September 2026 GLB import. */
export const rav4Hybrid: Vehicle = {
  slug: "rav4-hybrid",
  year: 2023,
  model: "RAV4 Hybrid",
  bodyStyle: "crossover",
  categories: ["crossover", "suv", "compact", "hybrid"],
  availability: "in_production",
  updatedAt: "2026-09-17T00:00:00.000Z",
  pricing: { baseMsrp: 31025, destinationFee: 1335, currency: "USD" },
  powertrains: {
    "2.5l-hybrid-awd": {
      id: "2.5l-hybrid-awd", type: "hybrid", engine: "2.5L Dynamic Force hybrid", horsepowerHp: 219,
      torqueLbFt: 163, transmission: "electronically controlled CVT", drivetrain: "awd",
      fuelEconomy: { unit: "mpg", city: 41, highway: 38, combined: 40 }, towingCapacityLbs: 1750,
    },
  },
  grades: [
    { id: "le", name: "LE", msrp: 31025, powertrainId: "2.5l-hybrid-awd", seating: 5, availableExteriorColorCodes: ["040", "1G3", "218", "3T3"], availableInteriorColorCodes: ["black"], standardFeatures: ["Electronic On-Demand AWD", "Toyota Safety Sense 2.5", "Hybrid powertrain"], packages: [] },
    { id: "xle", name: "XLE", msrp: 32535, powertrainId: "2.5l-hybrid-awd", seating: 5, availableExteriorColorCodes: ["040", "1G3", "218", "3T3", "202"], availableInteriorColorCodes: ["black", "ash"], standardFeatures: ["Smart Key System", "Blind Spot Monitor", "Dual-zone climate control"], packages: [] },
    { id: "limited", name: "Limited", msrp: 39430, powertrainId: "2.5l-hybrid-awd", seating: 5, availableExteriorColorCodes: ["040", "1G3", "218", "3T3", "202"], availableInteriorColorCodes: ["black", "ash"], standardFeatures: ["JBL premium audio", "Ventilated front seats", "Digital rearview mirror"], packages: [] },
  ],
  specs: [
    { category: "dimensions", key: "length_in", label: "Overall length", value: 180.9, unit: "in" },
    { category: "dimensions", key: "width_in", label: "Overall width", value: 73.0, unit: "in" },
    { category: "dimensions", key: "height_in", label: "Overall height", value: 67.0, unit: "in" },
    { category: "performance", key: "system_hp", label: "Hybrid system output", value: 219, unit: "hp" },
    { category: "technology", key: "awd", label: "Electronic On-Demand AWD", value: true },
    { category: "safety", key: "tss", label: "Toyota Safety Sense", value: "TSS 2.5" },
  ],
  exteriorColors: [
    { code: "040", name: "Ice Cap", hex: "#f3f3ef", availableGradeIds: ["le", "xle", "limited"] },
    { code: "1G3", name: "Magnetic Gray Metallic", hex: "#555a60", availableGradeIds: ["le", "xle", "limited"] },
    { code: "202", name: "Midnight Black Metallic", hex: "#111317", availableGradeIds: ["xle", "limited"] },
    { code: "218", name: "Blueprint", hex: "#184b85", availableGradeIds: ["le", "xle", "limited"] },
    { code: "3T3", name: "Ruby Flare Pearl", hex: "#8b1820", availableGradeIds: ["le", "xle", "limited"], isPremium: true },
  ],
  interiorColors: [
    { code: "black", name: "Black", hex: "#17181a", material: "fabric", availableGradeIds: ["le", "xle", "limited"] },
    { code: "ash", name: "Ash", hex: "#8a8580", material: "softex", availableGradeIds: ["xle", "limited"] },
  ],
  media: {
    // Thumbnail rendered from the runtime GLB by scripts/render-thumbnails.ts.
    hero: { url: "/images/vehicles/rav4-hybrid/rav4-hybrid-thumbnail.webp", alt: "2023 Toyota RAV4 Hybrid, front three-quarter 3D render", width: 800, height: 500 },
    gallery: [{ url: "/images/vehicles/rav4-hybrid/rav4-hybrid-thumbnail.webp", alt: "2023 Toyota RAV4 Hybrid, front three-quarter 3D render", width: 800, height: 500 }],
    thumbnails: [{ url: "/images/vehicles/rav4-hybrid/rav4-hybrid-thumbnail.webp", alt: "2023 Toyota RAV4 Hybrid, front three-quarter 3D render", width: 800, height: 500 }],
    videos: [],
    environmentMaps: [],
  },
  threeDConfig: {
    hasModel: true,
    modelUrl: "/models/rav4-hybrid-2023/rav4-hybrid.glb",
    lodModelUrl: "/models/rav4-hybrid-2023/rav4-hybrid.lod1.glb",
    scale: [100, 100, 100],
    rotation: [0, 0, 0],
    texturePolicy: "preserve",
    cameraPresets: [
      { id: "hero", label: "Hero", position: [6.8, 2.9, -7.2], target: [0, 1.05, 0] },
      { id: "front", label: "Front", position: [0, 1.8, -8.5], target: [0, 0.95, 0] },
      { id: "side", label: "Side", position: [8.5, 1.8, 0], target: [0, 0.95, 0] },
      { id: "rear", label: "Rear", position: [0, 1.8, 8.5], target: [0, 0.95, 0] },
      { id: "wheels", label: "Wheels", position: [5.2, 1.0, 5.0], target: [0.75, 0.45, 1.25] },
    ],
    paintableMaterialNames: ["Tdummy_material_0_085", "Color_2"],
    wheelMountNames: ["T1_T:dummy_material_0_133_0", "T2_T:dummy_material_0_133_0", "T3_T:dummy_material_0_133_0", "T4_T:dummy_material_0_133_0"],
    interiorMaterialNames: ["int_Leather"],
  },
};

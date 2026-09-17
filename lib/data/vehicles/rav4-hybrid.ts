import type { Vehicle } from "../../types/vehicle";

/**
 * 2023 RAV4 Hybrid catalog entry backed by the supplied Ddiaz Design asset.
 * Pricing and specifications are representative showroom data, not a live Toyota offer.
 * Asset provenance and redistribution limits are documented in docs/MODEL_A_PROVENANCE.md.
 */
export const rav4Hybrid: Vehicle = {
  slug: "rav4-hybrid",
  year: 2023,
  model: "RAV4 Hybrid",
  bodyStyle: "crossover",
  categories: ["crossover", "suv", "hybrid", "electrified"],
  availability: "in_production",
  updatedAt: "2026-09-17T00:00:00.000Z",
  pricing: { baseMsrp: 30725, destinationFee: 1335, currency: "USD" },
  powertrains: {
    "hybrid-2.5l-awd": {
      id: "hybrid-2.5l-awd",
      type: "hybrid",
      engine: "2.5L four-cylinder hybrid",
      horsepowerHp: 219,
      torqueLbFt: 163,
      transmission: "electronic CVT",
      drivetrain: "awd",
      fuelEconomy: { unit: "mpg", city: 41, highway: 38, combined: 40 },
      towingCapacityLbs: 1750,
    },
  },
  grades: [
    {
      id: "le",
      name: "Hybrid LE",
      msrp: 30725,
      powertrainId: "hybrid-2.5l-awd",
      seating: 5,
      availableExteriorColorCodes: ["040", "1G3", "218", "3U5"],
      availableInteriorColorCodes: ["black-fabric"],
      standardFeatures: ["Electronic on-demand AWD", "Toyota Safety Sense 2.5", "Hybrid powertrain"],
      packages: [],
    },
    {
      id: "xse",
      name: "Hybrid XSE",
      msrp: 36085,
      powertrainId: "hybrid-2.5l-awd",
      seating: 5,
      availableExteriorColorCodes: ["040", "1G3", "218", "3U5"],
      availableInteriorColorCodes: ["black-softex"],
      standardFeatures: ["Sport-tuned suspension", "Two-tone exterior", "SofTex-trimmed seats"],
      packages: [],
    },
  ],
  specs: [
    { category: "dimensions", key: "length_in", label: "Overall length", value: 180.9, unit: "in" },
    { category: "dimensions", key: "width_in", label: "Overall width", value: 73.0, unit: "in" },
    { category: "dimensions", key: "height_in", label: "Overall height", value: 67.0, unit: "in" },
    { category: "capability", key: "ground_clearance_in", label: "Ground clearance", value: 8.1, unit: "in" },
    { category: "performance", key: "system_horsepower", label: "Combined system output", value: 219, unit: "hp" },
    { category: "safety", key: "toyota_safety_sense", label: "Toyota Safety Sense", value: "TSS 2.5" },
    { category: "warranty", key: "hybrid_battery_warranty_years_miles", label: "Hybrid battery warranty", value: "10 yr / 150,000 mi" },
  ],
  exteriorColors: [
    { code: "040", name: "Ice Cap", hex: "#f2f2ef", availableGradeIds: ["le", "xse"] },
    { code: "1G3", name: "Magnetic Gray Metallic", hex: "#555a5e", availableGradeIds: ["le", "xse"] },
    { code: "218", name: "Midnight Black Metallic", hex: "#101215", availableGradeIds: ["le", "xse"] },
    { code: "3U5", name: "Ruby Flare Pearl", hex: "#8d1825", availableGradeIds: ["le", "xse"], isPremium: true },
  ],
  interiorColors: [
    { code: "black-fabric", name: "Black fabric", hex: "#1b1b1b", material: "fabric", availableGradeIds: ["le"] },
    { code: "black-softex", name: "Black SofTex", hex: "#151515", material: "softex", availableGradeIds: ["xse"] },
  ],
  media: {
    hero: { url: "/images/vehicles/rav4-hybrid/rav4-hybrid-front-three-quarter.png", alt: "2023 Toyota RAV4 Hybrid front three-quarter 3D render", width: 738, height: 565 },
    gallery: [{ url: "/images/vehicles/rav4-hybrid/rav4-hybrid-front-three-quarter.png", alt: "2023 Toyota RAV4 Hybrid front three-quarter 3D render", width: 738, height: 565 }],
    thumbnails: [{ url: "/images/vehicles/rav4-hybrid/rav4-hybrid-front-three-quarter.png", alt: "2023 Toyota RAV4 Hybrid 3D model thumbnail", width: 738, height: 565 }],
    videos: [],
    environmentMaps: [],
  },
  threeDConfig: {
    hasModel: true,
    modelUrl: "/models/rav4-hybrid-2023/rav4-hybrid.glb",
    // The authored scene is in centimetre-scale glTF coordinates (4.596 cm long); 100x restores metres.
    scale: [100, 100, 100],
    rotation: [0, 0, 0],
    cameraPresets: [
      { id: "hero", label: "Hero", position: [5.4, 2.4, -6.2], target: [0, 0.9, 0] },
      { id: "front", label: "Front", position: [0, 1.7, -7.2], target: [0, 0.85, 0] },
      { id: "side", label: "Side", position: [7.2, 1.7, 0], target: [0, 0.85, 0] },
      { id: "rear", label: "Rear", position: [0, 1.7, 7.2], target: [0, 0.85, 0] },
    ],
    paintableMaterialNames: ["Tdummy_material_0_085"],
    wheelMountNames: [],
    interiorMaterialNames: ["int_Leather"],
    groundingNodeNames: ["Sketchfab_model"],
  },
};

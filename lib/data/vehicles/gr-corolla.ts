import type { Vehicle } from "../../types/vehicle";

/** 2023 GR Corolla catalog entry backed by the shipped authored GLB. */
export const grCorolla: Vehicle = {
  slug: "gr-corolla",
  year: 2023,
  model: "GR Corolla",
  bodyStyle: "hatchback",
  categories: ["hatchback", "sports-car", "performance"],
  availability: "in_production",
  updatedAt: "2023-01-01T00:00:00.000Z",
  pricing: { baseMsrp: 35900, destinationFee: 1095, currency: "USD" },
  powertrains: {
    "g16e-gts": {
      id: "g16e-gts", type: "gas", engine: "1.6L turbocharged inline-3", horsepowerHp: 300,
      torqueLbFt: 273, transmission: "6-speed intelligent manual", drivetrain: "awd",
      fuelEconomy: { unit: "mpg", city: 21, highway: 28, combined: 24 },
    },
    "g16e-gts-morizo": {
      id: "g16e-gts-morizo", type: "gas", engine: "1.6L turbocharged inline-3", horsepowerHp: 300,
      torqueLbFt: 295, transmission: "6-speed intelligent manual", drivetrain: "awd",
      fuelEconomy: { unit: "mpg", city: 21, highway: 28, combined: 24 },
    },
  },
  grades: [
    { id: "core", name: "Core", msrp: 35900, powertrainId: "g16e-gts", seating: 5, availableExteriorColorCodes: ["040", "202", "3U5"], availableInteriorColorCodes: ["black"], standardFeatures: ["GR-FOUR AWD", "18-in wheels", "Toyota Safety Sense 3.0"], packages: [] },
    { id: "circuit", name: "Circuit Edition", msrp: 42900, powertrainId: "g16e-gts", seating: 5, availableExteriorColorCodes: ["040", "1L5", "3U5"], availableInteriorColorCodes: ["black"], standardFeatures: ["Forged carbon-fiber roof", "Vented hood", "Rear spoiler"], packages: [] },
    { id: "morizo", name: "MORIZO Edition", msrp: 49900, powertrainId: "g16e-gts-morizo", seating: 2, availableExteriorColorCodes: ["089", "1L5"], availableInteriorColorCodes: ["black-red"], standardFeatures: ["295 lb-ft torque", "Close-ratio 6-speed manual", "Rear-seat delete"], packages: [] },
  ],
  specs: [
    { category: "performance", key: "horsepower_hp", label: "Horsepower", value: 300, unit: "hp" },
    { category: "performance", key: "zero_to_60_sec", label: "0–60 mph", value: 5.0, unit: "sec" },
    { category: "technology", key: "gr_four", label: "GR-FOUR AWD", value: "60:40 / 50:50 / 30:70 selectable torque split" },
    { category: "safety", key: "toyota_safety_sense", label: "Toyota Safety Sense", value: "TSS 3.0" },
    { category: "warranty", key: "basic_warranty_years_miles", label: "Basic warranty", value: "3 yr / 36,000 mi" },
  ],
  exteriorColors: [
    { code: "040", name: "Ice Cap", hex: "#f2f3f1", availableGradeIds: ["core", "circuit"] },
    { code: "202", name: "Black", hex: "#111214", availableGradeIds: ["core"] },
    { code: "3U5", name: "Supersonic Red", hex: "#a61f2b", availableGradeIds: ["core", "circuit"], isPremium: true },
    { code: "1L5", name: "Heavy Metal", hex: "#62666b", availableGradeIds: ["circuit", "morizo"], isPremium: true },
    { code: "089", name: "Wind Chill Pearl", hex: "#f3f3ef", availableGradeIds: ["morizo"], isPremium: true },
  ],
  interiorColors: [
    { code: "black", name: "Black", hex: "#17181a", material: "fabric", availableGradeIds: ["core", "circuit"] },
    { code: "black-red", name: "Black with red accents", hex: "#241417", material: "suede", availableGradeIds: ["morizo"] },
  ],
  media: {
    hero: { url: "/images/vehicles/gr-corolla/gr-corolla-front-three-quarter.png", alt: "2023 Toyota GR Corolla front three-quarter 3D render", width: 800, height: 500 },
    gallery: [{ url: "/images/vehicles/gr-corolla/gr-corolla-front-three-quarter.png", alt: "2023 Toyota GR Corolla front three-quarter 3D render", width: 800, height: 500 }],
    thumbnails: [{ url: "/images/vehicles/gr-corolla/gr-corolla-front-three-quarter.png", alt: "2023 Toyota GR Corolla 3D model thumbnail", width: 800, height: 500 }],
    videos: [], environmentMaps: [],
  },
  threeDConfig: {
    hasModel: true,
    modelUrl: "/models/gr-corolla-2023/2023_toyota_gr_corolla.glb",
    scale: [0.25, 0.25, 0.25],
    rotation: [0, 0, 0],
    texturePolicy: "factors-only",
    cameraPresets: [
      { id: "hero", label: "Hero", position: [6.8, 2.7, -6.8], target: [0, 1.3, 0] },
      { id: "front", label: "Front", position: [0, 2.0, -8.5], target: [0, 1.2, 0] },
      { id: "side", label: "Side", position: [8.5, 2.0, 0], target: [0, 1.2, 0] },
      { id: "rear", label: "Rear", position: [0, 2.0, 8.5], target: [0, 1.2, 0] },
      { id: "wheels", label: "Wheels", position: [6.2, 1.1, 4.8], target: [0.5, 0.65, 1.4] },
    ],
    paintableMaterialNames: ["paint"],
    wheelMountNames: ["wheel_7", "wheel.001_11", "wheel.002_13", "wheel.003_15"],
    interiorMaterialNames: ["int_2", "material_21"],
    groundingNodeNames: ["root"],
  },
};

import type { Vehicle } from "../../types/vehicle";

/**
 * Representative catalog data for the prototype — approximates the 2023 GR Corolla launch lineup
 * (Core, Circuit Edition, MORIZO Edition). Not sourced from Toyota's live pricing systems, same
 * disclaimer as the rest of the catalog. Asset provenance: docs/GR_COROLLA_PROVENANCE.md.
 */
export const grCorolla: Vehicle = {
  slug: "gr-corolla",
  year: 2023,
  model: "GR Corolla",
  bodyStyle: "hatchback",
  categories: ["hatchback", "performance", "awd", "hot-hatch"],
  availability: "in_production",
  updatedAt: "2023-01-01T00:00:00.000Z",

  pricing: {
    baseMsrp: 35900,
    destinationFee: 1095,
    currency: "USD",
  },

  powertrains: {
    "g16e-gts": {
      id: "g16e-gts",
      type: "gas",
      engine: "1.6L turbocharged 3-cylinder (G16E-GTS)",
      horsepowerHp: 300,
      torqueLbFt: 273,
      transmission: "6-speed intelligent manual",
      drivetrain: "awd",
      fuelEconomy: { unit: "mpg", city: 21, highway: 28, combined: 24 },
    },
    "g16e-gts-morizo": {
      id: "g16e-gts-morizo",
      type: "gas",
      engine: "1.6L turbocharged 3-cylinder (G16E-GTS)",
      horsepowerHp: 300,
      torqueLbFt: 295,
      transmission: "6-speed intelligent manual (close-ratio)",
      drivetrain: "awd",
      fuelEconomy: { unit: "mpg", city: 21, highway: 28, combined: 24 },
    },
  },

  grades: [
    {
      id: "core",
      name: "Core",
      msrp: 35900,
      powertrainId: "g16e-gts",
      seating: 5,
      availableExteriorColorCodes: ["089", "3U5", "202"],
      availableInteriorColorCodes: ["fabric-black"],
      standardFeatures: ["GR-FOUR AWD", "18-in cast alloy wheels", "Triple exhaust"],
      packages: [],
    },
    {
      id: "circuit",
      name: "Circuit Edition",
      msrp: 42900,
      powertrainId: "g16e-gts",
      seating: 5,
      availableExteriorColorCodes: ["089", "3U5", "1K6"],
      availableInteriorColorCodes: ["suede-black-red"],
      standardFeatures: ["Forged carbon-fibre roof", "Front and rear Torsen LSDs", "Bulged hood with vents"],
      packages: [],
    },
    {
      id: "morizo",
      name: "MORIZO Edition",
      msrp: 49900,
      powertrainId: "g16e-gts-morizo",
      seating: 2,
      availableExteriorColorCodes: ["1K6"],
      availableInteriorColorCodes: ["suede-black-red"],
      standardFeatures: ["Rear seats deleted", "Forged BBS wheels", "Michelin Pilot Sport Cup 2 tires"],
      packages: [],
    },
  ],

  specs: [
    { category: "dimensions", key: "length_in", label: "Overall length", value: 172.6, unit: "in" },
    { category: "dimensions", key: "width_in", label: "Overall width", value: 72.8, unit: "in" },
    { category: "performance", key: "zero_to_60_sec", label: "0–60 mph", value: 5.0, unit: "sec" },
    { category: "capability", key: "drivetrain", label: "Drivetrain", value: "GR-FOUR AWD" },
    { category: "safety", key: "toyota_safety_sense", label: "Toyota Safety Sense", value: "TSS 3.0" },
    { category: "technology", key: "touchscreen_in", label: "Touchscreen display", value: 8, unit: "in" },
    { category: "comfort", key: "heated_seats", label: "Heated front seats", value: true },
    { category: "warranty", key: "basic_warranty_years_miles", label: "Basic warranty", value: "3 yr / 36,000 mi" },
  ],

  exteriorColors: [
    { code: "089", name: "Blizzard Pearl", hex: "#eceeee", availableGradeIds: ["core", "circuit"], isPremium: true },
    { code: "3U5", name: "Supersonic Red", hex: "#b3121c", availableGradeIds: ["core", "circuit"] },
    { code: "202", name: "Black", hex: "#0f1012", availableGradeIds: ["core"] },
    { code: "1K6", name: "Heavy Metal", hex: "#4a4e53", availableGradeIds: ["circuit", "morizo"] },
  ],

  interiorColors: [
    { code: "fabric-black", name: "Black fabric", hex: "#18191b", material: "fabric", availableGradeIds: ["core"] },
    { code: "suede-black-red", name: "Black suede / red accents", hex: "#2a1416", material: "suede", availableGradeIds: ["circuit", "morizo"] },
  ],

  media: {
    // Thumbnail rendered from the runtime GLB by scripts/render-thumbnails.ts.
    hero: { url: "/images/vehicles/gr-corolla/gr-corolla-thumbnail.webp", alt: "2023 Toyota GR Corolla, front three-quarter 3D render", width: 800, height: 500 },
    gallery: [{ url: "/images/vehicles/gr-corolla/gr-corolla-thumbnail.webp", alt: "2023 Toyota GR Corolla, front three-quarter 3D render", width: 800, height: 500 }],
    thumbnails: [{ url: "/images/vehicles/gr-corolla/gr-corolla-thumbnail.webp", alt: "2023 Toyota GR Corolla, front three-quarter 3D render", width: 800, height: 500 }],
    videos: [],
    environmentMaps: [],
  },

  threeDConfig: {
    hasModel: true,
    modelUrl: "/models/gr-corolla-2023/gr-corolla.glb",
    // Sketchfab export: ~18.9 units long for a 4.38 m car, authored along X. Scale to metres and
    // yaw 90° so the nose lands on -z like the rest of the catalog (confirmed in the thumbnail).
    scale: [0.231, 0.231, 0.231],
    rotation: [0, Math.PI / 2, 0],
    texturePolicy: "preserve",
    cameraPresets: [
      { id: "hero", label: "Hero", position: [4.8, 1.9, -5.0], target: [0, 0.7, 0] },
      { id: "wheels", label: "Wheels", position: [3.6, 0.8, -2.6], target: [0.8, 0.35, -1.3] },
      { id: "interior", label: "Interior", position: [4.0, 1.8, 0.6], target: [0, 1.0, 0] },
      { id: "front", label: "Front", position: [0, 1.5, -6.5], target: [0, 0.7, 0] },
      { id: "side", label: "Side", position: [6.5, 1.5, 0], target: [0, 0.7, 0] },
      { id: "rear", label: "Rear", position: [0, 1.5, 6.5], target: [0, 0.7, 0] },
    ],
    paintableMaterialNames: ["paint"],
    wheelMountNames: [],
    interiorMaterialNames: ["colored"],
  },
};

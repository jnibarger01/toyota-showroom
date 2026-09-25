import type { Vehicle } from "../../types/vehicle";

/**
 * Representative catalog data for the prototype — approximates the 2025 Corolla sedan lineup (gas
 * and hybrid). Not sourced from Toyota's live pricing systems, same disclaimer as the rest of the
 * catalog.
 *
 * No Corolla GLB is in the repo yet, so like Tacoma this renders through the procedural fallback
 * (`createProceduralVehicle`) and its options target that fallback's shared node names. To light up
 * the real model: drop the asset at `public/models/corolla-2025/corolla.glb`, set `hasModel: true`
 * + `modelUrl`, add a scene map, retarget `lib/data/options/corolla.ts` at the asset's own node and
 * material names, and re-run `npx tsx scripts/render-thumbnails.ts corolla`.
 */
export const corolla: Vehicle = {
  slug: "corolla",
  year: 2025,
  model: "Corolla",
  bodyStyle: "sedan",
  categories: ["sedan", "compact", "hybrid", "electrified"],
  availability: "in_production",
  updatedAt: "2025-01-15T00:00:00.000Z",

  pricing: {
    baseMsrp: 22325,
    destinationFee: 1135,
    currency: "USD",
  },

  powertrains: {
    "i4-2.0l": {
      id: "i4-2.0l",
      type: "gas",
      engine: "2.0L Dynamic Force I4",
      horsepowerHp: 169,
      torqueLbFt: 151,
      transmission: "Dynamic-Shift CVT",
      drivetrain: "fwd",
      fuelEconomy: { unit: "mpg", city: 32, highway: 41, combined: 35 },
    },
    "hybrid-1.8l": {
      id: "hybrid-1.8l",
      type: "hybrid",
      engine: "1.8L I4 hybrid",
      horsepowerHp: 138,
      torqueLbFt: 105,
      transmission: "electronic CVT",
      drivetrain: "fwd",
      fuelEconomy: { unit: "mpg", city: 53, highway: 46, combined: 50 },
    },
    "hybrid-1.8l-awd": {
      id: "hybrid-1.8l-awd",
      type: "hybrid",
      engine: "1.8L I4 hybrid",
      horsepowerHp: 138,
      torqueLbFt: 105,
      transmission: "electronic CVT",
      drivetrain: "awd",
      fuelEconomy: { unit: "mpg", city: 51, highway: 44, combined: 47 },
    },
  },

  grades: [
    {
      id: "le",
      name: "LE",
      msrp: 22325,
      powertrainId: "i4-2.0l",
      seating: 5,
      availableExteriorColorCodes: ["040", "1J9", "1H5", "209", "3U5"],
      availableInteriorColorCodes: ["fa20-black"],
      standardFeatures: ["8-in touchscreen", "Toyota Safety Sense 3.0", "Wireless Apple CarPlay / Android Auto"],
      packages: [],
    },
    {
      id: "hybrid-le",
      name: "Hybrid LE",
      msrp: 23825,
      powertrainId: "hybrid-1.8l",
      seating: 5,
      availableExteriorColorCodes: ["040", "1J9", "1H5", "209", "8X8"],
      availableInteriorColorCodes: ["fa20-black"],
      standardFeatures: ["Hybrid powertrain", "Available AWD", "8-in touchscreen"],
      packages: [],
    },
    {
      id: "se",
      name: "SE",
      msrp: 25165,
      powertrainId: "i4-2.0l",
      seating: 5,
      availableExteriorColorCodes: ["040", "1J9", "1H5", "209", "3U5", "8X8"],
      availableInteriorColorCodes: ["fa20-black"],
      standardFeatures: ["18-in black alloy wheels", "Sport-tuned suspension", "Paddle shifters"],
      packages: [],
    },
    {
      id: "xse",
      name: "XSE",
      msrp: 28960,
      powertrainId: "i4-2.0l",
      seating: 5,
      availableExteriorColorCodes: ["040", "1H5", "209", "3U5", "8X8"],
      availableInteriorColorCodes: ["fa20-black", "sf-black-red"],
      standardFeatures: ["10.5-in touchscreen", "SofTex-trimmed heated seats", "12.3-in digital gauge cluster"],
      packages: [],
    },
  ],

  specs: [
    { category: "dimensions", key: "length_in", label: "Overall length", value: 182.5, unit: "in" },
    { category: "dimensions", key: "trunk_volume_cu_ft", label: "Trunk volume", value: 13.1, unit: "cu ft" },
    { category: "performance", key: "zero_to_60_sec", label: "0–60 mph", value: 8.2, unit: "sec" },
    { category: "safety", key: "toyota_safety_sense", label: "Toyota Safety Sense", value: "TSS 3.0" },
    { category: "technology", key: "touchscreen_in", label: "Touchscreen display", value: 8, unit: "in" },
    { category: "technology", key: "wireless_carplay", label: "Wireless Apple CarPlay", value: true },
    { category: "comfort", key: "heated_seats", label: "Heated front seats", value: false },
    { category: "warranty", key: "basic_warranty_years_miles", label: "Basic warranty", value: "3 yr / 36,000 mi" },
    { category: "warranty", key: "hybrid_battery_warranty_years_miles", label: "Hybrid battery warranty", value: "10 yr / 150,000 mi" },
  ],

  exteriorColors: [
    { code: "040", name: "Super White", hex: "#f2f2ef", availableGradeIds: ["le", "hybrid-le", "se", "xse"] },
    { code: "1J9", name: "Classic Silver Metallic", hex: "#b9bdc2", availableGradeIds: ["le", "hybrid-le", "se"] },
    { code: "1H5", name: "Celestite Gray Metallic", hex: "#6f7780", availableGradeIds: ["le", "hybrid-le", "se", "xse"] },
    { code: "209", name: "Black Sand Pearl", hex: "#15161a", availableGradeIds: ["le", "hybrid-le", "se", "xse"] },
    { code: "3U5", name: "Barcelona Red Metallic", hex: "#9d1d20", availableGradeIds: ["le", "se", "xse"] },
    { code: "8X8", name: "Blueprint", hex: "#1558d6", availableGradeIds: ["hybrid-le", "se", "xse"] },
  ],

  interiorColors: [
    { code: "fa20-black", name: "Black", hex: "#1a1a1a", material: "fabric", availableGradeIds: ["le", "hybrid-le", "se", "xse"] },
    { code: "sf-black-red", name: "Black / Red", hex: "#2a1416", material: "softex", availableGradeIds: ["xse"] },
  ],

  media: {
    // No GLB yet: a "3D model coming soon" card from scripts/render-thumbnails.ts.
    hero: { url: "/images/vehicles/corolla/corolla-thumbnail.webp", alt: "2025 Toyota Corolla — 3D model coming soon", width: 800, height: 500 },
    gallery: [],
    thumbnails: [{ url: "/images/vehicles/corolla/corolla-thumbnail.webp", alt: "2025 Toyota Corolla — 3D model coming soon", width: 800, height: 500 }],
    videos: [],
    environmentMaps: [],
  },

  threeDConfig: {
    hasModel: false,
    // Scaled from Camry's presets for a ~10 in shorter sedan. Non-empty for the same reason as
    // Tacoma's: BuilderApp picks `cameraPresets[0]` as its default view even for the fallback.
    cameraPresets: [
      { id: "hero", label: "Hero", position: [5.0, 1.9, -5.0], target: [0, 0.85, 0] },
      { id: "wheels", label: "Wheels", position: [4.1, 0.95, 3.6], target: [-0.75, 0.5, 1.1] },
      { id: "interior", label: "Interior", position: [4.3, 1.9, 0.8], target: [0, 1.1, 0] },
      { id: "front", label: "Front", position: [0, 1.7, -7.0], target: [0, 0.85, 0] },
      { id: "side", label: "Side", position: [7.0, 1.7, 0], target: [0, 0.85, 0] },
      { id: "rear", label: "Rear", position: [0, 1.7, 7.0], target: [0, 0.85, 0] },
    ],
    paintableMaterialNames: ["body.carmain"],
    wheelMountNames: [],
    interiorMaterialNames: [],
  },
};

import type { Vehicle } from "../../types/vehicle";

/** Representative catalog data for the prototype — approximates the 2025 Camry lineup (hybrid-only). */
export const camry: Vehicle = {
  slug: "camry",
  year: 2025,
  model: "Camry",
  bodyStyle: "sedan",
  categories: ["sedan", "hybrid", "electrified"],
  availability: "in_production",
  updatedAt: "2024-11-01T00:00:00.000Z",

  pricing: {
    baseMsrp: 28400,
    destinationFee: 1095,
    currency: "USD",
  },

  powertrains: {
    "hybrid-2.5l": {
      id: "hybrid-2.5l",
      type: "hybrid",
      engine: "2.5L I4 hybrid",
      horsepowerHp: 225,
      torqueLbFt: 208,
      transmission: "electronic CVT",
      drivetrain: "fwd",
      fuelEconomy: { unit: "mpg", city: 51, highway: 53, combined: 52 },
    },
    "hybrid-2.5l-awd": {
      id: "hybrid-2.5l-awd",
      type: "hybrid",
      engine: "2.5L I4 hybrid",
      horsepowerHp: 232,
      torqueLbFt: 208,
      transmission: "electronic CVT",
      drivetrain: "awd",
      fuelEconomy: { unit: "mpg", city: 44, highway: 47, combined: 46 },
    },
  },

  grades: [
    {
      id: "le",
      name: "LE",
      msrp: 28400,
      powertrainId: "hybrid-2.5l",
      seating: 5,
      availableExteriorColorCodes: ["040", "1G3", "070"],
      availableInteriorColorCodes: ["fa20-black"],
      standardFeatures: ["8-in touchscreen", "Toyota Safety Sense 3.0", "Standard hybrid powertrain"],
      packages: [],
    },
    {
      id: "xle",
      name: "XLE",
      msrp: 31900,
      powertrainId: "hybrid-2.5l-awd",
      seating: 5,
      availableExteriorColorCodes: ["040", "1G3", "070", "3U5"],
      availableInteriorColorCodes: ["fa20-black", "lf10-macadamia"],
      standardFeatures: ["Heated front seats", "Wireless charging", "AWD available"],
      packages: [],
    },
    {
      id: "xse",
      name: "XSE",
      msrp: 33900,
      powertrainId: "hybrid-2.5l-awd",
      seating: 5,
      availableExteriorColorCodes: ["070", "1G3", "3U5"],
      availableInteriorColorCodes: ["fa20-black"],
      standardFeatures: ["Sport-tuned suspension", "19-in wheels", "Paddle shifters"],
      packages: [],
    },
  ],

  specs: [
    { category: "dimensions", key: "length_in", label: "Overall length", value: 193.0, unit: "in" },
    { category: "dimensions", key: "trunk_volume_cu_ft", label: "Trunk volume", value: 15.1, unit: "cu ft" },
    { category: "performance", key: "zero_to_60_sec", label: "0–60 mph", value: 7.4, unit: "sec" },
    { category: "safety", key: "toyota_safety_sense", label: "Toyota Safety Sense", value: "TSS 3.0" },
    { category: "technology", key: "touchscreen_in", label: "Touchscreen display", value: 8, unit: "in" },
    { category: "technology", key: "wireless_carplay", label: "Wireless Apple CarPlay", value: true },
    { category: "comfort", key: "heated_seats", label: "Heated front seats", value: true },
    { category: "warranty", key: "basic_warranty_years_miles", label: "Basic warranty", value: "3 yr / 36,000 mi" },
    { category: "warranty", key: "hybrid_battery_warranty_years_miles", label: "Hybrid battery warranty", value: "10 yr / 150,000 mi" },
  ],

  exteriorColors: [
    { code: "040", name: "Super White", hex: "#f2f2ef", availableGradeIds: ["le", "xle"] },
    { code: "1G3", name: "Underground", hex: "#4f545a", availableGradeIds: ["le", "xle", "xse"] },
    { code: "070", name: "Midnight Black Metallic", hex: "#101215", availableGradeIds: ["le", "xle", "xse"] },
    { code: "3U5", name: "Barcelona Red Metallic", hex: "#9d1d20", availableGradeIds: ["xle", "xse"] },
  ],

  interiorColors: [
    { code: "fa20-black", name: "Black", hex: "#1a1a1a", material: "fabric", availableGradeIds: ["le", "xle", "xse"] },
    { code: "lf10-macadamia", name: "Macadamia", hex: "#a9885f", material: "leather", availableGradeIds: ["xle"] },
  ],

  media: {
    hero: { url: "/images/modsnation_7416_final_hero_tweaked.png", alt: "2025 Toyota Camry XSE placeholder hero" },
    gallery: [],
    thumbnails: [{ url: "/images/modsnation_7416_final_hero_tweaked.png", alt: "2025 Toyota Camry thumbnail" }],
    videos: [],
    environmentMaps: [],
  },

  threeDConfig: {
    hasModel: false,
    // See the identical note in lib/data/vehicles/tacoma.ts: an empty array here left BuilderApp
    // stuck on its loading screen the moment /camry became a reachable route.
    cameraPresets: [
      { id: "hero", label: "Hero", position: [7.5, 4.0, 8.5], target: [0, 1.1, 0] },
      { id: "front", label: "Front", position: [0, 2.2, -10], target: [0, 1.0, 0] },
      { id: "side", label: "Side", position: [10, 2.2, 0], target: [0, 1.0, 0] },
      { id: "rear", label: "Rear", position: [0, 2.2, 10], target: [0, 1.0, 0] },
    ],
    paintableMaterialNames: ["body.carmain"],
    wheelMountNames: [],
    interiorMaterialNames: [],
  },
};

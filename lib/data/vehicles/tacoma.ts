import type { Vehicle } from "../../types/vehicle";

/** Representative catalog data for the prototype — approximates the 2024 Tacoma lineup. */
export const tacoma: Vehicle = {
  slug: "tacoma",
  year: 2024,
  model: "Tacoma",
  bodyStyle: "truck",
  categories: ["truck", "off-road", "midsize"],
  availability: "in_production",
  updatedAt: "2024-11-01T00:00:00.000Z",

  pricing: {
    baseMsrp: 31500,
    destinationFee: 1450,
    currency: "USD",
  },

  powertrains: {
    "i4-2.4l-turbo": {
      id: "i4-2.4l-turbo",
      type: "gas",
      engine: "2.4L Turbo I4",
      horsepowerHp: 228,
      torqueLbFt: 243,
      transmission: "8-speed automatic",
      drivetrain: "4wd",
      fuelEconomy: { unit: "mpg", city: 20, highway: 24, combined: 22 },
      towingCapacityLbs: 6500,
      payloadCapacityLbs: 1709,
    },
    "i-force-max-hybrid": {
      id: "i-force-max-hybrid",
      type: "hybrid",
      engine: "2.4L Turbo I4 + electric motor (i-FORCE MAX)",
      horsepowerHp: 326,
      torqueLbFt: 465,
      transmission: "8-speed automatic",
      drivetrain: "4wd",
      fuelEconomy: { unit: "mpg", city: 22, highway: 24, combined: 23 },
      towingCapacityLbs: 6000,
      payloadCapacityLbs: 1560,
    },
  },

  grades: [
    {
      id: "sr",
      name: "SR",
      msrp: 31500,
      powertrainId: "i4-2.4l-turbo",
      seating: 5,
      availableExteriorColorCodes: ["040", "218", "1J9"],
      availableInteriorColorCodes: ["fa20-black"],
      standardFeatures: ["8-in touchscreen", "Toyota Safety Sense 3.0"],
      packages: [],
    },
    {
      id: "trd-off-road",
      name: "TRD Off-Road",
      msrp: 38560,
      powertrainId: "i4-2.4l-turbo",
      seating: 5,
      availableExteriorColorCodes: ["040", "218", "1J9", "3U5"],
      availableInteriorColorCodes: ["fa20-black"],
      standardFeatures: ["Crawl Control", "Multi-Terrain Select", "TRD-tuned suspension"],
      packages: [],
    },
    {
      id: "trd-pro",
      name: "TRD Pro",
      msrp: 55765,
      powertrainId: "i-force-max-hybrid",
      seating: 5,
      availableExteriorColorCodes: ["1J9", "218", "0R2"],
      availableInteriorColorCodes: ["fa20-black"],
      standardFeatures: ["FOX live valve shocks", "TRD front skid plate", "i-FORCE MAX hybrid powertrain"],
      packages: [],
    },
  ],

  specs: [
    { category: "dimensions", key: "length_in", label: "Overall length", value: 212.7, unit: "in" },
    { category: "dimensions", key: "bed_length_in", label: "Bed length", value: 60.5, unit: "in" },
    { category: "capability", key: "ground_clearance_in", label: "Ground clearance", value: 9.7, unit: "in" },
    { category: "capability", key: "max_towing_lbs", label: "Max towing", value: 6500, unit: "lbs" },
    { category: "performance", key: "zero_to_60_sec", label: "0–60 mph", value: 6.3, unit: "sec" },
    { category: "safety", key: "toyota_safety_sense", label: "Toyota Safety Sense", value: "TSS 3.0" },
    { category: "technology", key: "touchscreen_in", label: "Touchscreen display", value: 8, unit: "in" },
    { category: "comfort", key: "heated_seats", label: "Heated front seats", value: true },
    { category: "warranty", key: "basic_warranty_years_miles", label: "Basic warranty", value: "3 yr / 36,000 mi" },
  ],

  exteriorColors: [
    { code: "040", name: "Super White", hex: "#f2f2ef", availableGradeIds: ["sr", "trd-off-road"] },
    { code: "218", name: "Blueprint", hex: "#1558d6", availableGradeIds: ["sr", "trd-off-road", "trd-pro"] },
    { code: "1J9", name: "Ice Cap", hex: "#d8dde2", availableGradeIds: ["sr", "trd-off-road", "trd-pro"] },
    { code: "3U5", name: "Barcelona Red Metallic", hex: "#9d1d20", availableGradeIds: ["trd-off-road"] },
    { code: "0R2", name: "Solar Octane", hex: "#ff6a1a", availableGradeIds: ["trd-pro"], isPremium: true },
  ],

  interiorColors: [
    { code: "fa20-black", name: "Black", hex: "#1a1a1a", material: "fabric", availableGradeIds: ["sr", "trd-off-road", "trd-pro"] },
  ],

  media: {
    hero: { url: "/images/modsnation_7416_final_hero_tweaked.png", alt: "2024 Toyota Tacoma TRD Pro placeholder hero" },
    gallery: [],
    thumbnails: [{ url: "/images/modsnation_7416_final_hero_tweaked.png", alt: "2024 Toyota Tacoma thumbnail" }],
    videos: [],
    environmentMaps: [],
  },

  threeDConfig: {
    hasModel: false,
    // Non-empty even without a real model: BuilderApp's bootstrap picks `cameraPresets[0]` as the
    // default view, and an empty array left it permanently stuck on the loading screen the moment
    // this vehicle became reachable at all (app/[slug]/page.tsx) — the procedural fallback vehicle
    // (lib/three/proceduralParts.ts) still needs *somewhere* to point the camera at.
    cameraPresets: [
      { id: "hero", label: "Hero", position: [7.5, 4.0, 8.5], target: [0, 1.1, 0] },
      { id: "front", label: "Front", position: [0, 2.2, -10], target: [0, 1.0, 0] },
      { id: "side", label: "Side", position: [10, 2.2, 0], target: [0, 1.0, 0] },
      { id: "rear", label: "Rear", position: [0, 2.2, 10], target: [0, 1.0, 0] },
    ],
    paintableMaterialNames: ["body.carmain"],
    wheelMountNames: [],
    wheelVariants: [],
    interiorMaterialNames: [],
  },
};

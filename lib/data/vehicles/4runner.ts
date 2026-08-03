import type { Vehicle } from "../../types/vehicle";

/**
 * Representative catalog data for the prototype — MSRP, feature lists, and specs
 * approximate publicly known 2024 4Runner trims and are not sourced from Toyota's
 * live pricing systems.
 */
export const fourRunner: Vehicle = {
  slug: "4runner",
  year: 2024,
  model: "4Runner",
  bodyStyle: "suv",
  categories: ["suv", "off-road", "truck-based"],
  availability: "in_production",
  updatedAt: "2024-11-01T00:00:00.000Z",

  pricing: {
    baseMsrp: 40455,
    destinationFee: 1450,
    currency: "USD",
  },

  powertrains: {
    "v6-4.0l": {
      id: "v6-4.0l",
      type: "gas",
      engine: "4.0L V6",
      horsepowerHp: 270,
      torqueLbFt: 278,
      transmission: "5-speed automatic",
      drivetrain: "4wd",
      fuelEconomy: { unit: "mpg", city: 16, highway: 19, combined: 17 },
      towingCapacityLbs: 5000,
      payloadCapacityLbs: 1200,
    },
  },

  grades: [
    {
      id: "sr5",
      name: "SR5",
      msrp: 40455,
      powertrainId: "v6-4.0l",
      seating: 5,
      availableExteriorColorCodes: ["218", "070", "1J9", "1G3", "3U5"],
      availableInteriorColorCodes: ["fa20-black"],
      standardFeatures: ["Multi-Terrain Select", "8-in touchscreen", "LED headlights"],
      packages: [],
    },
    {
      id: "trd-off-road",
      name: "TRD Off-Road",
      msrp: 43955,
      powertrainId: "v6-4.0l",
      seating: 5,
      availableExteriorColorCodes: ["218", "070", "1J9", "1G3", "3U5"],
      availableInteriorColorCodes: ["fa20-black"],
      standardFeatures: ["Crawl Control", "Locking rear differential", "TRD-tuned suspension"],
      packages: [
        { id: "premium-pkg", name: "Premium Package", price: 3520, includes: ["Leather-trimmed seats", "Sunroof"] },
      ],
    },
    {
      id: "trd-pro",
      name: "TRD Pro",
      msrp: 53900,
      powertrainId: "v6-4.0l",
      seating: 5,
      availableExteriorColorCodes: ["1J9", "218", "0R2"],
      availableInteriorColorCodes: ["fa20-black"],
      standardFeatures: ["FOX internal-bypass shocks", "TRD front skid plate", "Roof rack"],
      packages: [],
    },
    {
      id: "limited",
      name: "Limited",
      msrp: 50260,
      powertrainId: "v6-4.0l",
      seating: 5,
      availableExteriorColorCodes: ["218", "070", "1G3", "3U5"],
      availableInteriorColorCodes: ["fa20-black", "lf10-red"],
      standardFeatures: ["JBL premium audio", "Heated/ventilated front seats", "Adaptive variable suspension"],
      packages: [],
    },
  ],

  specs: [
    { category: "dimensions", key: "length_in", label: "Overall length", value: 191.3, unit: "in" },
    { category: "dimensions", key: "width_in", label: "Overall width", value: 75.8, unit: "in" },
    { category: "dimensions", key: "height_in", label: "Overall height", value: 71.5, unit: "in" },
    { category: "dimensions", key: "cargo_volume_cu_ft", label: "Cargo volume behind 2nd row", value: 46.3, unit: "cu ft" },
    { category: "capability", key: "ground_clearance_in", label: "Ground clearance", value: 9.6, unit: "in" },
    { category: "capability", key: "approach_angle_deg", label: "Approach angle", value: 33, unit: "deg" },
    { category: "capability", key: "departure_angle_deg", label: "Departure angle", value: 26, unit: "deg" },
    { category: "performance", key: "zero_to_60_sec", label: "0–60 mph", value: 6.9, unit: "sec" },
    { category: "safety", key: "toyota_safety_sense", label: "Toyota Safety Sense", value: "TSS 2.5" },
    { category: "safety", key: "blind_spot_monitor", label: "Blind Spot Monitor", value: true },
    { category: "technology", key: "touchscreen_in", label: "Touchscreen display", value: 8, unit: "in" },
    { category: "technology", key: "wireless_carplay", label: "Wireless Apple CarPlay", value: true },
    { category: "comfort", key: "heated_seats", label: "Heated front seats", value: true },
    { category: "warranty", key: "basic_warranty_years_miles", label: "Basic warranty", value: "3 yr / 36,000 mi" },
    { category: "warranty", key: "powertrain_warranty_years_miles", label: "Powertrain warranty", value: "5 yr / 60,000 mi" },
  ],

  exteriorColors: [
    { code: "218", name: "Blueprint", hex: "#1558d6", availableGradeIds: ["sr5", "trd-off-road", "trd-pro", "limited"] },
    { code: "070", name: "Midnight Black Metallic", hex: "#101215", availableGradeIds: ["sr5", "trd-off-road", "limited"] },
    { code: "1J9", name: "Ice Cap", hex: "#d8dde2", availableGradeIds: ["sr5", "trd-off-road", "trd-pro"] },
    { code: "1G3", name: "Underground", hex: "#4f545a", availableGradeIds: ["sr5", "trd-off-road", "limited"], isPremium: true },
    { code: "3U5", name: "Barcelona Red Metallic", hex: "#9d1d20", availableGradeIds: ["sr5", "trd-off-road", "limited"] },
    { code: "0R2", name: "Solar Octane", hex: "#ff6a1a", availableGradeIds: ["trd-pro"], isPremium: true },
  ],

  interiorColors: [
    { code: "fa20-black", name: "Black", hex: "#1a1a1a", material: "softex", availableGradeIds: ["sr5", "trd-off-road", "trd-pro", "limited"] },
    { code: "lf10-red", name: "Red Leather", hex: "#4a1113", material: "leather", availableGradeIds: ["limited"] },
  ],

  media: {
    hero: { url: "/images/modsnation_7416_final_hero_tweaked.png", alt: "2024 Toyota 4Runner TRD Pro, front three-quarter view" },
    gallery: [
      { url: "/images/modsnation_7416_final_hero_tweaked.png", alt: "2024 Toyota 4Runner TRD Pro, front three-quarter view" },
    ],
    thumbnails: [
      { url: "/images/modsnation_7416_final_hero_tweaked.png", alt: "2024 Toyota 4Runner thumbnail" },
    ],
    videos: [],
    environmentMaps: [],
  },

  threeDConfig: {
    hasModel: true,
    modelUrl: "/models/modsnation_7416_assets_assembled.glb",
    cameraPresets: [
      { id: "hero", label: "Hero", position: [7.5, 4.0, 8.5], target: [0, 1.1, 0] },
      { id: "front", label: "Front", position: [0, 2.2, -10], target: [0, 1.0, 0] },
      { id: "side", label: "Side", position: [10, 2.2, 0], target: [0, 1.0, 0] },
      { id: "rear", label: "Rear", position: [0, 2.2, 10], target: [0, 1.0, 0] },
    ],
    paintableMaterialNames: ["body.carmain"],
    wheelMountNames: [
      "MOUNT_WHEEL_FRONT_LEFT",
      "MOUNT_WHEEL_FRONT_RIGHT",
      "MOUNT_WHEEL_REAR_LEFT",
      "MOUNT_WHEEL_REAR_RIGHT",
    ],
    wheelVariants: [
      { id: "stock", label: "Stock", scale: 0.9 },
      { id: "trail", label: "Trail", scale: 1 },
      { id: "beadlock", label: "Beadlock", scale: 1.08 },
    ],
    interiorMaterialNames: [],
  },
};

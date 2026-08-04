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
    // Replace the assembled model's baked-in running gear with the supplied authored glTFs.
    // The node names deliberately match the configuration catalog, so wheel-finish and tyre-sidewall
    // controls continue to target the newly mounted meshes.
    wheelAndTireAssets: {
      wheelUrl: "/models/4runner-2024/ModsNation_7416_wheel_a.gltf",
      tireUrl: "/models/4runner-2024/ModsNation_7416_tire.gltf",
      // The standalone source assets are 0.553 units across, while the vehicle uses metre-scale
      // dimensions. This yields an approximately 0.80 m (31.5 in) outside tyre diameter.
      scale: 1.45,
      wheelNodeNames: [
        "PLACED_WEISU_front_left",
        "PLACED_WEISU_front_right",
        "PLACED_WEISU_rear_left",
        "PLACED_WEISU_rear_right",
      ],
      tireNodeNames: [
        "PLACED_KO3_front_left",
        "PLACED_KO3_front_right",
        "PLACED_KO3_rear_left",
        "PLACED_KO3_rear_right",
      ],
    },
    // Forward-declared, matching the naming contract (docs/INTEGRATION_GUIDE.md §3): the current
    // GLB is exterior-only (body, wheels, lights, exhaust, grille) with no seat/dash geometry, so
    // "interior.seat" names an expected future material, not one that exists yet — the interior
    // options in lib/data/options/4runner.ts are correspondingly gated, same as hood/decal.
    interiorMaterialNames: ["interior.seat"],

    // Donor geometry retained by the Blender export, all sitting at the world origin: two WEISU
    // wheels, one KO2 tyre, two brake assemblies, and a 2 m paint-swatch sphere ("Jet Black").
    // The four PLACED_AOOA_caliper_* nodes are also at the origin rather than at their wheels —
    // an authoring defect noted in docs/INTEGRATION_GUIDE.md §3; they contribute nothing visible
    // from outside the body and are hidden here until the source file is corrected.
    hiddenNodeNames: [
      "322-1790(MD010)",
      "322-1790(MD010).001",
      "BFGoodrich_ALL_Terrain_TA_KO2",
      "FRONT_BRAKES",
      "REAR_BRAKES",
      "Jet Black",
      "PLACED_AOOA_caliper_front_left",
      "PLACED_AOOA_caliper_front_right",
      "PLACED_AOOA_caliper_rear_left",
      "PLACED_AOOA_caliper_rear_right",
    ],

    // Body plus the four positioned tyres. Grounding on these puts the tyres on the floor; taking
    // the box over the whole scene instead includes the origin sphere (which reaches y = -1) and
    // lifts the vehicle about 1.1 units into the air.
    groundingNodeNames: [
      "BODY",
      "PLACED_KO3_front_left",
      "PLACED_KO3_front_right",
      "PLACED_KO3_rear_left",
      "PLACED_KO3_rear_right",
    ],
  },
};

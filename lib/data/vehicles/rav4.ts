import type { Vehicle } from "../../types/vehicle";

/**
 * Representative catalog data for the prototype — 2024 RAV4 Limited trim/spec figures approximate
 * publicly known values and are not sourced from Toyota's live pricing systems, same disclaimer as
 * every other vehicle in this catalog.
 *
 * The 3D asset (`public/models/rav4-2024/rav4_2024_limited_decoded.glb`, repackaged from the
 * vendor's decoded `.gltf`+`.bin` capture by `scripts/optimize-models.mjs` — same Draco compression,
 * single-file container) is a **body-shell-only** capture — see `threeDConfig`'s own comment and
 * `docs/RAV4_PROVENANCE.md` for the full asset history. Wheels, an interior, doors, mirrors, and a
 * front badge have no separate geometry in this
 * capture at all (verified directly against the file, not assumed) — `lib/data/sceneMap/rav4.ts`
 * declares them as forward-declared/unsatisfied rather than guessing at node names, the same
 * pattern `lib/data/sceneMap/4runner.ts` already uses for the same categories. There is
 * consequently no wheel- or interior-customization catalog for this vehicle yet
 * (`lib/data/options/rav4.ts`) — only what the real geometry actually supports: exterior paint and
 * chrome-trim finish.
 */
export const rav4: Vehicle = {
  slug: "rav4",
  year: 2024,
  model: "RAV4",
  bodyStyle: "crossover",
  categories: ["crossover", "suv", "compact"],
  availability: "in_production",
  updatedAt: "2026-08-03T19:16:18.891Z",

  pricing: {
    baseMsrp: 29250,
    destinationFee: 1450,
    currency: "USD",
  },

  powertrains: {
    "2.5l-dynamic-force": {
      id: "2.5l-dynamic-force",
      type: "gas",
      engine: "2.5L Dynamic Force I4",
      horsepowerHp: 203,
      torqueLbFt: 184,
      transmission: "8-speed automatic",
      drivetrain: "awd",
      fuelEconomy: { unit: "mpg", city: 27, highway: 35, combined: 30 },
      towingCapacityLbs: 1500,
    },
  },

  grades: [
    {
      id: "le",
      name: "LE",
      msrp: 29250,
      powertrainId: "2.5l-dynamic-force",
      seating: 5,
      availableExteriorColorCodes: ["040", "1G3", "218", "3U5"],
      availableInteriorColorCodes: ["fa20-black"],
      standardFeatures: ["Toyota Safety Sense 3.0", "7-in touchscreen", "AWD"],
      packages: [],
    },
    {
      id: "xle",
      name: "XLE",
      msrp: 31300,
      powertrainId: "2.5l-dynamic-force",
      seating: 5,
      availableExteriorColorCodes: ["040", "1G3", "218", "3U5", "0R2"],
      availableInteriorColorCodes: ["fa20-black"],
      standardFeatures: ["Blind Spot Monitor", "Heated front seats", "Power liftgate"],
      packages: [],
    },
    {
      id: "limited",
      name: "Limited",
      msrp: 36150,
      powertrainId: "2.5l-dynamic-force",
      seating: 5,
      availableExteriorColorCodes: ["040", "1G3", "218", "3U5", "0R2"],
      availableInteriorColorCodes: ["fa20-black", "lf10-red"],
      standardFeatures: ["JBL premium audio", "Ventilated front seats", "Digital rearview mirror"],
      packages: [],
    },
  ],

  specs: [
    { category: "dimensions", key: "length_in", label: "Overall length", value: 180.9, unit: "in" },
    { category: "dimensions", key: "width_in", label: "Overall width", value: 73.0, unit: "in" },
    { category: "dimensions", key: "height_in", label: "Overall height", value: 67.0, unit: "in" },
    { category: "dimensions", key: "cargo_volume_cu_ft", label: "Cargo volume behind 2nd row", value: 37.6, unit: "cu ft" },
    { category: "capability", key: "ground_clearance_in", label: "Ground clearance", value: 8.4, unit: "in" },
    { category: "performance", key: "zero_to_60_sec", label: "0–60 mph", value: 8.0, unit: "sec" },
    { category: "safety", key: "toyota_safety_sense", label: "Toyota Safety Sense", value: "TSS 3.0" },
    { category: "safety", key: "blind_spot_monitor", label: "Blind Spot Monitor", value: true },
    { category: "technology", key: "touchscreen_in", label: "Touchscreen display", value: 8, unit: "in" },
    { category: "technology", key: "wireless_carplay", label: "Wireless Apple CarPlay", value: true },
    { category: "warranty", key: "basic_warranty_years_miles", label: "Basic warranty", value: "3 yr / 36,000 mi" },
    { category: "warranty", key: "powertrain_warranty_years_miles", label: "Powertrain warranty", value: "5 yr / 60,000 mi" },
  ],

  exteriorColors: [
    { code: "040", name: "Super White", hex: "#f2f2ef", availableGradeIds: ["le", "xle", "limited"] },
    { code: "1G3", name: "Underground", hex: "#4f545a", availableGradeIds: ["le", "xle", "limited"], isPremium: true },
    { code: "218", name: "Blueprint", hex: "#1558d6", availableGradeIds: ["le", "xle", "limited"] },
    { code: "3U5", name: "Barcelona Red Metallic", hex: "#9d1d20", availableGradeIds: ["le", "xle", "limited"] },
    { code: "0R2", name: "Solar Octane", hex: "#ff6a1a", availableGradeIds: ["xle", "limited"], isPremium: true },
  ],

  interiorColors: [
    { code: "fa20-black", name: "Black", hex: "#1a1a1a", material: "fabric", availableGradeIds: ["le", "xle", "limited"] },
    { code: "lf10-red", name: "Red", hex: "#4a1113", material: "leather", availableGradeIds: ["limited"] },
  ],

  media: {
    // No dedicated RAV4 studio photography exists in this repo yet; the capture pipeline's own
    // rendered viewport frame is the only real image of this specific asset (docs/RAV4_PROVENANCE.md).
    hero: { url: "/renders/rav4-2024/rendered-rav4-viewport.png", alt: "2024 Toyota RAV4 Limited, captured viewport render" },
    gallery: [{ url: "/renders/rav4-2024/rendered-rav4-viewport.png", alt: "2024 Toyota RAV4 Limited, captured viewport render" }],
    thumbnails: [{ url: "/renders/rav4-2024/rendered-rav4-viewport.png", alt: "2024 Toyota RAV4 thumbnail" }],
    videos: [],
    environmentMaps: [],
  },

  threeDConfig: {
    hasModel: true,
    modelUrl: "/models/rav4-2024/rav4_2024_limited_decoded.glb",
    // Real bounding box of the decoded BODY mesh (computed directly, not estimated): x ±1.097,
    // y 0.207–1.820, z ±2.474 (a ~4.95 x 2.19 x 1.61 m body shell). Scaled from the 4Runner's own
    // presets, which frame a similarly-sized body — not visually verified in a browser (no GPU in
    // this environment); a manual framing pass is a documented follow-up, same caveat
    // lib/data/vehicles/ae86.ts already carries for the same reason.
    cameraPresets: [
      { id: "hero", label: "Hero", position: [7.0, 3.5, 8.0], target: [0, 0.85, 0] },
      { id: "wheels", label: "Wheels", position: [4.2, 1.0, 4.6], target: [-0.85, 0.45, 1.25] },
      { id: "interior", label: "Interior", position: [4.8, 2.1, 1.0], target: [0, 1.0, 0] },
      { id: "front", label: "Front", position: [0, 2.0, -9.5], target: [0, 0.8, 0] },
      { id: "side", label: "Side", position: [9.5, 2.0, 0], target: [0, 0.8, 0] },
      { id: "rear", label: "Rear", position: [0, 2.0, 9.5], target: [0, 0.8, 0] },
    ],
    paintableMaterialNames: ["body.carmain"],
    // Real, empty MOUNT_WHEEL_* transform nodes exist (verified: same rig convention as the
    // 4Runner's), but no wheel/tyre mesh is mounted at them — this capture has no wheel geometry of
    // its own, and there is no authored RAV4-specific wheel/tyre asset to attach yet (unlike the
    // 4Runner, whose wheelAndTireAssets were added as a separate, subsequent delivery — see
    // docs/INTEGRATION_GUIDE.md §1). Listed anyway: the mount points are real and a future wheel
    // asset delivery can target them with no data-model change.
    wheelMountNames: [
      "MOUNT_WHEEL_FRONT_LEFT",
      "MOUNT_WHEEL_FRONT_RIGHT",
      "MOUNT_WHEEL_REAR_LEFT",
      "MOUNT_WHEEL_REAR_RIGHT",
    ],
    interiorMaterialNames: [],
    // No donor/stray geometry — this is a clean, single-mesh body shell capture (docs/
    // RAV4_PROVENANCE.md). Grounding on BODY alone is correct: unlike the 4Runner's historical donor
    // sphere defect, nothing here reaches further than the real body silhouette.
    groundingNodeNames: ["BODY"],
  },
};

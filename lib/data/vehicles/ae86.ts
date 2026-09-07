import type { Vehicle } from "../../types/vehicle";

/**
 * Representative catalog data for the prototype — historical Corolla GT-S/SR5 (AE86, 1985) specs
 * approximate the real US-market federalized trims and are not sourced from Toyota's live pricing
 * systems, same disclaimer as the other vehicles in this catalog.
 *
 * Unlike 4Runner/Tacoma/Camry, this generation predates modern active-safety and infotainment
 * features entirely, so the `safety`/`technology`/`warranty` spec categories reflect that rather
 * than being padded out to match the other vehicles' shape.
 */
export const ae86: Vehicle = {
  slug: "ae86",
  year: 1985,
  model: "Corolla GT-S (AE86)",
  bodyStyle: "hatchback",
  categories: ["coupe", "classic", "jdm", "rwd"],
  availability: "discontinued",
  updatedAt: "2024-11-01T00:00:00.000Z",

  pricing: {
    baseMsrp: 9858,
    destinationFee: 250,
    currency: "USD",
  },

  powertrains: {
    "4a-c-1.6l": {
      id: "4a-c-1.6l",
      type: "gas",
      engine: "1.6L SOHC I4 (4A-C)",
      horsepowerHp: 74,
      torqueLbFt: 88,
      transmission: "5-speed manual",
      drivetrain: "rwd",
      fuelEconomy: { unit: "mpg", city: 25, highway: 33, combined: 28 },
    },
    "4a-ge-1.6l": {
      id: "4a-ge-1.6l",
      type: "gas",
      engine: "1.6L DOHC 16-valve I4 (4A-GE)",
      horsepowerHp: 112,
      torqueLbFt: 97,
      transmission: "5-speed manual",
      drivetrain: "rwd",
      fuelEconomy: { unit: "mpg", city: 23, highway: 30, combined: 26 },
    },
  },

  grades: [
    {
      id: "sr5",
      name: "SR5",
      msrp: 9858,
      powertrainId: "4a-c-1.6l",
      seating: 4,
      availableExteriorColorCodes: ["040", "202"],
      availableInteriorColorCodes: ["black-vinyl"],
      standardFeatures: ["5-speed manual", "AM/FM cassette stereo", "Rear-wheel drive"],
      packages: [],
    },
    {
      id: "gt-s",
      name: "GT-S",
      msrp: 11498,
      powertrainId: "4a-ge-1.6l",
      seating: 4,
      availableExteriorColorCodes: ["040", "202", "3P0"],
      availableInteriorColorCodes: ["black-vinyl"],
      standardFeatures: ["4A-GE DOHC engine", "Sport-tuned suspension", "Limited-slip differential"],
      packages: [],
    },
  ],

  specs: [
    { category: "dimensions", key: "length_in", label: "Overall length", value: 172.0, unit: "in" },
    { category: "dimensions", key: "width_in", label: "Overall width", value: 65.4, unit: "in" },
    { category: "dimensions", key: "height_in", label: "Overall height", value: 50.8, unit: "in" },
    { category: "dimensions", key: "curb_weight_lbs", label: "Curb weight", value: 2270, unit: "lbs" },
    { category: "performance", key: "zero_to_60_sec", label: "0–60 mph", value: 8.5, unit: "sec" },
    { category: "safety", key: "driver_assist_suite", label: "Driver assist systems", value: "None (predates active safety systems)" },
    { category: "technology", key: "am_fm_cassette", label: "Factory AM/FM cassette stereo", value: true },
    { category: "comfort", key: "manual_windows", label: "Manual windows and locks", value: true },
  ],

  exteriorColors: [
    { code: "040", name: "Super White", hex: "#f2f2ef", availableGradeIds: ["sr5", "gt-s"] },
    { code: "202", name: "Black", hex: "#101215", availableGradeIds: ["sr5", "gt-s"] },
    { code: "3P0", name: "Classic Red", hex: "#b3141c", availableGradeIds: ["gt-s"], isPremium: true },
  ],

  interiorColors: [
    { code: "black-vinyl", name: "Black", hex: "#1a1a1a", material: "fabric", availableGradeIds: ["sr5", "gt-s"] },
  ],

  media: {
    // No dedicated AE86 photography exists in this repo; reusing the shared placeholder image, same
    // convention lib/data/vehicles/tacoma.ts and camry.ts already use for vehicles without one.
    hero: { url: "/images/modsnation_7416_final_hero_tweaked.png", alt: "2024 Toyota 4Runner TRD Pro placeholder hero (no AE86 photography available)" },
    gallery: [],
    thumbnails: [{ url: "/images/modsnation_7416_final_hero_tweaked.png", alt: "Toyota AE86 thumbnail placeholder" }],
    videos: [],
    environmentMaps: [],
  },

  threeDConfig: {
    hasModel: true,
    modelUrl: "/models/toyota-ae86-ivofficial.glb",
    // Distances scaled down from the 4Runner's presets for a car roughly two-thirds the length and
    // notably lower — not visually verified in a browser (no GPU available in this environment); a
    // manual pass to fine-tune framing is a documented follow-up.
    cameraPresets: [
      { id: "hero", label: "Hero", position: [5.0, 2.2, 5.5], target: [0, 0.55, 0] },
      { id: "wheels", label: "Wheels", position: [3.0, 0.65, 3.1], target: [-0.55, 0.35, 0.85] },
      { id: "interior", label: "Interior", position: [3.6, 1.35, 0.7], target: [0, 0.75, 0] },
      { id: "front", label: "Front", position: [0, 1.4, -6.5], target: [0, 0.5, 0] },
      { id: "side", label: "Side", position: [6.5, 1.4, 0], target: [0, 0.5, 0] },
      { id: "rear", label: "Rear", position: [0, 1.4, 6.5], target: [0, 0.5, 0] },
    ],
    paintableMaterialNames: ["Body"],
    // No MOUNT_* nodes in this asset (see lib/data/options/ae86.ts's header comment) — wheels are
    // already placed, like the 4Runner's PLACED_* nodes, with no swap capability.
    wheelMountNames: [],
    interiorMaterialNames: [],
    // The asset has no donor/stray geometry (unlike the 4Runner's fixed-at-source defects) — only 7
    // real nodes total. groundingNodeNames is still given explicitly, excluding the non-mesh `Camera`
    // and `RootNode`, following the precedent docs/INTEGRATION_GUIDE.md §3 sets for the 4Runner.
    groundingNodeNames: ["Car", "Wheel1", "Wheel2", "Wheel3", "Wheel4"],
  },
};

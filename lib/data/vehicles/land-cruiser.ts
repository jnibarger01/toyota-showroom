import type { Vehicle } from "../../types/vehicle";

/**
 * 2025 Land Cruiser catalog entry backed by the supplied Ddiaz Design 250-series asset.
 * Pricing and specifications are representative showroom data, not a live Toyota offer.
 * Asset provenance and redistribution limits are documented in docs/MODEL_A_PROVENANCE.md.
 */
export const landCruiser: Vehicle = {
  slug: "land-cruiser",
  year: 2025,
  model: "Land Cruiser",
  bodyStyle: "suv",
  categories: ["suv", "off-road", "hybrid", "4wd"],
  availability: "in_production",
  updatedAt: "2026-09-17T00:00:00.000Z",
  pricing: { baseMsrp: 56700, destinationFee: 1450, currency: "USD" },
  powertrains: {
    "i-force-max-2.4l": {
      id: "i-force-max-2.4l",
      type: "hybrid",
      engine: "2.4L turbocharged four-cylinder i-FORCE MAX hybrid",
      horsepowerHp: 326,
      torqueLbFt: 465,
      transmission: "8-speed automatic",
      drivetrain: "4wd",
      fuelEconomy: { unit: "mpg", city: 22, highway: 25, combined: 23 },
      towingCapacityLbs: 6000,
    },
  },
  grades: [
    {
      id: "1958",
      name: "1958",
      msrp: 56700,
      powertrainId: "i-force-max-2.4l",
      seating: 5,
      availableExteriorColorCodes: ["040", "202", "1L7", "5C8"],
      availableInteriorColorCodes: ["black-fabric"],
      standardFeatures: ["Full-time 4WD", "Center locking differential", "Round LED headlamps"],
      packages: [],
    },
    {
      id: "land-cruiser",
      name: "Land Cruiser",
      msrp: 62450,
      powertrainId: "i-force-max-2.4l",
      seating: 5,
      availableExteriorColorCodes: ["040", "202", "1L7", "5C8"],
      availableInteriorColorCodes: ["black-softex"],
      standardFeatures: ["Multi-Terrain Select", "Crawl Control", "Rectangular LED headlamps"],
      packages: [],
    },
  ],
  specs: [
    { category: "dimensions", key: "length_in", label: "Overall length", value: 193.8, unit: "in" },
    { category: "dimensions", key: "width_in", label: "Overall width", value: 77.9, unit: "in" },
    { category: "dimensions", key: "height_in", label: "Overall height", value: 76.1, unit: "in" },
    { category: "capability", key: "ground_clearance_in", label: "Ground clearance", value: 8.7, unit: "in" },
    { category: "capability", key: "max_towing_lbs", label: "Maximum towing capacity", value: 6000, unit: "lb" },
    { category: "performance", key: "system_horsepower", label: "Combined system output", value: 326, unit: "hp" },
    { category: "safety", key: "toyota_safety_sense", label: "Toyota Safety Sense", value: "TSS 3.0" },
    { category: "warranty", key: "hybrid_battery_warranty_years_miles", label: "Hybrid battery warranty", value: "10 yr / 150,000 mi" },
  ],
  exteriorColors: [
    { code: "040", name: "Ice Cap", hex: "#f2f2ef", availableGradeIds: ["1958", "land-cruiser"] },
    { code: "202", name: "Black", hex: "#111214", availableGradeIds: ["1958", "land-cruiser"] },
    { code: "1L7", name: "Meteor Shower", hex: "#55585b", availableGradeIds: ["1958", "land-cruiser"] },
    { code: "5C8", name: "Trail Dust", hex: "#b7a27e", availableGradeIds: ["1958", "land-cruiser"], isPremium: true },
  ],
  interiorColors: [
    { code: "black-fabric", name: "Black fabric", hex: "#1a1a1a", material: "fabric", availableGradeIds: ["1958"] },
    { code: "black-softex", name: "Black SofTex", hex: "#151515", material: "softex", availableGradeIds: ["land-cruiser"] },
  ],
  media: {
    hero: { url: "/images/vehicles/land-cruiser/land-cruiser-front-three-quarter.png", alt: "2025 Toyota Land Cruiser front three-quarter 3D render", width: 738, height: 565 },
    gallery: [{ url: "/images/vehicles/land-cruiser/land-cruiser-front-three-quarter.png", alt: "2025 Toyota Land Cruiser front three-quarter 3D render", width: 738, height: 565 }],
    thumbnails: [{ url: "/images/vehicles/land-cruiser/land-cruiser-front-three-quarter.png", alt: "2025 Toyota Land Cruiser 3D model thumbnail", width: 738, height: 565 }],
    videos: [],
    environmentMaps: [],
  },
  threeDConfig: {
    hasModel: true,
    modelUrl: "/models/land-cruiser-250-2025/land-cruiser-250.glb",
    rotation: [0, 0, 0],
    cameraPresets: [
      { id: "hero", label: "Hero", position: [6.0, 2.7, -6.7], target: [0, 1.0, 0] },
      { id: "front", label: "Front", position: [0, 1.9, -7.8], target: [0, 1.0, 0] },
      { id: "side", label: "Side", position: [7.8, 1.9, 0], target: [0, 1.0, 0] },
      { id: "rear", label: "Rear", position: [0, 1.9, 7.8], target: [0, 1.0, 0] },
    ],
    paintableMaterialNames: ["CarPaint", "CarPaint_N2"],
    wheelMountNames: [],
    interiorMaterialNames: ["Cuero_1", "Cuero_PErf"],
    groundingNodeNames: ["Sketchfab_model"],
  },
};

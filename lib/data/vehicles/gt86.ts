import type { Vehicle } from "../../types/vehicle";

/**
 * Toyota GT86 catalog entry backed by the supplied Mpgs.studio3DModels asset.
 * The source names no model year; 2012 is used as the first-generation catalog year.
 * Asset identity, attribution, and hashes are documented in docs/GT86_PROVENANCE.md.
 */
export const gt86: Vehicle = {
  slug: "gt86",
  year: 2012,
  model: "GT86",
  bodyStyle: "coupe",
  categories: ["coupe", "sports-car", "performance"],
  availability: "discontinued",
  updatedAt: "2026-09-17T00:00:00.000Z",
  pricing: { baseMsrp: 25990, destinationFee: 795, currency: "USD" },
  powertrains: {
    "fa20-2.0l": {
      id: "fa20-2.0l",
      type: "gas",
      engine: "2.0L horizontally opposed four-cylinder",
      horsepowerHp: 200,
      torqueLbFt: 151,
      transmission: "6-speed manual or automatic",
      drivetrain: "rwd",
      fuelEconomy: { unit: "mpg", city: 22, highway: 30, combined: 25 },
    },
  },
  grades: [
    {
      id: "gt86",
      name: "GT86",
      msrp: 25990,
      powertrainId: "fa20-2.0l",
      seating: 4,
      availableExteriorColorCodes: ["37J", "D4S", "C7P", "E8H"],
      availableInteriorColorCodes: ["black-fabric"],
      standardFeatures: ["Rear-wheel drive", "Torsen limited-slip differential", "17-in alloy wheels"],
      packages: [],
    },
  ],
  specs: [
    { category: "dimensions", key: "length_in", label: "Overall length", value: 166.7, unit: "in" },
    { category: "dimensions", key: "width_in", label: "Overall width", value: 69.9, unit: "in" },
    { category: "dimensions", key: "height_in", label: "Overall height", value: 50.6, unit: "in" },
    { category: "performance", key: "horsepower_hp", label: "Horsepower", value: 200, unit: "hp" },
    { category: "performance", key: "curb_weight_lbs", label: "Approximate curb weight", value: 2758, unit: "lb" },
    { category: "technology", key: "limited_slip", label: "Limited-slip differential", value: "Torsen" },
  ],
  exteriorColors: [
    { code: "37J", name: "Satin White Pearl", hex: "#f2f1eb", availableGradeIds: ["gt86"] },
    { code: "D4S", name: "Crystal Black Silica", hex: "#111318", availableGradeIds: ["gt86"] },
    { code: "C7P", name: "Lightning Red", hex: "#a51e2a", availableGradeIds: ["gt86"] },
    { code: "E8H", name: "Galaxy Blue Silica", hex: "#173d69", availableGradeIds: ["gt86"] },
  ],
  interiorColors: [
    { code: "black-fabric", name: "Black fabric", hex: "#17181a", material: "fabric", availableGradeIds: ["gt86"] },
  ],
  media: {
    hero: { url: "/images/vehicles/gt86/gt86-front-three-quarter.png", alt: "Toyota GT86 front three-quarter 3D render", width: 738, height: 565 },
    gallery: [{ url: "/images/vehicles/gt86/gt86-front-three-quarter.png", alt: "Toyota GT86 front three-quarter 3D render", width: 738, height: 565 }],
    thumbnails: [{ url: "/images/vehicles/gt86/gt86-front-three-quarter.png", alt: "Toyota GT86 3D model thumbnail", width: 738, height: 565 }],
    videos: [],
    environmentMaps: [],
  },
  threeDConfig: {
    hasModel: true,
    modelUrl: "/models/gt86/toyota_gt86.glb",
    // The authored scene is 26.69 units long; this normalizes it to a 4.40 m showroom footprint.
    scale: [0.165, 0.165, 0.165],
    rotation: [0, 0, 0],
    cameraPresets: [
      { id: "hero", label: "Hero", position: [5.2, 2.2, -6.1], target: [0, 0.75, 0] },
      { id: "front", label: "Front", position: [0, 1.45, -7.0], target: [0, 0.72, 0] },
      { id: "side", label: "Side", position: [6.8, 1.45, 0], target: [0, 0.72, 0] },
      { id: "rear", label: "Rear", position: [0, 1.45, 7.0], target: [0, 0.72, 0] },
    ],
    paintableMaterialNames: ["body.001"],
    wheelMountNames: [],
    interiorMaterialNames: ["black.001"],
    groundingNodeNames: ["Sketchfab_model"],
  },
};

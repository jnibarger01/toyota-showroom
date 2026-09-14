import type { Vehicle } from "../../types/vehicle";

export const grSupra: Vehicle = {
  slug: "gr-supra",
  year: 2024,
  model: "GR Supra",
  bodyStyle: "coupe",
  categories: ["sports-car", "coupe", "performance"],
  availability: "in_production",
  updatedAt: "2024-01-01T00:00:00.000Z",
  pricing: { baseMsrp: 45540, destinationFee: 1095, currency: "USD" },
  powertrains: {
    "i4-2.0l": { id: "i4-2.0l", type: "gas", engine: "2.0L turbocharged inline-4", horsepowerHp: 255, torqueLbFt: 295, transmission: "8-speed automatic", drivetrain: "rwd", fuelEconomy: { unit: "mpg", city: 25, highway: 32, combined: 28 } },
    "i6-3.0l": { id: "i6-3.0l", type: "gas", engine: "3.0L turbocharged inline-6", horsepowerHp: 382, torqueLbFt: 368, transmission: "6-speed manual or 8-speed automatic", drivetrain: "rwd", fuelEconomy: { unit: "mpg", city: 22, highway: 30, combined: 25 } },
  },
  grades: [
    { id: "2-0", name: "2.0", msrp: 45540, powertrainId: "i4-2.0l", seating: 2, availableExteriorColorCodes: ["040", "202", "1G3", "3U5", "8X7", "yellow"], availableInteriorColorCodes: ["black"], standardFeatures: ["255-hp turbocharged engine", "Active rear sport differential", "8.8-in touchscreen"], packages: [] },
    { id: "3-0-premium", name: "3.0 Premium", msrp: 54890, powertrainId: "i6-3.0l", seating: 2, availableExteriorColorCodes: ["040", "202", "1G3", "3U5", "8X7", "yellow"], availableInteriorColorCodes: ["black"], standardFeatures: ["382-hp turbocharged engine", "Adaptive variable suspension", "JBL audio", "Head-up display"], packages: [] },
  ],
  specs: [
    { category: "dimensions", key: "length_in", label: "Overall length", value: 172.5, unit: "in" },
    { category: "dimensions", key: "width_in", label: "Overall width", value: 73.0, unit: "in" },
    { category: "dimensions", key: "height_in", label: "Overall height", value: 51.1, unit: "in" },
    { category: "performance", key: "zero_to_60_sec", label: "0–60 mph", value: 3.9, unit: "sec" },
    { category: "performance", key: "top_speed_mph", label: "Top track speed", value: 155, unit: "mph" },
    { category: "safety", key: "toyota_safety_sense", label: "Toyota Safety Sense", value: "Supra active safety systems" },
    { category: "technology", key: "touchscreen_in", label: "Touchscreen display", value: 8.8, unit: "in" },
    { category: "comfort", key: "heated_seats", label: "Heated sport seats", value: true },
    { category: "warranty", key: "basic_warranty_years_miles", label: "Basic warranty", value: "3 yr / 36,000 mi" },
  ],
  exteriorColors: [
    { code: "040", name: "Absolute Zero White", hex: "#f2f3f1", availableGradeIds: ["2-0", "3-0-premium"] },
    { code: "202", name: "Black", hex: "#101114", availableGradeIds: ["2-0", "3-0-premium"] },
    { code: "1G3", name: "Steel Gray Metallic", hex: "#59616a", availableGradeIds: ["2-0", "3-0-premium"] },
    { code: "3U5", name: "Renaissance Red 2.0", hex: "#b51f2c", availableGradeIds: ["2-0", "3-0-premium"], isPremium: true },
    { code: "8X7", name: "Nitro Yellow", hex: "#e4c21c", availableGradeIds: ["2-0", "3-0-premium"], isPremium: true },
    { code: "blue", name: "Deep Blue", hex: "#174c93", availableGradeIds: ["2-0", "3-0-premium"] },
    { code: "yellow", name: "Solar Yellow", hex: "#f1b91b", availableGradeIds: ["2-0", "3-0-premium"], isPremium: true },
  ],
  interiorColors: [{ code: "black", name: "Black leather", hex: "#18191b", material: "leather", availableGradeIds: ["2-0", "3-0-premium"] }],
  media: {
    hero: { url: "/images/vehicles/gr-supra/gr-supra-front-three-quarter.png", alt: "2024 Toyota GR Supra front three-quarter 3D render", width: 1280, height: 720 },
    gallery: [{ url: "/images/vehicles/gr-supra/gr-supra-front-three-quarter.png", alt: "2024 Toyota GR Supra front three-quarter 3D render", width: 1280, height: 720 }],
    thumbnails: [{ url: "/images/vehicles/gr-supra/gr-supra-front-three-quarter.png", alt: "2024 Toyota GR Supra 3D model thumbnail", width: 1280, height: 720 }], videos: [], environmentMaps: [],
  },
  threeDConfig: {
    // The authored Sketchfab hierarchy carries a 0.001 FBX-to-metre transform. Normalize it at
    // the generic Vehicle3DConfig boundary so the shared camera and grounding logic see a car-sized
    // object rather than baking a Supra-only transform into VehicleCanvas.
    hasModel: true, modelUrl: "/models/gr-supra-2024/toyota_gr_supra.glb", scale: [100, 100, 100], rotation: [0, 0, 0], texturePolicy: "factors-only",
    cameraPresets: [{ id: "hero", label: "Hero", position: [4.2, 2.1, 5.8], target: [0, 1.1, 0] }, { id: "front", label: "Front", position: [0, 1.5, 6], target: [0, 1, 0] }, { id: "side", label: "Side", position: [5.5, 1.5, 0], target: [0, 1, 0] }],
    paintableMaterialNames: ["Paint", "PaintSecondary"],
    wheelMountNames: ["Wheel_01_LF", "Wheel_01_RF", "Wheel_01_LR", "Wheel_01_RR"],
    interiorMaterialNames: ["InteriorBase", "InteriorColor2"], groundingNodeNames: ["RootNode"],
  },
};

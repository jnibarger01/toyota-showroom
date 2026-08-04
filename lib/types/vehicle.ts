/** Canonical Toyota vehicle schema (v1). All catalog data and API responses conform to this. */

export const VEHICLE_SCHEMA_VERSION = "1.0.0";

export type BodyStyle =
  | "suv"
  | "truck"
  | "sedan"
  | "minivan"
  | "crossover"
  | "coupe"
  | "hatchback";

export type PowertrainType = "gas" | "hybrid" | "phev" | "bev";

export type DrivetrainType = "fwd" | "rwd" | "awd" | "4wd";

export type FuelEconomyUnit = "mpg" | "mpge" | "kwh_per_100mi";

export interface FuelEconomy {
  unit: FuelEconomyUnit;
  city: number;
  highway: number;
  combined: number;
}

/** One entry in `Vehicle.powertrains`, keyed by powertrain id (e.g. "i-force-max-hybrid"). */
export interface PowertrainSpec {
  id: string;
  type: PowertrainType;
  engine: string;
  horsepowerHp: number;
  torqueLbFt: number;
  transmission: string;
  drivetrain: DrivetrainType;
  fuelEconomy: FuelEconomy;
  electricRangeMi?: number;
  towingCapacityLbs?: number;
  payloadCapacityLbs?: number;
}

/** Fixed category keys — do not add ad hoc categories, extend within an existing one instead. */
export type SpecCategory =
  | "dimensions"
  | "capability"
  | "performance"
  | "safety"
  | "technology"
  | "comfort"
  | "warranty";

export interface SpecEntry {
  category: SpecCategory;
  key: string;
  label: string;
  value: string | number | boolean;
  unit?: string;
}

export interface MediaAsset {
  url: string;
  alt: string;
  width?: number;
  height?: number;
}

export interface ExteriorColor {
  code: string;
  name: string;
  hex: string;
  imageAsset?: string;
  materialAsset?: string;
  isPremium?: boolean;
  availableGradeIds: string[];
}

export interface InteriorColor {
  code: string;
  name: string;
  hex: string;
  material: "fabric" | "softex" | "leather" | "suede";
  imageAsset?: string;
  availableGradeIds: string[];
}

export interface Package {
  id: string;
  name: string;
  price: number;
  includes: string[];
}

export interface Grade {
  id: string;
  name: string;
  msrp: number;
  powertrainId: string;
  seating: number;
  availableExteriorColorCodes: string[];
  availableInteriorColorCodes: string[];
  standardFeatures: string[];
  packages: Package[];
}

export interface Pricing {
  baseMsrp: number;
  destinationFee: number;
  currency: "USD";
}

export interface MediaManifest {
  hero: MediaAsset;
  gallery: MediaAsset[];
  thumbnails: MediaAsset[];
  videos: MediaAsset[];
  environmentMaps: MediaAsset[];
}

export interface CameraPresetConfig {
  id: string;
  label: string;
  position: [number, number, number];
  target: [number, number, number];
}

export interface WheelVariantConfig {
  id: string;
  label: string;
  scale: number;
}

/** Authored wheel and tyre glTFs mounted over the base vehicle's original running gear. */
export interface WheelAndTireAssetConfig {
  wheelUrl: string;
  tireUrl: string;
  /** Uniform scale applied to each wheel-and-tyre assembly at its authored hub mount. */
  scale?: number;
  /** Exact names retained for the configured wheel and tyre controls. */
  wheelNodeNames: [string, string, string, string];
  tireNodeNames: [string, string, string, string];
}

/** Maps a vehicle to the assets and parameters the 3D viewer needs to render and configure it. */
export interface Vehicle3DConfig {
  hasModel: boolean;
  modelUrl?: string;
  scale?: [number, number, number];
  rotation?: [number, number, number];
  cameraPresets: CameraPresetConfig[];
  paintableMaterialNames: string[];
  wheelMountNames: string[];
  wheelVariants: WheelVariantConfig[];
  /** Optional replacement running gear loaded from standalone glTF assets. */
  wheelAndTireAssets?: WheelAndTireAssetConfig;
  interiorMaterialNames: string[];
  /**
   * Nodes hidden immediately after load. Blender exports frequently retain donor/source copies of
   * parts that were duplicated into place; they render at the origin, inside and beneath the body.
   * Listed by exact name so the cleanup is auditable rather than a bounds heuristic.
   */
  hiddenNodeNames?: string[];
  /**
   * Nodes whose union defines the vehicle's extent for centering and grounding. Without this the
   * bounding box is taken over the whole scene, and any stray object at the origin silently lifts
   * the vehicle off the floor.
   */
  groundingNodeNames?: string[];
}

export type AvailabilityStatus = "in_production" | "coming_soon" | "discontinued";

export interface Vehicle {
  slug: string;
  year: number;
  model: string;
  bodyStyle: BodyStyle;
  categories: string[];
  grades: Grade[];
  powertrains: Record<string, PowertrainSpec>;
  specs: SpecEntry[];
  exteriorColors: ExteriorColor[];
  interiorColors: InteriorColor[];
  media: MediaManifest;
  threeDConfig: Vehicle3DConfig;
  pricing: Pricing;
  availability: AvailabilityStatus;
  updatedAt: string;
}

/**
 * Facts every filterable projection of a vehicle must expose, so the same `matchesFilters`
 * logic (lib/api/query.ts) can run server-side over full `Vehicle` records at build time and
 * client-side over cached `VehicleSummary` records at runtime, without duplicating derivation.
 */
export interface VehicleQueryFacts {
  bodyStyle: BodyStyle;
  categories: string[];
  availability: AvailabilityStatus;
  drivetrains: DrivetrainType[];
  powertrainTypes: PowertrainType[];
  maxSeating: number;
  maxTowingLbs: number;
  startingMsrp: number;
}

export function toVehicleQueryFacts(vehicle: Vehicle): VehicleQueryFacts {
  const powertrains = Object.values(vehicle.powertrains);
  return {
    bodyStyle: vehicle.bodyStyle,
    categories: vehicle.categories,
    availability: vehicle.availability,
    drivetrains: powertrains.map((p) => p.drivetrain),
    powertrainTypes: powertrains.map((p) => p.type),
    maxSeating: Math.max(...vehicle.grades.map((g) => g.seating)),
    maxTowingLbs: Math.max(0, ...powertrains.map((p) => p.towingCapacityLbs ?? 0)),
    startingMsrp: Math.min(vehicle.pricing.baseMsrp, ...vehicle.grades.map((g) => g.msrp)),
  };
}

/** Lightweight projection used for lineup/list views (goal 2) so payloads stay small. */
export type VehicleSummary = Pick<Vehicle, "slug" | "year" | "model" | "updatedAt"> &
  VehicleQueryFacts & {
    thumbnail: MediaAsset;
  };

export function toVehicleSummary(vehicle: Vehicle): VehicleSummary {
  return {
    slug: vehicle.slug,
    year: vehicle.year,
    model: vehicle.model,
    updatedAt: vehicle.updatedAt,
    thumbnail: vehicle.media.thumbnails[0] ?? vehicle.media.hero,
    ...toVehicleQueryFacts(vehicle),
  };
}

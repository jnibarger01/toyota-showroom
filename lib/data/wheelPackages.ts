import type { TireSpec, WheelPackageSpec } from "../three/proceduralWheels";

/**
 * The shared wheel-and-tyre package catalog.
 *
 * One catalog serves every vehicle. A package describes a rim *design* and a tyre *spec* in
 * proportional terms only — rim diameter as a fraction of the tyre's outer radius, sidewall bulge
 * as a fraction of sidewall height, tread width as a fraction of the fitment width. Nothing here
 * carries an absolute dimension, which is what lets the same five packages fit a 1980s coupe, a
 * sedan, two crossovers and a midsize truck: each vehicle's own measured fitment
 * (`lib/data/wheelFitment.ts`) supplies the absolute numbers at build time.
 *
 * A package is sold as a unit, the way a dealer sells one — "20-in gloss black with performance
 * tyres", not a rim and a tyre chosen independently. That is also why it is not combinatorial:
 * five packages are five sets of geometry, where five rims times three tyres would be fifteen.
 * Sidewall *finish* (blackwall, raised white letters, red line) is separately selectable on top of
 * whichever package is fitted, because that is a paint choice rather than a geometry one.
 */

const TOURING: TireSpec = {
  shoulderBulge: 0.12,
  treadBlocks: 0,
  treadWidthFraction: 0.88,
  sidewall: { color: "#16181a", roughness: 0.9 },
};

const PERFORMANCE: TireSpec = {
  // A low-profile performance tyre has almost no sidewall flex to model and a nearly square
  // shoulder, so the tread reaches close to the full fitment width.
  shoulderBulge: 0.05,
  treadBlocks: 0,
  treadWidthFraction: 0.95,
  sidewall: { color: "#111214", roughness: 0.84 },
};

const ALL_TERRAIN: TireSpec = {
  shoulderBulge: 0.2,
  treadBlocks: 28,
  treadWidthFraction: 0.8,
  sidewall: { color: "#1a1a18", roughness: 0.95 },
};

export const WHEEL_PACKAGES: readonly WheelPackageSpec[] = [
  {
    id: "sport-machined",
    label: "Sport Machined + Touring",
    design: {
      rimFraction: 0.66,
      spokeCount: 5,
      spokeStyle: "tapered",
      finish: { color: "#a7acb3", metalness: 0.92, roughness: 0.2 },
      capColor: "#2a2d32",
    },
    tire: TOURING,
  },
  {
    id: "gloss-black-mesh",
    label: "Gloss Black Mesh + Performance",
    design: {
      rimFraction: 0.72,
      spokeCount: 10,
      spokeStyle: "mesh",
      finish: { color: "#0e0f11", metalness: 0.7, roughness: 0.16 },
      capColor: "#8b8f96",
    },
    tire: PERFORMANCE,
  },
  {
    id: "bronze-forged",
    label: "Bronze Forged + Performance",
    design: {
      rimFraction: 0.72,
      spokeCount: 7,
      spokeStyle: "tapered",
      finish: { color: "#8c6239", metalness: 0.88, roughness: 0.28 },
      capColor: "#1b1d20",
    },
    tire: PERFORMANCE,
  },
  {
    id: "offroad-beadlock",
    label: "Off-Road Beadlock + All-Terrain",
    design: {
      // A smaller rim inside the same tyre diameter is what buys the tall sidewall an off-road
      // package is chosen for — the one number that makes this read as an off-road wheel.
      rimFraction: 0.58,
      spokeCount: 6,
      spokeStyle: "beadlock",
      finish: { color: "#1e2124", metalness: 0.45, roughness: 0.6 },
      capColor: "#0c0d0f",
    },
    tire: ALL_TERRAIN,
  },
  {
    id: "classic-deep-dish",
    label: "Classic Deep Dish + Touring",
    design: {
      rimFraction: 0.62,
      spokeCount: 8,
      spokeStyle: "dish",
      finish: { color: "#c6cad0", metalness: 0.95, roughness: 0.12 },
      capColor: "#3a3d42",
    },
    tire: TOURING,
  },
];

export const WHEEL_PACKAGES_BY_ID: ReadonlyMap<string, WheelPackageSpec> = new Map(
  WHEEL_PACKAGES.map((entry) => [entry.id, entry]),
);

/** Dealer-style price deltas, keyed by package id. Kept beside the catalog it prices. */
export const WHEEL_PACKAGE_PRICES: Readonly<Record<string, number>> = {
  "sport-machined": 1250,
  "gloss-black-mesh": 1850,
  "bronze-forged": 2150,
  "offroad-beadlock": 2450,
  "classic-deep-dish": 1650,
};

/**
 * Sidewall finishes offered on whatever running gear is currently fitted.
 *
 * These are material writes against the `tire.sidewall` slot procedural tyres carry (and, where a
 * vehicle's own tyres expose a named material, that slot too), so they compose with every package
 * and with the factory wheels alike.
 */
export interface TireFinishSpec {
  id: string;
  label: string;
  color: string;
  roughness: number;
  priceDelta: number;
}

export const TIRE_FINISHES: readonly TireFinishSpec[] = [
  { id: "blackwall", label: "Blackwall", color: "#141414", roughness: 0.94, priceDelta: 0 },
  { id: "raised-white", label: "Raised White Letters", color: "#6f6f6c", roughness: 0.85, priceDelta: 180 },
  { id: "red-line", label: "Red Line", color: "#5e1c1f", roughness: 0.88, priceDelta: 220 },
];

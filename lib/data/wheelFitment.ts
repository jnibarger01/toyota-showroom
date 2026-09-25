/**
 * Per-vehicle running-gear fitment: where a wheel sits on each vehicle, how big it is, and what
 * the vehicle's own running gear is called.
 *
 * Every value here was read out of the shipped asset (by parsing the GLB's JSON chunk and walking
 * node transforms against each primitive's `POSITION` accessor min/max — the same technique
 * `lib/tooling/glbInspect.ts` uses, extended to transforms), not estimated from a photograph. Where
 * the asset lets a measurement be taken at runtime it is taken at runtime instead, because a
 * re-export that moves a wheel then moves the procedural wheel with it. Baked coordinates appear
 * only where the asset cannot express the measurement — see `camry` below.
 *
 * All coordinates and lengths are in the **vehicle root's local space**, i.e. the space of the
 * loaded `gltf.scene`, before `prepareVehicleRoot` applies the catalog's `scale`/`rotation` and the
 * grounding offset to the root itself. Children are unaffected by those root transforms, so local
 * values stay valid regardless of them — which is why the Camry's numbers look like hundredths
 * (that asset is authored at 0.01 world scale and the catalog scales the root by 100).
 */

/** How the four corner anchors are obtained for a vehicle. */
export type WheelAnchorSource =
  /**
   * Four named nodes, one per corner, measured at load time. Preferred: position, diameter and
   * width all come from the geometry actually on screen, so an asset re-export needs no data edit.
   */
  | { kind: "corner"; nodeNames: readonly [string, string, string, string] }
  /**
   * Four named transform nodes with no geometry of their own (empty `MOUNT_WHEEL_*` rig nodes).
   * X and Z come from the node; the vertical placement and the size cannot, so they are given.
   */
  | {
      kind: "mount";
      nodeNames: readonly [string, string, string, string];
      radius: number;
      width: number;
      /** Local Y of the surface the vehicle is grounded on, so a wheel is placed touching it. */
      floorLocalY: number;
    }
  /** Explicit corners, for an asset whose wheels cannot be addressed one corner at a time. */
  | {
      kind: "fixed";
      corners: readonly [readonly [number, number, number], readonly [number, number, number], readonly [number, number, number], readonly [number, number, number]];
      radius: number;
      width: number;
    };

export interface VehicleWheelFitment {
  vehicleId: string;
  anchors: WheelAnchorSource;
  /**
   * Nodes hidden while a procedural package is fitted, and shown again when the factory wheels are
   * reselected. Empty for a vehicle with no wheel geometry of its own.
   */
  stockRunningGearNodes: readonly string[];
  /** Nodes carrying the vehicle's own tyre material, where rim and tyre are separable at all. */
  stockTireNodes: readonly string[];
  /** Material names those nodes expose. Every name listed must exist, or the option is dropped. */
  stockTireMaterials: readonly string[];
  /** Packages offered on this vehicle. A beadlock wheel does not belong on a sedan. */
  packageIds: readonly string[];
}

const STREET_PACKAGES = ["sport-machined", "gloss-black-mesh", "bronze-forged", "classic-deep-dish"];
const TRUCK_PACKAGES = ["sport-machined", "gloss-black-mesh", "bronze-forged", "offroad-beadlock"];

const FOUR_RUNNER_TIRE_NODES = [
  "PLACED_KO3_front_left",
  "PLACED_KO3_front_right",
  "PLACED_KO3_rear_left",
  "PLACED_KO3_rear_right",
] as const;

const FOUR_RUNNER_RIM_NODES = [
  "PLACED_WEISU_front_left",
  "PLACED_WEISU_front_right",
  "PLACED_WEISU_rear_left",
  "PLACED_WEISU_rear_right",
] as const;

const WHEEL_FITMENTS: readonly VehicleWheelFitment[] = [
  {
    // Measured (assembled GLB): each `PLACED_KO3_*` node is 0.225 x 0.553 x 0.553, centred at
    // x ±0.834, y 0.395, z +1.527 / -1.280. Taken at runtime rather than baked, because on tiers
    // that load the authored running gear these nodes are replaced by the supplied glTFs at 1.45x
    // scale under the same names — the measurement then correctly reflects whichever is mounted.
    vehicleId: "4runner",
    anchors: { kind: "corner", nodeNames: FOUR_RUNNER_TIRE_NODES },
    stockRunningGearNodes: [...FOUR_RUNNER_RIM_NODES, ...FOUR_RUNNER_TIRE_NODES],
    stockTireNodes: FOUR_RUNNER_TIRE_NODES,
    stockTireMaterials: ["tire.sidewall"],
    packageIds: TRUCK_PACKAGES,
  },
  {
    // No Tacoma GLB ships; `createProceduralVehicle` stands in, and it is deliberately built with
    // the 4Runner's node and material names (`lib/three/proceduralParts.ts`), so the same anchors
    // resolve against it.
    vehicleId: "tacoma",
    anchors: { kind: "corner", nodeNames: FOUR_RUNNER_TIRE_NODES },
    stockRunningGearNodes: [...FOUR_RUNNER_RIM_NODES, ...FOUR_RUNNER_TIRE_NODES],
    stockTireNodes: FOUR_RUNNER_TIRE_NODES,
    stockTireMaterials: ["tire.sidewall"],
    packageIds: TRUCK_PACKAGES,
  },
  {
    /**
     * The Camry is the one asset that cannot measure itself.
     *
     * `CAMRY_EX_ALLOY_MESH` holds 474 `polySurface*` primitives, and they are not grouped by
     * corner: the two front wheels are separate, but the rear pair is modelled as single meshes
     * that span the full track, so there is no node whose bounding box is one rear wheel. Clustering
     * those 474 primitives by position at load time would mean a bespoke heuristic running against
     * the largest asset in the repo on every page load, to recover four numbers that do not change.
     *
     * The clustering was therefore run once, offline, over the GLB: front corners at x ±0.00789,
     * z -0.01004; rear at the same track, z -0.03822; hub height 0.01081; tyre diameter 0.00671
     * (all local units — this scene is authored at 0.01 scale and the catalog scales the root by
     * 100, so 0.003355 local radius is a real 0.336 m / 26.4 in tyre). Width is the 235-section
     * tyre the XV80 actually wears, not the 0.00684 the cluster measures — that figure includes the
     * brake and suspension geometry caught in the same cluster.
     */
    vehicleId: "camry",
    anchors: {
      kind: "fixed",
      corners: [
        [0.00789, 0.01081, -0.01004],
        [-0.00789, 0.01081, -0.01004],
        [0.00789, 0.01081, -0.03822],
        [-0.00789, 0.01081, -0.03822],
      ],
      radius: 0.003355,
      width: 0.00235,
    },
    stockRunningGearNodes: ["CAMRY_EX_ALLOY_MESH"],
    stockTireNodes: ["CAMRY_EX_ALLOY_MESH"],
    stockTireMaterials: ["Tire"],
    packageIds: STREET_PACKAGES,
  },
  {
    // Four `Wheel_01_*` groups, each wrapping its own mesh — measured at runtime.
    vehicleId: "gr-supra",
    anchors: { kind: "corner", nodeNames: ["Wheel_01_LF", "Wheel_01_RF", "Wheel_01_LR", "Wheel_01_RR"] },
    // The stock calipers go with the stock wheels: a procedural assembly carries its own rotor and
    // caliper, and leaving the authored ones behind would put two calipers in the same hub.
    stockRunningGearNodes: ["Wheels_01", "Calipers"],
    // Rim and tyre share the single `Wheel1A` material in this asset, so there is no stock tyre slot
    // a sidewall finish could target — sidewall finishes apply to fitted packages only.
    stockTireNodes: [],
    stockTireMaterials: [],
    packageIds: STREET_PACKAGES,
  },
  {
    // `Wheel1`–`Wheel4` are four separate meshes, each 1.52 x 2.63 x 2.63 — measured at runtime.
    // This asset is authored at roughly 4x metre scale (the body is 18.6 units long) and carries no
    // catalog `scale`, which the runtime measurement absorbs automatically.
    vehicleId: "ae86",
    anchors: { kind: "corner", nodeNames: ["Wheel1", "Wheel2", "Wheel3", "Wheel4"] },
    stockRunningGearNodes: ["Wheel1", "Wheel2", "Wheel3", "Wheel4"],
    // One `Body` material covers the whole car including the wheels, so there is no tyre slot here
    // either — see `lib/data/options/ae86.ts` for why a material split cannot create one.
    stockTireNodes: [],
    stockTireMaterials: [],
    packageIds: STREET_PACKAGES,
  },
  {
    /**
     * The RAV4 capture is a body shell with no wheel geometry at all — only four real, empty
     * `MOUNT_WHEEL_*` rig nodes at x ±0.834, y 0.395, z +1.527 / -1.281. Until now this vehicle
     * simply had no wheels on screen; a procedural package is the only thing that can give it any.
     *
     * Vertical placement is derived rather than taken from the rig. `prepareVehicleRoot` grounds
     * this vehicle on `BODY` alone, whose lowest point is the underbody at local y 0.207, so the
     * showroom floor sits at local y 0.207 — not at the rig's own y 0. Placing the hub at
     * `floorLocalY + radius` puts the tyre's contact patch exactly on that floor, which is the
     * property that matters on screen. Radius 0.3585 is the 235/55R19 the Limited wears
     * (0.717 m / 28.2 in outside diameter).
     */
    vehicleId: "rav4",
    anchors: {
      kind: "mount",
      nodeNames: [
        "MOUNT_WHEEL_FRONT_LEFT",
        "MOUNT_WHEEL_FRONT_RIGHT",
        "MOUNT_WHEEL_REAR_LEFT",
        "MOUNT_WHEEL_REAR_RIGHT",
      ],
      radius: 0.3585,
      width: 0.235,
      floorLocalY: 0.207,
    },
    stockRunningGearNodes: [],
    stockTireNodes: [],
    stockTireMaterials: [],
    packageIds: TRUCK_PACKAGES,
  },
  {
    // Four `T1`–`T4` groups, each a complete 26-node wheel assembly — measured at runtime. Like the
    // Camry and Supra this scene is authored at 0.01 scale and the catalog scales the root by 100,
    // which the runtime measurement absorbs.
    vehicleId: "rav4-hybrid",
    anchors: { kind: "corner", nodeNames: ["T1", "T2", "T3", "T4"] },
    stockRunningGearNodes: ["T1", "T2", "T3", "T4"],
    // `Tdummy_material_0_133` is the tyre slot on each assembly (`T*_T:dummy_material_0_133_0`);
    // `Tdummy_material_0_101` is the rim. Neither name is descriptive — both were read out of the
    // file, not inferred from the naming.
    stockTireNodes: ["T1", "T2", "T3", "T4"],
    stockTireMaterials: ["Tdummy_material_0_133"],
    packageIds: TRUCK_PACKAGES,
  },
  {
    /**
     * Four `group4`/`group6`/`group8`/`group9` corner assemblies, measured at runtime.
     *
     * The catalog's `wheelMountNames` names the `*_tire_0` meshes inside them, but those are the
     * tyres only — this asset models the rim as a dozen separate `polySurface*` siblings, so hiding
     * the tyre alone would leave a rim floating in the arch. The enclosing group is the whole wheel.
     *
     * This is also the asset that showed a corner's side cannot be read from the sign of its own X:
     * its wheels sit at x +0.591 and -1.095, so the model is not centred on its own origin. See
     * `resolveCorners`.
     */
    vehicleId: "land-cruiser",
    anchors: { kind: "corner", nodeNames: ["group4", "group6", "group8", "group9"] },
    stockRunningGearNodes: ["group4", "group6", "group8", "group9"],
    stockTireNodes: ["group4", "group6", "group8", "group9"],
    stockTireMaterials: ["side_tire"],
    packageIds: TRUCK_PACKAGES,
  },
  {
    /**
     * Four Sketchfab wheel assemblies (`wheel_7`, `wheel.001_11`, …), each a tyre / rim / disc /
     * detail mesh set, plus four separate caliper groups. Anchored on the tyre meshes and measured at
     * runtime. The assembly groups are not used by name: three.js strips the `.` from
     * `wheel.001_11` on load, so those names differ between the file and the scene; the `Object_N`
     * meshes read the same in both. Calipers go with the stock wheels, as on the Supra.
     */
    vehicleId: "gr-corolla",
    anchors: { kind: "corner", nodeNames: ["Object_28", "Object_41", "Object_49", "Object_57"] },
    stockRunningGearNodes: [
      "Object_28", "Object_29", "Object_30", "Object_31",
      "Object_41", "Object_42", "Object_43", "Object_44",
      "Object_49", "Object_50", "Object_51", "Object_52",
      "Object_57", "Object_58", "Object_59", "Object_60",
      "Object_4", "Object_5", "Object_46", "Object_47", "Object_54", "Object_55", "Object_62", "Object_63",
    ],
    stockTireNodes: ["Object_28", "Object_41", "Object_49", "Object_57"],
    stockTireMaterials: ["tyre"],
    packageIds: STREET_PACKAGES,
  },
];

const BY_VEHICLE = new Map(WHEEL_FITMENTS.map((entry) => [entry.vehicleId, entry]));

export function getWheelFitment(vehicleId: string): VehicleWheelFitment | undefined {
  return BY_VEHICLE.get(vehicleId);
}

export function allWheelFitments(): readonly VehicleWheelFitment[] {
  return WHEEL_FITMENTS;
}

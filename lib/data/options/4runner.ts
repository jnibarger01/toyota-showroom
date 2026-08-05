import type { CustomizationOption } from "../../types/customization";

/**
 * 4Runner customization catalog.
 *
 * Every `targetNodes` / `targetMaterials` value below was read out of
 * `public/models/modsnation_7416_assets_assembled.glb` (see `docs/INTEGRATION_GUIDE.md` §3 for
 * the dump utility). They are exact `Object3D.name` / `Material.name` strings — nothing here
 * depends on child order or traversal position.
 *
 * Options whose nodes are not present in the loaded GLB are filtered out at runtime by
 * `verifyNodeContract`, so a forward-declared option (hood/decal/panel, which need a Blender
 * re-export) never renders a button that would do nothing.
 */

const VEHICLE = ["4runner"];

/** `BODY` is a single mesh carrying ten materials; paint must address the `body.carmain` slot. */
const PAINT_NODES = ["BODY"];
const PAINT_MATERIALS = ["body.carmain"];

/** The four positioned wheels. `MOUNT_WHEEL_*` are empty transform nodes at the same coordinates. */
const WHEEL_NODES = [
  "PLACED_WEISU_front_left",
  "PLACED_WEISU_front_right",
  "PLACED_WEISU_rear_left",
  "PLACED_WEISU_rear_right",
];
/** Front pair uses `wheel.metal`, rear pair uses `wheel.metal.001` — both slots are named. */
const WHEEL_MATERIALS = ["wheel.metal", "wheel.metal.001"];

const TIRE_NODES = [
  "PLACED_KO3_front_left",
  "PLACED_KO3_front_right",
  "PLACED_KO3_rear_left",
  "PLACED_KO3_rear_right",
];

function paint(
  id: string,
  label: string,
  color: string,
  extra?: Partial<CustomizationOption["materialConfig"]>,
): CustomizationOption {
  return {
    id,
    category: "paint",
    label,
    operation: "material-update",
    targetNodes: PAINT_NODES,
    targetMaterials: PAINT_MATERIALS,
    materialConfig: {
      color,
      metalness: 0.65,
      roughness: 0.28,
      clearcoat: 1,
      clearcoatRoughness: 0.06,
      ...extra,
    },
    compatibleVehicleIds: VEHICLE,
  };
}

export const fourRunnerOptions: CustomizationOption[] = [
  // ---------------------------------------------------------------- paint
  paint("paint-218-blueprint", "Blueprint", "#1558d6"),
  paint("paint-070-midnight-black", "Midnight Black Metallic", "#101215"),
  paint("paint-1j9-ice-cap", "Ice Cap", "#d8dde2", { metalness: 0.35, roughness: 0.35 }),
  paint("paint-1g3-underground", "Underground", "#4f545a", { roughness: 0.45, clearcoat: 0.5 }),
  paint("paint-3u5-barcelona-red", "Barcelona Red Metallic", "#9d1d20"),
  {
    ...paint("paint-0r2-solar-octane", "Solar Octane", "#ff6a1a"),
    priceDelta: 425,
    compatibleGradeIds: ["trd-pro"],
  },

  // ---------------------------------------------------------- wheel finish
  // `wheel.metal` is also used by the hidden donor node `322-1790(MD010)`, so these updates go
  // through clone-on-write: the four visible wheels get their own material instance.
  {
    id: "wheels-weisu-machined",
    category: "wheels",
    label: "WEISU Machined",
    operation: "material-update",
    targetNodes: WHEEL_NODES,
    targetMaterials: WHEEL_MATERIALS,
    materialConfig: { color: "#9aa1ab", metalness: 0.92, roughness: 0.22 },
    compatibleVehicleIds: VEHICLE,
  },
  {
    id: "wheels-weisu-satin-black",
    category: "wheels",
    label: "WEISU Satin Black",
    operation: "material-update",
    targetNodes: WHEEL_NODES,
    targetMaterials: WHEEL_MATERIALS,
    materialConfig: { color: "#15171a", metalness: 0.55, roughness: 0.52 },
    priceDelta: 380,
    compatibleVehicleIds: VEHICLE,
  },
  {
    id: "wheels-weisu-bronze",
    category: "wheels",
    label: "WEISU Bronze",
    operation: "material-update",
    targetNodes: WHEEL_NODES,
    targetMaterials: WHEEL_MATERIALS,
    materialConfig: { color: "#8c6239", metalness: 0.85, roughness: 0.3 },
    priceDelta: 520,
    compatibleVehicleIds: VEHICLE,
  },

  // ----------------------------------------------------------------- trim
  // `tire.sidewall` is shared by all four KO3 nodes and by the hidden donor tyre. All four wheels
  // are named explicitly, so clone-on-write updates every one of them while leaving the donor
  // untouched — the correct result without relying on the sharing being incidental.
  {
    id: "trim-tire-letters-raised-white",
    category: "trim",
    selectionGroup: "trim-tire-letters",
    label: "Raised White Letters",
    operation: "material-update",
    targetNodes: TIRE_NODES,
    targetMaterials: ["tire.sidewall"],
    materialConfig: { color: "#6f6f6c", roughness: 0.85 },
    compatibleVehicleIds: VEHICLE,
  },
  {
    id: "trim-tire-letters-blackwall",
    category: "trim",
    selectionGroup: "trim-tire-letters",
    label: "Blackwall",
    operation: "material-update",
    targetNodes: TIRE_NODES,
    targetMaterials: ["tire.sidewall"],
    materialConfig: { color: "#141414", roughness: 0.94 },
    compatibleVehicleIds: VEHICLE,
  },
  {
    id: "trim-grille-blackout",
    category: "trim",
    selectionGroup: "trim-grille",
    label: "Blackout Grille",
    operation: "material-update",
    targetNodes: ["Tun_GRILLE"],
    targetMaterials: ["plastik.all.003"],
    materialConfig: { color: "#0d0f11", metalness: 0.35, roughness: 0.55 },
    priceDelta: 295,
    compatibleVehicleIds: VEHICLE,
  },
  {
    id: "trim-grille-chrome",
    category: "trim",
    selectionGroup: "trim-grille",
    label: "Chrome Grille",
    operation: "material-update",
    targetNodes: ["Tun_GRILLE"],
    targetMaterials: ["plastik.all.003"],
    materialConfig: { color: "#c9ced6", metalness: 0.95, roughness: 0.12 },
    compatibleVehicleIds: VEHICLE,
  },

  // ----------------------------------------------------------- accessories
  // Built procedurally by `buildProceduralAccessories` under these exact names, so they obey the
  // same name contract as GLB-sourced nodes. Swapping them for authored GLB assets later is a
  // change of `operation` to "mesh-replacement" plus an `assetUrl` — the option id is unaffected.
  {
    id: "accessory-roof-rack",
    category: "accessory",
    label: "Overland Roof Rack",
    operation: "mesh-visibility",
    targetNodes: ["ACCESSORY_ROOF_RACK"],
    priceDelta: 1150,
    compatibleVehicleIds: VEHICLE,
  },
  {
    id: "accessory-light-bar",
    category: "accessory",
    label: "LED Light Bar",
    operation: "mesh-visibility",
    targetNodes: ["ACCESSORY_LIGHT_BAR"],
    priceDelta: 680,
    compatibleVehicleIds: VEHICLE,
  },
  {
    id: "accessory-rock-sliders",
    category: "accessory",
    label: "Rock Sliders",
    operation: "mesh-visibility",
    targetNodes: ["ACCESSORY_ROCK_SLIDERS"],
    priceDelta: 890,
    compatibleVehicleIds: VEHICLE,
  },

  // ------------------------------------------------- forward-declared (gated)
  // These describe the intended contract for assets that do not exist in the current GLB.
  // `verifyNodeContract` reports them as unsatisfied and the store drops them from the catalog,
  // so no dead buttons reach the UI. Delivering the Blender re-export described in guide §3
  // activates them with no code change.
  {
    id: "hood-stock",
    category: "hood",
    label: "Stock Hood",
    operation: "mesh-visibility",
    targetNodes: ["HOOD_STOCK"],
    hidesNodes: ["HOOD_SPORT"],
    compatibleVehicleIds: VEHICLE,
  },
  {
    id: "hood-sport-scoop",
    category: "hood",
    label: "Sport Scoop Hood",
    operation: "mesh-visibility",
    targetNodes: ["HOOD_SPORT"],
    hidesNodes: ["HOOD_STOCK"],
    priceDelta: 1495,
    compatibleVehicleIds: VEHICLE,
  },
  {
    id: "decal-trd-side-stripe",
    category: "decal",
    label: "TRD Side Stripe",
    operation: "texture-update",
    targetNodes: ["DECAL_DRIVER", "DECAL_PASSENGER"],
    materialConfig: { textureUrl: "/textures/decals/trd-side-stripe.png" },
    priceDelta: 540,
    compatibleVehicleIds: VEHICLE,
  },

  // Matches lib/data/vehicles/4runner.ts's interiorColors exactly (code, name, hex, material,
  // grade gating) — same pattern as the paint options above, gated for the same reason as the
  // hood/decal entries: the current GLB is exterior-only, with no seat geometry to target yet.
  {
    id: "interior-fa20-black",
    category: "interior",
    label: "Black Softex",
    operation: "material-update",
    targetNodes: ["SEATS"],
    targetMaterials: ["interior.seat"],
    materialConfig: { color: "#1a1a1a", roughness: 0.65, metalness: 0 },
    compatibleVehicleIds: VEHICLE,
  },
  {
    id: "interior-lf10-red",
    category: "interior",
    label: "Red Leather",
    operation: "material-update",
    targetNodes: ["SEATS"],
    targetMaterials: ["interior.seat"],
    materialConfig: { color: "#4a1113", roughness: 0.35, metalness: 0 },
    priceDelta: 1250,
    compatibleVehicleIds: VEHICLE,
    compatibleGradeIds: ["limited"],
  },
];

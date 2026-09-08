import type { CustomizationOption } from "../../types/customization";

/**
 * RAV4 customization catalog.
 *
 * `public/models/rav4-2024/rav4_2024_limited_decoded.glb` is a body-shell-only capture — see
 * `docs/RAV4_PROVENANCE.md` and `lib/data/sceneMap/rav4.ts`'s own header for the full node/material
 * inventory (read directly out of the file, not assumed from the 4Runner's naming). `BODY` is the
 * only mesh in the asset, carrying ten materials; every `targetNodes`/`targetMaterials` value below
 * is one of those ten, confirmed present.
 *
 * Deliberately NOT included here, and why:
 * - No wheel, tire, or interior options: this capture has no wheel/tire/interior geometry at all
 *   (only four empty `MOUNT_WHEEL_*` transform nodes — see `lib/data/vehicles/rav4.ts`), so there is
 *   nothing for such an option to target. Adding one would either silently fail
 *   `verifyNodeContract` or, worse, target the wrong node and appear to work while doing nothing.
 * - No grille option: unlike the 4Runner's separate `Tun_GRILLE` node, this capture has no distinct
 *   grille geometry — the grille is baked into `BODY`'s `plastik.all` region along with every other
 *   black plastic trim panel, so a grille-only finish is not separable from the rest of that slot.
 *
 * Colours are pulled from `lib/data/vehicles/rav4.ts`'s own `exteriorColors`, rather than invented,
 * so a paint option's label, hex, and grade gating always match the vehicle's own data.
 */

const VEHICLE = ["rav4"];

const PAINT_NODES = ["BODY"];
const PAINT_MATERIALS = ["body.carmain"];
const CHROME_TRIM_NODES = ["BODY"];
const CHROME_TRIM_MATERIALS = ["metal.chrome"];

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

export const rav4Options: CustomizationOption[] = [
  // ---------------------------------------------------------------- paint
  // Matches lib/data/vehicles/rav4.ts's exteriorColors exactly: code, name, hex, and grade gating.
  paint("paint-040-super-white", "Super White", "#f2f2ef"),
  paint("paint-1g3-underground", "Underground", "#4f545a", { roughness: 0.45, clearcoat: 0.5 }),
  paint("paint-218-blueprint", "Blueprint", "#1558d6"),
  paint("paint-3u5-barcelona-red", "Barcelona Red Metallic", "#9d1d20"),
  {
    ...paint("paint-0r2-solar-octane", "Solar Octane", "#ff6a1a"),
    compatibleGradeIds: ["xle", "limited"],
  },

  // ----------------------------------------------------------------- trim
  {
    id: "trim-chrome-bright",
    category: "trim",
    selectionGroup: "trim-chrome",
    label: "Bright Chrome",
    operation: "material-update",
    targetNodes: CHROME_TRIM_NODES,
    targetMaterials: CHROME_TRIM_MATERIALS,
    materialConfig: { color: "#c9ced6", metalness: 0.95, roughness: 0.12 },
    compatibleVehicleIds: VEHICLE,
  },
  {
    id: "trim-chrome-blackout",
    category: "trim",
    selectionGroup: "trim-chrome",
    label: "Blackout Chrome Delete",
    operation: "material-update",
    targetNodes: CHROME_TRIM_NODES,
    targetMaterials: CHROME_TRIM_MATERIALS,
    materialConfig: { color: "#0d0f11", metalness: 0.35, roughness: 0.55 },
    priceDelta: 295,
    compatibleVehicleIds: VEHICLE,
  },
];

/**
 * Paint finishes, offered on top of whatever colour is selected.
 *
 * A real configurator sells colour and finish as two choices, not one: the same Barcelona Red is a
 * different car in gloss, in matte, and in a pearl. Expressing that as a second choice rather than
 * as more swatches is what keeps it from being combinatorial — five finishes across a vehicle's own
 * colours multiply the paint offering without multiplying the catalog.
 *
 * ## Why a finish carries no colour
 *
 * Every entry here sets only the *surface* properties — metalness, roughness, clearcoat — and
 * deliberately leaves `color` undefined. `MaterialWriter.applyMaterialConfig` writes only the fields
 * a config actually defines, so a finish repaints the character of the paint slot while the selected
 * colour survives untouched. That disjointness is the whole mechanism: colour and finish write to
 * the same material without either erasing the other.
 *
 * The one thing it does not survive on its own is ordering — a colour option carries its own
 * metalness/roughness, so a colour applied *after* a finish would overwrite it.
 * `VehicleSceneController` handles that by re-applying later selection groups in the same category,
 * so the pair composes whichever order the two were clicked in.
 */

import type { MaterialConfig } from "../types/customization";

export interface PaintFinishSpec {
  id: string;
  label: string;
  /** Surface properties only. `color` is intentionally absent — see this module's header. */
  surface: Omit<MaterialConfig, "color" | "textureUrl">;
  priceDelta: number;
  /** Shown under the finish chips, so the difference between them is legible before clicking. */
  description: string;
}

export const PAINT_FINISHES: readonly PaintFinishSpec[] = [
  {
    id: "gloss",
    label: "Gloss",
    // The reference finish: full clearcoat over a low-metalness base, which is what a standard
    // solid or metallic factory paint looks like under the showroom lights.
    surface: { metalness: 0.45, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.05 },
    priceDelta: 0,
    description: "Standard factory clearcoat",
  },
  {
    id: "metallic",
    label: "Metallic",
    // Higher metalness is what makes the flake read; the clearcoat stays sharp over it.
    surface: { metalness: 0.85, roughness: 0.26, clearcoat: 1, clearcoatRoughness: 0.06 },
    priceDelta: 395,
    description: "Suspended flake, sharp clearcoat",
  },
  {
    id: "pearl",
    label: "Pearl",
    // A pearl's depth comes from a soft, slightly diffuse clearcoat over a mid-metalness base —
    // the opposite of metallic's hard reflection.
    surface: { metalness: 0.6, roughness: 0.16, clearcoat: 1, clearcoatRoughness: 0.18 },
    priceDelta: 695,
    description: "Deep, soft-focus reflection",
  },
  {
    id: "satin",
    label: "Satin",
    surface: { metalness: 0.5, roughness: 0.52, clearcoat: 0.45, clearcoatRoughness: 0.4 },
    priceDelta: 1295,
    description: "Low sheen, wrapped look",
  },
  {
    id: "matte",
    label: "Matte",
    // Clearcoat is dropped entirely rather than merely roughened: a matte finish has no gloss layer
    // to catch a highlight, and leaving one at any strength reads as dirty gloss instead.
    surface: { metalness: 0.32, roughness: 0.82, clearcoat: 0, clearcoatRoughness: 1 },
    priceDelta: 1895,
    description: "No clearcoat, full diffuse",
  },
];

export const PAINT_FINISHES_BY_ID: ReadonlyMap<string, PaintFinishSpec> = new Map(
  PAINT_FINISHES.map((finish) => [finish.id, finish]),
);

/** The finish a vehicle wears when none is chosen — matches the catalog colours' own values. */
export const DEFAULT_PAINT_FINISH_ID = "gloss";

/** Selection group the finishes share, independent of the colour group in the same category. */
export const PAINT_FINISH_GROUP = "paint-finish";

export function paintFinishOptionId(finishId: string): string {
  return `paint-finish-${finishId}`;
}

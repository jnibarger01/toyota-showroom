/**
 * Persisted paint-studio state (schema-safe).
 *
 * OEM mode keeps selecting catalog paint option ids in `selections.paint`.
 * Custom mode stores material numbers + an HDRI preset id here — never GLB node or material names.
 */

export type PaintStudioMode = "oem" | "custom";

export interface PaintStudioMaterialParams {
  /** `#rrggbb` hex colour applied to the catalog paint slot. */
  color: string;
  metalness: number;
  roughness: number;
  clearcoat: number;
  clearcoatRoughness: number;
}

export interface PaintStudioState {
  mode: PaintStudioMode;
  /** Catalog HDRI preset id (`hdri-studio`, …) — never a URL or asset path. */
  hdriPresetId?: string;
  /** Present when `mode === "custom"`. */
  material?: PaintStudioMaterialParams;
}

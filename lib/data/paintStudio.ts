import type { MaterialConfig } from "../types/customization";
import type { PaintStudioMaterialParams, PaintStudioState } from "../types/paintStudio";

/**
 * Real-time paint studio catalog.
 *
 * Targets (`BODY` / `body.carmain`) live only here and in the option catalog — never in persisted
 * configuration payloads, deep links, or client-authored patches. Custom mode stores schema-safe
 * material numbers + an HDRI preset id; the scene layer resolves those onto the trusted paint slot.
 */

/** Exact mesh / material names the studio writes — mirrored from `lib/data/options/4runner.ts`. */
export const PAINT_STUDIO_TARGET_NODES = ["BODY"] as const;
export const PAINT_STUDIO_TARGET_MATERIALS = ["body.carmain"] as const;

/** Sentinel catalog option selected while custom mode is active (OEM paints keep their own ids). */
export const PAINT_CUSTOM_OPTION_ID = "paint-custom";

/** Studio fee when the builder is in custom paint mode. */
export const PAINT_CUSTOM_PRICE_DELTA = 595;

export type HdriLightingKey = "studio" | "showroom" | "overcast" | "sunset";

export interface HdriPreset {
  id: string;
  label: string;
  lightingKey: HdriLightingKey;
  /** Optional price for premium lighting looks. */
  priceDelta?: number;
  /**
   * Catalog-owned HDR URL. Resolved from this table only — never accepted from the client.
   * Absent presets use procedural lighting keyed by `lightingKey`.
   */
  hdrUrl?: string;
}

export const HDRI_PRESETS: readonly HdriPreset[] = [
  { id: "hdri-studio", label: "Studio Soft", lightingKey: "studio" },
  { id: "hdri-showroom", label: "Showroom Cool", lightingKey: "showroom" },
  { id: "hdri-overcast", label: "Overcast", lightingKey: "overcast" },
  {
    id: "hdri-sunset",
    label: "Golden Hour",
    lightingKey: "sunset",
    priceDelta: 175,
    hdrUrl: "/renders/rav4-2024/cold_photography_studio_1k.hdr",
  },
];

export const DEFAULT_HDRI_PRESET_ID = "hdri-studio";

export const DEFAULT_CUSTOM_MATERIAL: PaintStudioMaterialParams = {
  color: "#1558d6",
  metalness: 0.65,
  roughness: 0.28,
  clearcoat: 1,
  clearcoatRoughness: 0.06,
};

export function getHdriPreset(id: string | undefined): HdriPreset | undefined {
  if (!id) return undefined;
  return HDRI_PRESETS.find((preset) => preset.id === id);
}

export function isHdriPresetId(id: string): boolean {
  return HDRI_PRESETS.some((preset) => preset.id === id);
}

/** Price contribution from paint-studio state (custom fee + HDRI preset deltas). */
export function paintStudioPriceDelta(paintStudio: PaintStudioState | undefined | null): number {
  if (!paintStudio) return 0;
  let total = 0;
  if (paintStudio.mode === "custom") total += PAINT_CUSTOM_PRICE_DELTA;
  const hdri = getHdriPreset(paintStudio.hdriPresetId);
  if (hdri?.priceDelta) total += hdri.priceDelta;
  return total;
}

/** Maps schema-safe custom params onto a MaterialConfig (no GLB names). */
export function materialConfigFromPaintStudio(
  material: PaintStudioMaterialParams,
): MaterialConfig {
  return {
    color: material.color,
    metalness: material.metalness,
    roughness: material.roughness,
    clearcoat: material.clearcoat,
    clearcoatRoughness: material.clearcoatRoughness,
  };
}

export function defaultPaintStudioOem(hdriPresetId: string = DEFAULT_HDRI_PRESET_ID): PaintStudioState {
  return { mode: "oem", hdriPresetId };
}

export function defaultPaintStudioCustom(
  material: PaintStudioMaterialParams = DEFAULT_CUSTOM_MATERIAL,
  hdriPresetId: string = DEFAULT_HDRI_PRESET_ID,
): PaintStudioState {
  return { mode: "custom", hdriPresetId, material: { ...material } };
}

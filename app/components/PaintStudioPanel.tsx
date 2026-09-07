"use client";

import { SlidersHorizontal } from "lucide-react";
import {
  DEFAULT_CUSTOM_MATERIAL,
  DEFAULT_HDRI_PRESET_ID,
  HDRI_PRESETS,
  PAINT_CUSTOM_OPTION_ID,
  PAINT_CUSTOM_PRICE_DELTA,
  defaultPaintStudioCustom,
  defaultPaintStudioOem,
} from "../../lib/data/paintStudio";
import type { CustomizationOption } from "../../lib/types/customization";
import type { PaintStudioMaterialParams, PaintStudioState } from "../../lib/types/paintStudio";
import { configurationStore } from "../../lib/state/useConfiguration";

type Props = {
  paintStudio: PaintStudioState | undefined;
  oemPaintOptions: CustomizationOption[];
  selectedPaintId: string | undefined;
  catalog: CustomizationOption[];
  onBeforeChange?: () => void;
};

function materialFromOption(option: CustomizationOption | undefined): PaintStudioMaterialParams {
  const cfg = option?.materialConfig;
  return {
    color: cfg?.color ?? DEFAULT_CUSTOM_MATERIAL.color,
    metalness: cfg?.metalness ?? DEFAULT_CUSTOM_MATERIAL.metalness,
    roughness: cfg?.roughness ?? DEFAULT_CUSTOM_MATERIAL.roughness,
    clearcoat: cfg?.clearcoat ?? DEFAULT_CUSTOM_MATERIAL.clearcoat,
    clearcoatRoughness: cfg?.clearcoatRoughness ?? DEFAULT_CUSTOM_MATERIAL.clearcoatRoughness,
  };
}

export function PaintStudioPanel({
  paintStudio,
  oemPaintOptions,
  selectedPaintId,
  catalog,
  onBeforeChange,
}: Props) {
  const mode = paintStudio?.mode ?? "oem";
  const hdriPresetId = paintStudio?.hdriPresetId ?? DEFAULT_HDRI_PRESET_ID;
  const material = paintStudio?.material ?? DEFAULT_CUSTOM_MATERIAL;
  const customOption = catalog.find((option) => option.id === PAINT_CUSTOM_OPTION_ID);

  const switchMode = (nextMode: "oem" | "custom") => {
    onBeforeChange?.();
    const currentSelections = configurationStore.getSnapshot().configuration?.selections ?? {};
    if (nextMode === "oem") {
      const fallback =
        oemPaintOptions.find((option) => option.id === selectedPaintId && option.id !== PAINT_CUSTOM_OPTION_ID) ??
        oemPaintOptions[0];
      const selections = {
        ...currentSelections,
        paint: fallback ? [fallback.id] : [],
      };
      void configurationStore.setPaintStudio(defaultPaintStudioOem(hdriPresetId), selections);
      return;
    }

    const seedOption =
      oemPaintOptions.find((option) => option.id === selectedPaintId) ?? oemPaintOptions[0];
    const seeded = materialFromOption(seedOption);
    if (!customOption) return;
    void configurationStore.setPaintStudio(defaultPaintStudioCustom(seeded, hdriPresetId), {
      ...currentSelections,
      paint: [PAINT_CUSTOM_OPTION_ID],
    });
  };

  const updateMaterial = (patch: Partial<PaintStudioMaterialParams>) => {
    onBeforeChange?.();
    const nextMaterial = { ...material, ...patch };
    const currentSelections = configurationStore.getSnapshot().configuration?.selections ?? {};
    void configurationStore.setPaintStudio(
      {
        mode: "custom",
        hdriPresetId,
        material: nextMaterial,
      },
      {
        ...currentSelections,
        paint: [PAINT_CUSTOM_OPTION_ID],
      },
    );
  };

  const setHdri = (id: string) => {
    onBeforeChange?.();
    const next: PaintStudioState =
      mode === "custom"
        ? { mode: "custom", hdriPresetId: id, material }
        : defaultPaintStudioOem(id);
    void configurationStore.setPaintStudio(next);
  };

  return (
    <section className="control-section paint-studio" data-testid="paint-studio">
      <label>
        <SlidersHorizontal size={14} /> Paint studio
        {mode === "custom" ? <small>+${PAINT_CUSTOM_PRICE_DELTA.toLocaleString()}</small> : null}
      </label>
      <div className="segmented" role="group" aria-label="Paint studio mode">
        <button
          type="button"
          className={mode === "oem" ? "active" : ""}
          aria-pressed={mode === "oem"}
          data-testid="paint-mode-oem"
          onClick={() => switchMode("oem")}
        >
          OEM
        </button>
        <button
          type="button"
          className={mode === "custom" ? "active" : ""}
          aria-pressed={mode === "custom"}
          data-testid="paint-mode-custom"
          onClick={() => switchMode("custom")}
          disabled={!customOption}
        >
          Custom
        </button>
      </div>

      <label className="paint-studio-sub">HDRI preset</label>
      <div className="chip-row paint-hdri-row" data-testid="paint-hdri-presets">
        {HDRI_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            className={`option-chip ${hdriPresetId === preset.id ? "active" : ""}`}
            aria-pressed={hdriPresetId === preset.id}
            data-testid={`hdri-${preset.id}`}
            onClick={() => setHdri(preset.id)}
          >
            <span>{preset.label}</span>
            {preset.priceDelta ? <small>+${preset.priceDelta.toLocaleString()}</small> : null}
          </button>
        ))}
      </div>

      {mode === "custom" ? (
        <div className="paint-micro-controls" data-testid="paint-micro-controls">
          <label htmlFor="paint-studio-color">
            Colour
            <input
              id="paint-studio-color"
              type="color"
              value={material.color}
              onChange={(event) => updateMaterial({ color: event.target.value })}
            />
          </label>
          {(
            [
              ["metalness", "Metalness"],
              ["roughness", "Roughness"],
              ["clearcoat", "Clearcoat"],
              ["clearcoatRoughness", "Clearcoat roughness"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} htmlFor={`paint-studio-${key}`}>
              {label}
              <span>{material[key].toFixed(2)}</span>
              <input
                id={`paint-studio-${key}`}
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={material[key]}
                onChange={(event) => updateMaterial({ [key]: Number(event.target.value) })}
              />
            </label>
          ))}
        </div>
      ) : null}
    </section>
  );
}

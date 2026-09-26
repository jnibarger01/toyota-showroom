"use client";

import { useRef } from "react";
import { Check, Loader2 } from "lucide-react";
import { isProceduralPreview, type CustomizationOption } from "../../lib/types/customization";
import { formatPriceDelta } from "../../lib/shared/currency";
import { configurationStore, useConfiguration } from "../../lib/state/useConfiguration";

/**
 * The single control every customization category renders.
 *
 * Its only behaviour is `configurationStore.selectOption(option)` — it does not fetch, does not
 * touch the scene, and does not know which of the four operations the option performs. That is
 * what keeps "add an option" a data change rather than a component change.
 */

type Props = {
  option: CustomizationOption;
  /** "swatch" renders the material colour; "chip" renders the label. */
  variant?: "swatch" | "chip";
  onBeforeSelect?: () => void;
};

export function CustomizationButton({ option, variant = "chip", onBeforeSelect }: Props) {
  const { configuration, pending } = useConfiguration();
  const selected = (configuration?.selections[option.category] ?? []).includes(option.id);
  const busy = pending.has(option.id);
  // Hover and keyboard focus each hold the swatch preview open; it ends only when both have let go.
  const previewHolds = useRef({ hover: false, focus: false });

  const onClick = () => {
    onBeforeSelect?.();
    void configurationStore.selectOption(option);
  };

  if (variant === "swatch") {
    // Hover (mouse/pen) and keyboard focus preview the paint on the vehicle without selecting it;
    // leaving puts the real selection back. Touch is skipped: a tap is already a selection, and a
    // preview flashed for the length of a tap is noise. See `configurationStore.previewOption`.
    const hold = (source: "hover" | "focus") => {
      const wasHeld = previewHolds.current.hover || previewHolds.current.focus;
      previewHolds.current[source] = true;
      if (!wasHeld) void configurationStore.previewOption(option);
    };
    const release = (source: "hover" | "focus") => {
      previewHolds.current[source] = false;
      if (!previewHolds.current.hover && !previewHolds.current.focus) void configurationStore.previewOption(null);
    };
    return (
      <button
        type="button"
        onPointerEnter={(event) => {
          if (event.pointerType !== "touch") hold("hover");
        }}
        onPointerLeave={(event) => {
          if (event.pointerType !== "touch") release("hover");
        }}
        onFocus={() => hold("focus")}
        onBlur={() => release("focus")}
        aria-label={option.label}
        aria-pressed={selected}
        title={option.priceDelta ? `${option.label} (${formatPriceDelta(option.priceDelta)})` : option.label}
        className={selected ? "active" : ""}
        style={{ background: option.materialConfig?.color ?? "#333" }}
        disabled={busy}
        onClick={onClick}
      >
        {busy ? <Loader2 size={12} className="spin" /> : null}
      </button>
    );
  }

  return (
    <button
      type="button"
      aria-label={
        isProceduralPreview(option) ? `${option.label} (Preview)` : option.label
      }
      aria-pressed={selected}
      className={`option-chip ${selected ? "active" : ""} ${isProceduralPreview(option) ? "is-preview" : ""}`.trim()}
      disabled={busy}
      onClick={onClick}
    >
      <span>{option.label}</span>
      {isProceduralPreview(option) ? (
        <small className="option-preview-badge" data-testid="procedural-preview-badge">
          Preview
        </small>
      ) : null}
      {option.priceDelta ? <small>{formatPriceDelta(option.priceDelta)}</small> : null}
      {busy ? <Loader2 size={13} className="spin" /> : selected ? <Check size={13} /> : null}
    </button>
  );
}

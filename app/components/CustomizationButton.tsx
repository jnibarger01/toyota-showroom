"use client";

import { Check, Loader2 } from "lucide-react";
import type { CustomizationOption } from "../../lib/types/customization";
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
};

export function CustomizationButton({ option, variant = "chip" }: Props) {
  const { configuration, pending } = useConfiguration();
  const selected = (configuration?.selections[option.category] ?? []).includes(option.id);
  const busy = pending.has(option.id);

  const onClick = () => {
    void configurationStore.selectOption(option);
  };

  if (variant === "swatch") {
    return (
      <button
        type="button"
        aria-label={option.label}
        aria-pressed={selected}
        title={option.priceDelta ? `${option.label} (+$${option.priceDelta})` : option.label}
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
      aria-pressed={selected}
      className={`option-chip ${selected ? "active" : ""}`}
      disabled={busy}
      onClick={onClick}
    >
      <span>{option.label}</span>
      {option.priceDelta ? <small>+${option.priceDelta.toLocaleString()}</small> : null}
      {busy ? <Loader2 size={13} className="spin" /> : selected ? <Check size={13} /> : null}
    </button>
  );
}

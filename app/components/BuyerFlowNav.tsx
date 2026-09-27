"use client";

import { Check } from "lucide-react";
import { BUYER_STEPS, type BuyerStepId } from "../../lib/showroom/buyerFlow";

type Props = {
  activeStep: BuyerStepId | "studio";
  completedSteps?: ReadonlySet<BuyerStepId>;
  labelPrefix?: string;
  onSelect: (step: BuyerStepId) => void;
  compact?: boolean;
};

export function BuyerFlowNav({
  activeStep,
  completedSteps,
  labelPrefix = "Build step",
  onSelect,
  compact = false,
}: Props) {
  return (
    <nav
      className={compact ? "buyer-flow buyer-flow-compact" : "buyer-flow"}
      aria-label="Build & Price steps"
      data-testid={compact ? "buyer-flow-mobile" : "buyer-flow"}
    >
      {BUYER_STEPS.map((step, index) => {
        const active = step.id === activeStep;
        const complete = completedSteps?.has(step.id) ?? false;
        return (
          <button
            key={step.id}
            type="button"
            className={active ? "buyer-step active" : complete ? "buyer-step complete" : "buyer-step"}
            aria-current={active ? "step" : undefined}
            aria-label={`${labelPrefix}: ${step.label}`}
            onClick={() => onSelect(step.id)}
          >
            <span className="buyer-step-index" aria-hidden="true">
              {complete && !active ? <Check size={12} /> : index + 1}
            </span>
            <span>{step.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

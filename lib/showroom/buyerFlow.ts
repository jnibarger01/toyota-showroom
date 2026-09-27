import type { CustomizationCategory, CustomizationOption } from "../types/customization";

export type BuyerStepId =
  | "model"
  | "grade"
  | "exterior"
  | "interior"
  | "packages"
  | "accessories"
  | "summary";

export const BUYER_STEPS: readonly { id: BuyerStepId; label: string }[] = [
  { id: "model", label: "Model" },
  { id: "grade", label: "Grade" },
  { id: "exterior", label: "Exterior" },
  { id: "interior", label: "Interior" },
  { id: "packages", label: "Packages" },
  { id: "accessories", label: "Accessories" },
  { id: "summary", label: "Summary" },
];

export const BUYER_STEP_CATEGORIES: Readonly<Record<BuyerStepId, readonly CustomizationCategory[]>> = {
  model: [],
  grade: [],
  exterior: ["paint", "wheels", "tires", "trim", "decal"],
  interior: ["interior"],
  packages: [],
  accessories: ["accessory"],
  summary: [],
};

export const ADVANCED_3D_CATEGORIES: readonly CustomizationCategory[] = [
  "brakes",
  "exhaust",
  "aero",
  "carbon",
  "lighting",
  "hood",
  "panel",
];

export function buyerStepForCategory(category: CustomizationCategory): BuyerStepId | null {
  for (const step of BUYER_STEPS) {
    if (BUYER_STEP_CATEGORIES[step.id].includes(category)) return step.id;
  }
  return null;
}

export function categoriesForBuyerStep(
  step: BuyerStepId,
  catalog: readonly CustomizationOption[],
): CustomizationCategory[] {
  return BUYER_STEP_CATEGORIES[step].filter((category) =>
    catalog.some((option) => option.category === category),
  );
}

export function firstCategoryForBuyerStep(
  step: BuyerStepId,
  catalog: readonly CustomizationOption[],
): CustomizationCategory | undefined {
  return categoriesForBuyerStep(step, catalog)[0];
}

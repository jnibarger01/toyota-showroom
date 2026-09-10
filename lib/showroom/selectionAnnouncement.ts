import type { CustomizationCategory, CustomizationOption, SelectionMap } from "../types/customization";

/**
 * Turns a configuration change into a sentence for a polite live region (#51).
 *
 * Selecting a paint chip updates the 3D scene, the running total, and the chip's pressed state —
 * all of it silent to a screen reader unless focus happens to be on the control that changed, which
 * it is not when a selection is applied from a deep link, an undo, or a grade switch. axe cannot
 * catch this: nothing is malformed, there is simply no announcement, which is exactly the class of
 * problem an automated gate misses and a live region fixes.
 *
 * Pure and free of React so the phrasing is unit-testable, and so the diffing logic lives somewhere
 * other than inside an effect.
 */

const CATEGORY_LABELS: Record<CustomizationCategory, string> = {
  paint: "Paint",
  wheels: "Wheels",
  hood: "Hood",
  panel: "Body panel",
  decal: "Decal",
  trim: "Trim",
  accessory: "Accessory",
  interior: "Interior",
};

function labelFor(optionId: string, catalog: readonly CustomizationOption[]): string {
  return catalog.find((option) => option.id === optionId)?.label ?? optionId;
}

function idsIn(selections: SelectionMap, category: string): readonly string[] {
  return selections[category as CustomizationCategory] ?? [];
}

/**
 * Describes what changed between two selection maps, or `null` when nothing did.
 *
 * Reports a single sentence rather than one per change: a grade switch can drop several
 * incompatible options at once, and reading each of them aloud buries the thing the viewer actually
 * did. Multi-change updates are summarised by count for the same reason.
 */
export function describeSelectionChange(
  previous: SelectionMap,
  next: SelectionMap,
  catalog: readonly CustomizationOption[],
): string | null {
  const categories = new Set([...Object.keys(previous), ...Object.keys(next)]);
  const added: Array<{ id: string; category: string }> = [];
  const removed: Array<{ id: string; category: string }> = [];

  for (const category of categories) {
    const before = idsIn(previous, category);
    const after = idsIn(next, category);
    for (const id of after) if (!before.includes(id)) added.push({ id, category });
    for (const id of before) if (!after.includes(id)) removed.push({ id, category });
  }

  if (added.length === 0 && removed.length === 0) return null;

  // The common case by far: one option replaced another within a single-select category (picking a
  // different paint). Announcing only the arrival is what a sighted user perceives, and mentioning
  // the option that went away would describe a mechanism rather than the change.
  if (added.length === 1 && removed.length <= 1 && added[0]!.category === (removed[0]?.category ?? added[0]!.category)) {
    const { id, category } = added[0]!;
    const label = CATEGORY_LABELS[category as CustomizationCategory] ?? category;
    return `${label}: ${labelFor(id, catalog)} selected.`;
  }

  if (added.length === 0 && removed.length === 1) {
    const { id, category } = removed[0]!;
    const label = CATEGORY_LABELS[category as CustomizationCategory] ?? category;
    return `${label}: ${labelFor(id, catalog)} removed.`;
  }

  const parts: string[] = [];
  if (added.length > 0) parts.push(`${added.length} option${added.length === 1 ? "" : "s"} added`);
  if (removed.length > 0) parts.push(`${removed.length} option${removed.length === 1 ? "" : "s"} removed`);
  return `${parts.join(", ")}.`;
}

/** Grade changes are announced separately: the grade is not a selection, and it can silently change
 * which options are even offered. */
export function describeGradeChange(gradeName: string): string {
  return `Grade changed to ${gradeName}.`;
}

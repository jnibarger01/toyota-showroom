/**
 * Builder keyboard shortcuts (#74).
 *
 * Pure mapping used by `BuilderApp` for the `?` cheat sheet and keydown routing. Keeping the
 * table here means unit tests cover open/close and "don't steal from search" without mounting the
 * full builder chrome.
 */

export type BuilderShortcutAction =
  | "toggle-cheatsheet"
  | "close-cheatsheet"
  | "focus-search"
  | "share"
  | "save"
  | "tour-toggle"
  | "reset-camera"
  | "undo"
  | "redo";

export interface BuilderShortcutRow {
  /** Stable id — matches {@link BuilderShortcutAction} for actionable rows. */
  id: BuilderShortcutAction;
  /** Human-readable chord shown in the sheet (e.g. `Ctrl/⌘ S`). */
  keys: string;
  /** Action label shown in the sheet. */
  label: string;
}

/**
 * Rows rendered by the `?` overlay. Order matches power-user priority: share/save/tour/camera
 * first, then history, then discovery helpers.
 */
export const BUILDER_SHORTCUT_SHEET: readonly BuilderShortcutRow[] = [
  { id: "share", keys: "Ctrl/⌘ Shift L", label: "Share build link" },
  { id: "save", keys: "Ctrl/⌘ S", label: "Save to garage" },
  { id: "tour-toggle", keys: "T", label: "Tour play / pause" },
  { id: "reset-camera", keys: "Home", label: "Reset camera" },
  { id: "undo", keys: "Ctrl/⌘ Z", label: "Undo" },
  { id: "redo", keys: "Ctrl/⌘ Shift Z", label: "Redo" },
  { id: "focus-search", keys: "/", label: "Search options" },
  { id: "toggle-cheatsheet", keys: "?", label: "Keyboard shortcuts" },
  { id: "close-cheatsheet", keys: "Esc", label: "Close shortcuts" },
] as const;

/** True when the event target is an option search field or other text control. */
export function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  ) {
    return true;
  }
  return Boolean(target.isContentEditable);
}

export interface ResolveBuilderShortcutOptions {
  /** Whether the cheat-sheet overlay is currently visible. */
  cheatSheetOpen: boolean;
}

/**
 * Map a keydown to a builder action, or `null` when the event should pass through.
 *
 * - `Esc` closes the sheet when open (even from an input — overlays always dismiss).
 * - Letter / `?` / `/` chords are ignored while focus is in inputs or search fields.
 * - Undo / redo keep working in inputs (same as the pre-#74 builder).
 */
export function resolveBuilderShortcut(
  event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey" | "target">,
  options: ResolveBuilderShortcutOptions,
): BuilderShortcutAction | null {
  // Never steal browser / OS chords that use Alt (menu access keys, etc.).
  if (event.altKey) return null;

  const mod = event.ctrlKey || event.metaKey;
  const key = event.key;
  const lower = key.length === 1 ? key.toLowerCase() : key;

  if (key === "Escape") {
    return options.cheatSheetOpen ? "close-cheatsheet" : null;
  }

  // Undo / redo are intentional even while typing in search — matches prior builder behaviour.
  if (mod && lower === "z") {
    return event.shiftKey ? "redo" : "undo";
  }
  if (mod && lower === "y" && !event.shiftKey) {
    return "redo";
  }

  const editing = isEditableKeyboardTarget(event.target);
  if (editing) return null;

  if (key === "?" || (key === "/" && event.shiftKey && !mod)) {
    return "toggle-cheatsheet";
  }

  if (key === "/" && !mod && !event.shiftKey) {
    return "focus-search";
  }

  if (mod && lower === "s" && !event.shiftKey) {
    return "save";
  }

  if (mod && lower === "l" && event.shiftKey) {
    return "share";
  }

  if (!mod && (lower === "t" || key === "T")) {
    return "tour-toggle";
  }

  if (key === "Home") {
    return "reset-camera";
  }

  return null;
}

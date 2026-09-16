import type { PaintStudioState } from "../types/paintStudio";

/**
 * Undo/redo stack for Paint Studio (#73).
 *
 * Distinct from the builder's selection-map history in `BuilderApp`: this stack snapshots the
 * paint option id (`paint-custom` or an OEM catalog id) plus schema-safe `paintStudio` state
 * (custom material params / OEM mode). Keyboard shortcuts are wired by the builder; only the
 * committed configuration is persisted via `ConfigurationStore` — this stack is session-local.
 */

export interface PaintStudioHistoryEntry {
  /** Selected `selections.paint[0]` — OEM option id or `paint-custom`. */
  paintOptionId: string | undefined;
  paintStudio: PaintStudioState | undefined;
}

export const PAINT_STUDIO_HISTORY_MAX_DEPTH = 50;

function cloneEntry(entry: PaintStudioHistoryEntry): PaintStudioHistoryEntry {
  return {
    paintOptionId: entry.paintOptionId,
    paintStudio: entry.paintStudio ? structuredClone(entry.paintStudio) : undefined,
  };
}

function entriesEqual(a: PaintStudioHistoryEntry, b: PaintStudioHistoryEntry): boolean {
  return (
    a.paintOptionId === b.paintOptionId &&
    JSON.stringify(a.paintStudio ?? null) === JSON.stringify(b.paintStudio ?? null)
  );
}

export class PaintStudioHistory {
  private undoStack: PaintStudioHistoryEntry[] = [];
  private redoStack: PaintStudioHistoryEntry[] = [];

  constructor(private readonly maxDepth: number = PAINT_STUDIO_HISTORY_MAX_DEPTH) {}

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  get undoDepth(): number {
    return this.undoStack.length;
  }

  get redoDepth(): number {
    return this.redoStack.length;
  }

  /** Push the pre-change snapshot. No-ops when equal to the current undo top. Clears redo. */
  push(entry: PaintStudioHistoryEntry): void {
    const cloned = cloneEntry(entry);
    const top = this.undoStack[this.undoStack.length - 1];
    if (top && entriesEqual(top, cloned)) return;
    this.undoStack.push(cloned);
    if (this.undoStack.length > this.maxDepth) {
      this.undoStack.shift();
    }
    this.redoStack = [];
  }

  /**
   * Pop undo and park `current` on redo. Returns the entry to restore, or `undefined` when empty.
   */
  undo(current: PaintStudioHistoryEntry): PaintStudioHistoryEntry | undefined {
    const previous = this.undoStack.pop();
    if (!previous) return undefined;
    this.redoStack.push(cloneEntry(current));
    return previous;
  }

  /**
   * Pop redo and park `current` on undo. Returns the entry to restore, or `undefined` when empty.
   */
  redo(current: PaintStudioHistoryEntry): PaintStudioHistoryEntry | undefined {
    const next = this.redoStack.pop();
    if (!next) return undefined;
    this.undoStack.push(cloneEntry(current));
    return next;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }
}

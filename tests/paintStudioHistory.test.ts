import { describe, expect, it } from "vitest";
import {
  DEFAULT_CUSTOM_MATERIAL,
  PAINT_CUSTOM_OPTION_ID,
  defaultPaintStudioCustom,
  defaultPaintStudioOem,
} from "../lib/data/paintStudio";
import {
  PAINT_STUDIO_HISTORY_MAX_DEPTH,
  PaintStudioHistory,
  type PaintStudioHistoryEntry,
} from "../lib/showroom/paintStudioHistory";

function entry(
  paintOptionId: string | undefined,
  paintStudio: PaintStudioHistoryEntry["paintStudio"],
): PaintStudioHistoryEntry {
  return { paintOptionId, paintStudio };
}

describe("PaintStudioHistory", () => {
  it("undo returns the previous color and redo restores it", () => {
    const history = new PaintStudioHistory();
    const blue = entry(
      PAINT_CUSTOM_OPTION_ID,
      defaultPaintStudioCustom({ ...DEFAULT_CUSTOM_MATERIAL, color: "#0000ff" }),
    );
    const red = entry(
      PAINT_CUSTOM_OPTION_ID,
      defaultPaintStudioCustom({ ...DEFAULT_CUSTOM_MATERIAL, color: "#ff0000" }),
    );

    history.push(blue);
    expect(history.canUndo).toBe(true);
    expect(history.canRedo).toBe(false);

    const undone = history.undo(red);
    expect(undone?.paintStudio?.material?.color).toBe("#0000ff");
    expect(undone?.paintOptionId).toBe(PAINT_CUSTOM_OPTION_ID);
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(true);

    const redone = history.redo(blue);
    expect(redone?.paintStudio?.material?.color).toBe("#ff0000");
    expect(history.canUndo).toBe(true);
    expect(history.canRedo).toBe(false);
  });

  it("tracks OEM option id transitions alongside custom mode", () => {
    const history = new PaintStudioHistory();
    const oemA = entry("paint-218-blueprint", defaultPaintStudioOem("hdri-studio"));
    const custom = entry(
      PAINT_CUSTOM_OPTION_ID,
      defaultPaintStudioCustom({ ...DEFAULT_CUSTOM_MATERIAL, color: "#1558d6" }),
    );
    const oemB = entry("paint-040-super-white", defaultPaintStudioOem("hdri-showroom"));

    history.push(oemA);
    history.push(custom);

    const backToCustom = history.undo(oemB);
    expect(backToCustom?.paintOptionId).toBe(PAINT_CUSTOM_OPTION_ID);
    expect(backToCustom?.paintStudio?.mode).toBe("custom");
    expect(backToCustom?.paintStudio?.material?.color).toBe("#1558d6");

    const backToOem = history.undo(custom);
    expect(backToOem?.paintOptionId).toBe("paint-218-blueprint");
    expect(backToOem?.paintStudio?.mode).toBe("oem");
  });

  it("skips duplicate pushes and clears redo on a new branch", () => {
    const history = new PaintStudioHistory();
    const a = entry(PAINT_CUSTOM_OPTION_ID, defaultPaintStudioCustom({ ...DEFAULT_CUSTOM_MATERIAL, color: "#111111" }));
    const b = entry(PAINT_CUSTOM_OPTION_ID, defaultPaintStudioCustom({ ...DEFAULT_CUSTOM_MATERIAL, color: "#222222" }));
    const c = entry(PAINT_CUSTOM_OPTION_ID, defaultPaintStudioCustom({ ...DEFAULT_CUSTOM_MATERIAL, color: "#333333" }));

    history.push(a);
    history.push(a);
    expect(history.undoDepth).toBe(1);

    history.undo(b);
    expect(history.canRedo).toBe(true);

    history.push(c);
    expect(history.canRedo).toBe(false);
    expect(history.undoDepth).toBe(1);
  });

  it("caps depth and clear resets both stacks", () => {
    const history = new PaintStudioHistory(3);
    for (let i = 0; i < 5; i += 1) {
      history.push(
        entry(
          PAINT_CUSTOM_OPTION_ID,
          defaultPaintStudioCustom({ ...DEFAULT_CUSTOM_MATERIAL, color: `#${i}${i}${i}${i}${i}${i}` }),
        ),
      );
    }
    expect(history.undoDepth).toBe(3);

    history.undo(
      entry(
        PAINT_CUSTOM_OPTION_ID,
        defaultPaintStudioCustom({ ...DEFAULT_CUSTOM_MATERIAL, color: "#ffffff" }),
      ),
    );
    expect(history.canRedo).toBe(true);

    history.clear();
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
    expect(history.undoDepth).toBe(0);
  });

  it("exposes the default max depth constant", () => {
    expect(PAINT_STUDIO_HISTORY_MAX_DEPTH).toBeGreaterThanOrEqual(10);
  });
});

/**
 * @vitest-environment jsdom
 *
 * Mapping coverage for #74 — open/close the cheat sheet and refuse to steal keystrokes from
 * option search fields. BuilderApp wires the returned action ids; this file owns the table.
 */
import { describe, expect, it } from "vitest";
import {
  BUILDER_SHORTCUT_SHEET,
  isEditableKeyboardTarget,
  resolveBuilderShortcut,
  type BuilderShortcutAction,
} from "../lib/showroom/builderShortcuts";

function keyEvent(
  partial: Partial<KeyboardEvent> & Pick<KeyboardEvent, "key">,
  target: EventTarget | null = document.body,
): Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey" | "target"> {
  return {
    key: partial.key,
    ctrlKey: partial.ctrlKey ?? false,
    metaKey: partial.metaKey ?? false,
    shiftKey: partial.shiftKey ?? false,
    altKey: partial.altKey ?? false,
    target,
  };
}

describe("BUILDER_SHORTCUT_SHEET", () => {
  it("lists share, save, tour, reset camera, and undo/redo", () => {
    const ids = BUILDER_SHORTCUT_SHEET.map((row) => row.id);
    for (const required of ["share", "save", "tour-toggle", "reset-camera", "undo", "redo"] as const) {
      expect(ids).toContain(required);
    }
  });
});

describe("isEditableKeyboardTarget", () => {
  it("treats inputs, textareas, and selects as editable", () => {
    expect(isEditableKeyboardTarget(document.createElement("input"))).toBe(true);
    expect(isEditableKeyboardTarget(document.createElement("textarea"))).toBe(true);
    expect(isEditableKeyboardTarget(document.createElement("select"))).toBe(true);
    expect(isEditableKeyboardTarget(document.createElement("button"))).toBe(false);
    expect(isEditableKeyboardTarget(document.body)).toBe(false);
  });
});

describe("resolveBuilderShortcut", () => {
  it("maps ? to toggle-cheatsheet and Esc to close when the sheet is open", () => {
    expect(resolveBuilderShortcut(keyEvent({ key: "?" }), { cheatSheetOpen: false })).toBe(
      "toggle-cheatsheet",
    );
    expect(resolveBuilderShortcut(keyEvent({ key: "?" }), { cheatSheetOpen: true })).toBe(
      "toggle-cheatsheet",
    );
    expect(resolveBuilderShortcut(keyEvent({ key: "Escape" }), { cheatSheetOpen: true })).toBe(
      "close-cheatsheet",
    );
    expect(resolveBuilderShortcut(keyEvent({ key: "Escape" }), { cheatSheetOpen: false })).toBe(
      null,
    );
  });

  it("does not steal ? / T / / from option search fields", () => {
    const search = document.createElement("input");
    search.type = "search";
    search.placeholder = "Search options…";

    expect(resolveBuilderShortcut(keyEvent({ key: "?" }, search), { cheatSheetOpen: false })).toBe(
      null,
    );
    expect(resolveBuilderShortcut(keyEvent({ key: "t" }, search), { cheatSheetOpen: false })).toBe(
      null,
    );
    expect(resolveBuilderShortcut(keyEvent({ key: "/" }, search), { cheatSheetOpen: false })).toBe(
      null,
    );
  });

  it("still closes the sheet with Esc while focus is in a search field", () => {
    const search = document.createElement("input");
    expect(resolveBuilderShortcut(keyEvent({ key: "Escape" }, search), { cheatSheetOpen: true })).toBe(
      "close-cheatsheet",
    );
  });

  it("maps share, save, tour, reset camera, undo, and redo chords", () => {
    const cases: Array<[ReturnType<typeof keyEvent>, BuilderShortcutAction]> = [
      [keyEvent({ key: "l", ctrlKey: true, shiftKey: true }), "share"],
      [keyEvent({ key: "L", metaKey: true, shiftKey: true }), "share"],
      [keyEvent({ key: "s", ctrlKey: true }), "save"],
      [keyEvent({ key: "s", metaKey: true }), "save"],
      [keyEvent({ key: "t" }), "tour-toggle"],
      [keyEvent({ key: "T" }), "tour-toggle"],
      [keyEvent({ key: "Home" }), "reset-camera"],
      [keyEvent({ key: "z", ctrlKey: true }), "undo"],
      [keyEvent({ key: "z", metaKey: true, shiftKey: true }), "redo"],
      [keyEvent({ key: "y", ctrlKey: true }), "redo"],
      [keyEvent({ key: "/" }), "focus-search"],
    ];

    for (const [event, action] of cases) {
      expect(resolveBuilderShortcut(event, { cheatSheetOpen: false })).toBe(action);
    }
  });

  it("keeps undo available while typing in search", () => {
    const search = document.createElement("input");
    expect(
      resolveBuilderShortcut(keyEvent({ key: "z", ctrlKey: true }, search), { cheatSheetOpen: false }),
    ).toBe("undo");
  });
});

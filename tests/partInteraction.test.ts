import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Source-level guard on `VehicleCanvas`'s direct-part-interaction wiring, for the same reason
 * `tests/motionPreference.test.ts`'s "VehicleCanvas keyboard access" section exists: jsdom cannot
 * render a real WebGL/WebGPU canvas, so there is no way to dispatch a real `pointermove` and assert
 * a raycast happened. What *can* be checked without a GPU is the shape of the wiring itself — every
 * listener this feature adds has a matching teardown, the drag/hover/keyboard logic it depends on is
 * actually present, and the accessible affordances describe what the pointer path does. Live
 * pointer/raycast behaviour is covered by `tests/sceneController.test.ts`'s `pickAt` suite (real
 * `THREE.Raycaster`, no mocks) and, end-to-end in a real browser, `tests/e2e/partInteraction.spec.ts`.
 */
const source = readFileSync(path.join(process.cwd(), "app/components/VehicleCanvas.tsx"), "utf8");

describe("VehicleCanvas direct part interaction", () => {
  it("adds a pointer listener for every stage of hover/click/drag disambiguation", () => {
    for (const type of ["pointerdown", "pointermove", "pointerup", "pointerleave", "pointercancel"]) {
      expect(source, `missing addEventListener("${type}", ...)`).toMatch(
        new RegExp(`canvasElement\\.addEventListener\\("${type}"`),
      );
    }
  });

  it("removes every pointer listener it adds — no leaked listeners across a remount", () => {
    for (const type of ["pointerdown", "pointermove", "pointerup", "pointerleave", "pointercancel"]) {
      expect(source, `missing removeEventListener("${type}", ...)`).toMatch(
        new RegExp(`canvasElement\\.removeEventListener\\("${type}"`),
      );
    }
  });

  it("suppresses hover raycasting while the pointer is down and past the drag threshold", () => {
    // The exact guard: pointermove returns before scheduling a raycast whenever pointerDownAt is
    // set — this is what stops an orbit drag from firing a hover pick every frame.
    expect(source).toMatch(/if \(pointerDownAt\) \{[\s\S]{0,300}return;/);
  });

  it("gates hover raycasts to at most one per animation frame (bounded cost)", () => {
    expect(source).toContain("hoverRafPending");
    expect(source).toMatch(/scheduleHoverPick[\s\S]{0,200}requestAnimationFrame/);
  });

  it("routes every click/tap through pickAt, never a raw scene traversal", () => {
    expect(source).toContain("controller.pickAt(");
    expect(source).not.toMatch(/root\.traverse[\s\S]{0,80}pointer/i);
  });

  it("binds a keyboard equivalent for cycling and selecting parts", () => {
    for (const key of ["]", "[", "Enter", "Escape"]) {
      expect(source, `no keyboard handling for ${JSON.stringify(key)}`).toContain(`case "${key}"`);
    }
  });

  it("documents the pointer and keyboard part-selection affordances in the accessible label", () => {
    expect(source).toMatch(/aria-label=\{[\s\S]{0,600}bracket/);
    expect(source).toMatch(/aria-label=\{[\s\S]{0,600}Escape/);
  });

  it("passes a vehicle slug through to resolve the semantic scene map", () => {
    expect(source).toContain("getSceneMapForVehicle(slug)");
  });
});

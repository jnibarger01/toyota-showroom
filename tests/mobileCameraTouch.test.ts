// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * #44 acceptance: accidental page scroll must not steal canvas drags on iOS Safari /
 * Android Chrome. That is enforced in CSS (`touch-action: none` on the canvas), not in a
 * pointer listener — once the browser has begun scrolling, `preventDefault` cannot take the
 * gesture back. This file guards the declaration so a stylesheet cleanup cannot delete it
 * without CI noticing.
 *
 * Gesture mapping itself (ONE=ROTATE, TWO=DOLLY_PAN, mobile damping) lives in
 * `tests/cameraController.test.ts` under "touch mapping and mobile damping (#44)".
 */
const GLOBALS_CSS = path.resolve(__dirname, "../app/globals.css");

describe("mobile canvas scroll lock (#44)", () => {
  const css = readFileSync(GLOBALS_CSS, "utf8");

  it("sets touch-action: none on the vehicle canvas element", () => {
    expect(css).toMatch(/\.vehicle-canvas\s*>\s*canvas\s*\{\s*touch-action:\s*none\s*;\s*\}/);
  });

  it("contains overscroll chaining and text selection while orbiting", () => {
    expect(css).toMatch(/\.vehicle-canvas\s*\{[^}]*overscroll-behavior:\s*contain/);
    expect(css).toMatch(/\.vehicle-canvas\s*\{[^}]*user-select:\s*none/);
  });
});

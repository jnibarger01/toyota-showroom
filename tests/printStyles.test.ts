// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const GLOBALS_CSS = path.resolve(__dirname, "../app/globals.css");
const css = readFileSync(GLOBALS_CSS, "utf8");
const printBlock = css.slice(css.lastIndexOf("@media print"));

describe("builder print stylesheet (#127)", () => {
  it("removes the WebGL canvas and stage chrome from print output", () => {
    expect(printBlock).toMatch(/\.vehicle-canvas[\s\S]*?display:\s*none\s*!important/);
    expect(printBlock).toMatch(/\.stage[\s\S]*?display:\s*none\s*!important/);
    expect(printBlock).toMatch(/\.stage-toolbar[\s\S]*?display:\s*none\s*!important/);
  });

  it("keeps the summary hidden on screen but visible for print", () => {
    expect(css).toMatch(/\.print-summary\s*\{\s*display:\s*none;\s*\}/);
    expect(printBlock).toMatch(/\.print-summary\s*\{[\s\S]*?display:\s*block\s*!important/);
  });

  it("keeps a light printable build summary and price cards", () => {
    expect(printBlock).toMatch(/\.print-summary[\s\S]*?display:\s*block\s*!important/);
    expect(printBlock).toContain(".comparison-card");
    expect(printBlock).toContain(".financing-card");
    expect(printBlock).toContain(".financing-disclaimer");
  });
});

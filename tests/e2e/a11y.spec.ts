import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * Automated accessibility regression gate for the routes a shopper actually uses (#42).
 *
 * Runs against the real static export, the same target as `visual.spec.ts` — production CSS and
 * bundling, not a dev build whose focus outlines and contrast can differ.
 *
 * ## What this can and cannot claim
 *
 * axe catches machine-checkable violations: contrast, missing names, bad ARIA, landmark and heading
 * structure. It cannot tell you the builder is *usable* without a mouse. That part is covered by
 * real interaction tests — `tests/e2e/partInteraction.spec.ts` drives the 3D stage from the keyboard
 * — and the two are complementary rather than redundant. Passing this file is not a claim that the
 * configurator is accessible; it is a claim that it has not regressed on the mechanical checks.
 *
 * ## Why serious/critical only
 *
 * axe's `minor` and `moderate` findings on a dense product UI are dominated by advisory rules that a
 * team can reasonably disagree with. A gate that fails on those gets disabled within a month, which
 * is worse than no gate. `serious` and `critical` are the tiers that map to a user being genuinely
 * blocked, so those fail the build and the rest are reported for information.
 *
 * ## Why the canvas is excluded
 *
 * `.vehicle-canvas` hosts a `<canvas>`. axe cannot inspect rendered pixels, and the keyboard
 * affordances that make the stage operable live on the host element and the surrounding toolbar,
 * which *are* scanned. Including it would produce a colour-contrast finding against a 3D render,
 * which is neither actionable nor meaningful.
 */

/** Rendering everything axe found, not just the first failure — one line per violation is the
 * difference between a fixable report and a puzzle. */
function formatViolations(violations: Awaited<ReturnType<AxeBuilder["analyze"]>>["violations"]): string {
  return violations
    .map((violation) => {
      const targets = violation.nodes.map((node) => `      ${node.target.join(" ")}`).join("\n");
      return `  [${violation.impact}] ${violation.id}: ${violation.help}\n    ${violation.helpUrl}\n${targets}`;
    })
    .join("\n\n");
}

const BLOCKING_IMPACTS = new Set(["serious", "critical"]);

async function scan(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .exclude(".vehicle-canvas")
    .analyze();

  const blocking = results.violations.filter((violation) => BLOCKING_IMPACTS.has(violation.impact ?? ""));
  const advisory = results.violations.filter((violation) => !BLOCKING_IMPACTS.has(violation.impact ?? ""));

  if (advisory.length > 0) {
    console.log(`axe: ${advisory.length} non-blocking finding(s)\n${formatViolations(advisory)}`);
  }

  expect(blocking, `serious/critical accessibility violations:\n\n${formatViolations(blocking)}`).toEqual([]);
}

test("explore lineup has no serious accessibility violations", async ({ page }) => {
  await page.goto("explore/");
  await page.waitForSelector(".vehicle-card");
  await scan(page);
});

test("compare table has no serious accessibility violations", async ({ page }) => {
  await page.goto("compare/?vehicles=4runner,tacoma,camry");
  await page.waitForSelector(".compare-table");
  await scan(page);
});

test("builder chrome has no serious accessibility violations", async ({ page }) => {
  await page.goto("4runner/");
  // The grade buttons and option catalog stay disabled until the scene-attach handshake resolves,
  // so scanning earlier would audit a skeleton rather than the interface a shopper operates.
  await page.waitForSelector(".vehicle-title h1");
  await page.waitForSelector("[data-testid='paint-studio']");
  await scan(page);
});

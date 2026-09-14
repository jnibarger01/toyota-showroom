import { expect, test } from "@playwright/test";

/**
 * Garage compare happy path (#76): pin two distinct builds, open compare from the garage,
 * and assert the builds-mode table exposes 2–4 slots plus at least one visible option delta.
 *
 * Mirrors `build-and-restore.spec.ts`: real static export, localStorage persistence (no Worker),
 * serial + long timeout because the builder loads a real ~57 MiB GLB before chrome is interactive.
 *
 * A second pin needs a *new* configuration id — re-saving the same id only refreshes the pin.
 * Switching grade calls `createConfiguration` + `attachScene` (same as Reset) but is easier to
 * observe via the active grade button, so we wait on that rather than racing Reset.
 */
test.describe.configure({ mode: "serial", timeout: 90_000 });

async function waitForAutosaveIdle(page: import("@playwright/test").Page): Promise<void> {
  await expect(page.getByRole("button", { name: /saving/i })).toHaveCount(0, { timeout: 10_000 });
}

test("garage compare shows 2–4 slots and a visible spec delta", async ({ page }) => {
  await page.goto("4runner/");

  await expect(page.getByTestId("persistence-mode-banner")).toBeVisible({ timeout: 15_000 });

  // Default grade is TRD Pro — Ice Cap is in its exterior set.
  const iceCap = page.getByRole("button", { name: "Ice Cap" });
  await expect(iceCap).toBeVisible();
  await iceCap.click();
  await expect(iceCap).toHaveAttribute("aria-pressed", "true");
  await waitForAutosaveIdle(page);

  await page.getByRole("button", { name: /^save build$/i }).click();
  await expect(page.locator(".garage-card")).toContainText(/pinned to garage|saved to your garage/i);

  // New configuration id (grade switch). Limited offers Barcelona Red Metallic.
  const limited = page.getByRole("button", { name: /Limited/i });
  await expect(limited).toBeEnabled({ timeout: 30_000 });
  await limited.click();
  await expect(limited).toHaveClass(/active/, { timeout: 15_000 });

  const barcelonaRed = page.getByRole("button", { name: "Barcelona Red Metallic" });
  await expect(barcelonaRed).toBeVisible();
  await barcelonaRed.click();
  await expect(barcelonaRed).toHaveAttribute("aria-pressed", "true");
  await waitForAutosaveIdle(page);

  await page.getByRole("button", { name: /^save build$/i }).click();
  await expect(page.locator(".garage-card")).toContainText(/pinned to garage|saved to your garage/i);

  await page.goto("garage/");
  await expect(page.getByTestId("garage-groups")).toBeVisible({ timeout: 15_000 });

  const cards = page.getByTestId("garage-build-card");
  await expect(cards).toHaveCount(2);

  for (const card of await cards.all()) {
    await card.getByRole("checkbox").check();
  }

  await expect(page.getByTestId("garage-compare-link")).toBeVisible();
  await page.getByTestId("garage-compare-link").click();

  await expect(page.getByTestId("build-compare-table")).toBeVisible({ timeout: 15_000 });

  const slots = page.getByTestId("compare-build-slot");
  const slotCount = await slots.count();
  expect(slotCount).toBeGreaterThanOrEqual(2);
  expect(slotCount).toBeLessThanOrEqual(4);

  const exteriorDelta = page.locator('[data-testid="compare-spec-delta"][data-category="paint"]');
  await expect(exteriorDelta).toBeVisible();
  await expect(exteriorDelta).toContainText("Ice Cap");
  await expect(exteriorDelta).toContainText("Barcelona Red Metallic");
});

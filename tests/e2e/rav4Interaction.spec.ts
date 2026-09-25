import { expect, test, type Page } from "@playwright/test";

/**
 * Live, non-mocked verification that the RAV4's production asset
 * (`public/models/rav4-2024/rav4_2024_limited_decoded.glb`, see `docs/RAV4_PROVENANCE.md`) actually
 * decodes in a real browser, resolves its catalog options, and supports direct-part selection —
 * the same category of proof `tests/e2e/model-integrity.spec.ts` and
 * `tests/e2e/partInteraction.spec.ts` already require for the 4Runner, applied to the second real
 * vehicle this app ships. Coordinates were found empirically (a throwaway probe script clicking
 * fractional canvas coordinates and logging `data-selected-part` against the real hero camera
 * framing in `lib/data/vehicles/rav4.ts`), the same method `partInteraction.spec.ts`'s own header
 * comment describes.
 */
test.describe.configure({ mode: "serial", timeout: 60_000 });

async function waitForSettledCanvas(page: Page) {
  await page.goto("rav4/");
  await expect(page.getByRole("button", { name: "Super White" })).toBeVisible({ timeout: 45_000 });
  await expect
    .poll(async () => page.locator("canvas").getAttribute("data-load-phase"), { timeout: 45_000 })
    .toBe("ready");
  return page.locator("canvas");
}

test("the RAV4's production GLB decodes and every catalog option resolves against it", async ({ page }) => {
  const warnings: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "warning" || message.type() === "error") warnings.push(message.text());
  });

  const assetResponses: Array<{ path: string; status: number }> = [];
  page.on("response", (response) => {
    const path = new URL(response.url()).pathname;
    if (path.endsWith(".glb")) assetResponses.push({ path, status: response.status() });
  });

  await waitForSettledCanvas(page);

  // Same substitution check `model-integrity.spec.ts` uses for the 4Runner: VehicleCanvas logs
  // this line before swapping in the procedural stand-in, so a completely broken GLB would not
  // silently pass as "loaded".
  expect(
    warnings.filter((line) => line.includes("High-detail glTF failed to load")),
    "the scene fell back to the procedural vehicle instead of decoding the shipped RAV4 GLB",
  ).toEqual([]);

  // Every real catalog option — paint targeting body.carmain, chrome trim targeting metal.chrome
  // (lib/data/options/rav4.ts), and the wheel-and-tyre packages mounted at the `MOUNT_WHEEL_*` rig
  // nodes (lib/data/options/runningGear.ts) — must resolve against the shipped asset. Unlike
  // the 4Runner's assertion, this file does NOT assert zero "is unavailable for this asset"
  // warnings: the scene map's 17 deliberately forward-declared parts (wheels, tires, doors,
  // mirrors, badge, grille, interior, roof — docs/RAV4_PROVENANCE.md §4) are expected to log
  // exactly that shape of warning from `buildSceneRegistry`, not from `verifyNodeContract` dropping
  // a real catalog option.
  expect(
    warnings.filter((line) => line.includes("is unavailable for this asset")),
    "a real RAV4 catalog option did not resolve against the shipped GLB",
  ).toEqual([]);

  const fetched = assetResponses.map((response) => response.path);
  expect(fetched.some((path) => path.endsWith("rav4_2024_limited_decoded.glb"))).toBe(true);
  expect(assetResponses.every((response) => response.status === 200)).toBe(true);
});

test("a paint selection applies to the decoded RAV4 model", async ({ page }) => {
  await waitForSettledCanvas(page);

  const paint = page.getByRole("button", { name: "Blueprint" });
  await expect(paint).toBeVisible();
  await expect(paint).not.toHaveAttribute("aria-pressed", "true");

  await paint.click();
  await expect(paint).toHaveAttribute("aria-pressed", "true");
});

test("fitting a wheel package puts wheels on a capture that ships without any", async ({ page }) => {
  // The RAV4 capture is a body shell: it has four empty `MOUNT_WHEEL_*` rig nodes and no wheel
  // geometry at all (docs/RAV4_PROVENANCE.md). A procedural package is the only thing that can give
  // this vehicle wheels, so this asserts on the rendered canvas rather than on `aria-pressed`
  // alone — a pressed button proves the selection was recorded, not that anything reached the scene.
  const canvas = await waitForSettledCanvas(page);

  await page.getByRole("button", { name: /Wheels & Tires/i }).click();

  const before = await canvas.screenshot();

  const wheels = page.getByRole("button", { name: "Off-Road Beadlock + All-Terrain" });
  await expect(wheels).toBeVisible();
  await expect(wheels).not.toHaveAttribute("aria-pressed", "true");
  await wheels.click();
  await expect(wheels).toHaveAttribute("aria-pressed", "true");

  await expect
    .poll(async () => (await canvas.screenshot()).equals(before), { timeout: 15_000 })
    .toBe(false);

  // Sidewall finish is a separate selection group, so it composes with the fitted package rather
  // than replacing it.
  const sidewall = page.getByRole("button", { name: "Raised White Letters" });
  await expect(sidewall).toBeVisible();
  await sidewall.click();
  await expect(sidewall).toHaveAttribute("aria-pressed", "true");
  await expect(wheels).toHaveAttribute("aria-pressed", "true");
});

test("clicking the RAV4's paint selects body.exterior specifically and shows the selection badge", async ({ page }) => {
  const canvas = await waitForSettledCanvas(page);
  const box = await canvas.boundingBox();
  if (!box) throw new Error("canvas has no bounding box");

  await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.45);

  await expect
    .poll(async () => canvas.getAttribute("data-selected-part"), { timeout: 5_000 })
    .toBe("body.exterior");
  await expect(page.locator(".selected-part-badge")).toBeVisible();
  await expect(page.locator(".selected-part-badge")).toContainText("Exterior paint");
});

test("clicking the RAV4's rear glass selects glass.rear-windshield specifically", async ({ page }) => {
  const canvas = await waitForSettledCanvas(page);
  const box = await canvas.boundingBox();
  if (!box) throw new Error("canvas has no bounding box");

  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);

  await expect
    .poll(async () => canvas.getAttribute("data-selected-part"), { timeout: 5_000 })
    .toBe("glass.rear-windshield");
});

test("dragging to orbit does not select a part", async ({ page }) => {
  const canvas = await waitForSettledCanvas(page);
  const box = await canvas.boundingBox();
  if (!box) throw new Error("canvas has no bounding box");

  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 80, cy + 40, { steps: 10 });
  await page.mouse.up();

  const selected = await canvas.getAttribute("data-selected-part");
  expect(selected === null || selected === "").toBe(true);
  await expect(page.locator(".selected-part-badge")).toHaveCount(0);
});

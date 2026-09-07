import { expect, test, type Page } from "@playwright/test";

/**
 * Live, non-mocked verification of Priority 1 (direct vehicle-part interaction): a real browser,
 * a real Draco-decoded GLB, a real `three-mesh-bvh` raycast against the real scene graph — nothing
 * here is stubbed. `tests/partInteraction.test.ts` covers the wiring's shape (jsdom cannot run
 * WebGL at all); this file is what actually proves clicking the canvas selects a part, dragging to
 * orbit does not, and clicking empty space clears the selection.
 *
 * `data-selected-part`/`data-hovered-part` (set by `VehicleCanvas.tsx`'s pointer handlers on the
 * canvas element itself) are the observation point — the same pattern `data-load-phase` and
 * `data-quality` already use elsewhere in this file's sibling specs, chosen because there is no
 * other way to read `VehicleSceneController`'s private state from outside the page.
 */
test.describe.configure({ mode: "serial", timeout: 60_000 });

async function waitForSettledCanvas(page: Page) {
  await page.goto("4runner/");
  await expect(page.getByRole("button", { name: "Barcelona Red Metallic" })).toBeVisible({ timeout: 45_000 });
  await expect
    .poll(async () => page.locator("canvas").getAttribute("data-load-phase"), { timeout: 45_000 })
    .toBe("ready");
  return page.locator("canvas");
}

test("clicking the vehicle selects a part and shows the selection badge", async ({ page }) => {
  const canvas = await waitForSettledCanvas(page);
  const box = await canvas.boundingBox();
  if (!box) throw new Error("canvas has no bounding box");

  // Centre of the viewport: the hero camera preset (lib/data/vehicles/4runner.ts) targets the
  // vehicle body, so the centre pixel is expected to land on it, not the floor/background.
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

  await expect
    .poll(async () => canvas.getAttribute("data-selected-part"), { timeout: 5_000 })
    .not.toBe("");
  await expect(page.locator(".selected-part-badge")).toBeVisible();
});

test("dragging to orbit does not select a part", async ({ page }) => {
  const canvas = await waitForSettledCanvas(page);
  const box = await canvas.boundingBox();
  if (!box) throw new Error("canvas has no bounding box");

  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  await page.mouse.move(cx, cy);
  await page.mouse.down();
  // Well past the 6px drag threshold VehicleCanvas.tsx uses to distinguish a click from an orbit.
  await page.mouse.move(cx + 80, cy + 40, { steps: 10 });
  await page.mouse.up();

  // No selection was ever made this test, so the attribute is absent or empty either way — the
  // meaningful assertion is that the drag itself did not populate it.
  const selected = await canvas.getAttribute("data-selected-part");
  expect(selected === null || selected === "").toBe(true);
  await expect(page.locator(".selected-part-badge")).toHaveCount(0);
});

test("clicking empty space clears a previous selection", async ({ page }) => {
  const canvas = await waitForSettledCanvas(page);
  const box = await canvas.boundingBox();
  if (!box) throw new Error("canvas has no bounding box");

  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect
    .poll(async () => canvas.getAttribute("data-selected-part"), { timeout: 5_000 })
    .not.toBe("");

  // Far corner of the stage: outside the vehicle's footprint at this camera framing (background/
  // grid, nothing registered in the SceneRegistry).
  await page.mouse.click(box.x + 6, box.y + 6);

  await expect
    .poll(async () => canvas.getAttribute("data-selected-part"), { timeout: 5_000 })
    .toBe("");
  await expect(page.locator(".selected-part-badge")).toHaveCount(0);
});

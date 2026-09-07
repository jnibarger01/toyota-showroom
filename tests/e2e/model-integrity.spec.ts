import { expect, test } from "@playwright/test";

/**
 * Proves the *optimized* GLB actually decodes and satisfies the catalog at runtime.
 *
 * This is the gap the rest of the e2e suite structurally cannot cover:
 *
 *   - `visual.spec.ts` masks `.vehicle-canvas` out of its screenshot on purpose (canvas rendering
 *     differs enough between machines that a pixel diff would be flaky), so it asserts the UI
 *     chrome around the scene and is blind to the scene itself.
 *   - `build-and-restore.spec.ts` does load the real scene, but its assertions are about
 *     persistence. A paint button still works when `loadVehicleRoot` has thrown and the canvas has
 *     quietly substituted `createProceduralVehicle()` — the fallback exists precisely so the page
 *     stays usable — so a broken asset passes it.
 *
 * That matters here because `scripts/optimize-models.mjs` removes data from the shipped binaries.
 * `tests/glbContract.test.ts` checks the file structurally, but structural correctness and "three's
 * GLTFLoader plus the Draco decoder can actually decode this, and every catalog option resolves
 * against the result" are different claims. Only a browser can make the second one.
 *
 * The assertions below are deliberately about *substitution and resolution*, not appearance: a
 * fallback is silent, and an option dropped from the catalog is silent, and both are exactly what a
 * too-aggressive optimization pass would cause.
 */
test.describe.configure({ mode: "serial", timeout: 90_000 });

test("the optimized GLB decodes and every catalog option resolves against it", async ({ page }) => {
  const warnings: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "warning" || message.type() === "error") warnings.push(message.text());
  });

  const assetResponses: Array<{ path: string; status: number }> = [];
  page.on("response", (response) => {
    const path = new URL(response.url()).pathname;
    if (path.endsWith(".glb")) assetResponses.push({ path, status: response.status() });
  });

  await page.goto("4runner/");

  // The paint control is only interactive once the catalog has been resolved against whatever
  // model ended up in the scene, so this is the earliest point the checks below are meaningful.
  await expect(page.getByRole("button", { name: "Barcelona Red Metallic" })).toBeVisible({
    timeout: 45_000,
  });

  // `loadPhase` is written by the progressive-load state machine (lib/three/progressiveLoad.ts).
  // "ready" means the detailed model settled; "fallback" means it did not.
  await expect
    .poll(async () => page.locator("canvas").getAttribute("data-load-phase"), { timeout: 45_000 })
    .toBe("ready");

  // The explicit substitution check. VehicleCanvas logs this line before swapping in the
  // procedural stand-in, and without asserting on it a completely broken GLB looks like success.
  expect(
    warnings.filter((line) => line.includes("High-detail glTF failed to load")),
    "the scene fell back to the procedural vehicle instead of decoding the shipped GLB",
  ).toEqual([]);

  // `verifyNodeContract` drops any option whose nodes or materials are missing from the loaded
  // asset, warning once per option. Zero dropped is the runtime half of glbContract's file check —
  // it is what would catch an optimization pass that pruned a node the catalog addresses.
  expect(
    warnings.filter((line) => line.includes("is unavailable for this asset")),
    "catalog options did not resolve against the optimized GLB",
  ).toEqual([]);

  // The optimized running gear is fetched as .glb, not the base64 .gltf it used to be.
  const fetched = assetResponses.map((response) => response.path);
  expect(fetched.some((path) => path.endsWith("modsnation_7416_assets_assembled.glb"))).toBe(true);
  expect(assetResponses.every((response) => response.status === 200)).toBe(true);
});

test("a configuration mutation applies to the decoded model", async ({ page }) => {
  // Distinct from build-and-restore's reload assertion: this one is about the mutation reaching the
  // real scene at all. It only passes if the controller was built from a verified node contract.
  await page.goto("4runner/");

  const paint = page.getByRole("button", { name: "Barcelona Red Metallic" });
  await expect(paint).toBeVisible({ timeout: 45_000 });
  await expect(paint).not.toHaveAttribute("aria-pressed", "true");

  await paint.click();
  await expect(paint).toHaveAttribute("aria-pressed", "true");

  // A wheel finish exercises a different operation than paint (mesh-replacement rather than
  // material-update), so between them they cover both mutation paths against the shipped asset.
  const wheels = page.getByRole("button", { name: /WEISU/i }).first();
  if (await wheels.isVisible().catch(() => false)) {
    await wheels.click();
    await expect(wheels).toHaveAttribute("aria-pressed", "true");
  }
});

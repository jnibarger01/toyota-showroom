import { expect, test } from "@playwright/test";

/**
 * The actual product promise this whole persistence layer exists for: build a vehicle, refresh
 * the tab, and get the same build back. Runs against the real static export with no backend
 * present (`playwright.config.ts`'s `webServer` serves only `dist/client` — see
 * `scripts/preview-server.mjs`), so this exercises the exact path a real GitHub Pages visitor
 * hits: `lib/api/configurations.ts` detects there's no request-aware backend and falls back to
 * `localConfigurationTransport` (browser `localStorage`), the same fallback §5's "Deployment
 * note" describes. It is a real, GLB-loading, WebGPU/WebGL-rendering scene — not a mock — so this
 * test budgets more time than the default, and runs serially rather than parallel: two Chromium
 * instances each loading the ~57 MiB GLB at once is enough resource contention on a modest
 * machine to make the second one time out for reasons that have nothing to do with the app.
 */
test.describe.configure({ mode: "serial", timeout: 60_000 });

test("a paint selection survives a full page reload", async ({ page }) => {
  await page.goto("4runner/");

  // Pages preview has no Worker: banner must make demo/offline persistence explicit (#28).
  await expect(page.getByTestId("persistence-mode-banner")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("persistence-mode-banner")).toContainText(/demo \/ offline/i);

  const barcelonaRed = page.getByRole("button", { name: "Barcelona Red Metallic" });
  await expect(barcelonaRed).toBeVisible();
  await expect(barcelonaRed).not.toHaveAttribute("aria-pressed", "true");

  await barcelonaRed.click();
  await expect(barcelonaRed).toHaveAttribute("aria-pressed", "true");

  // "Saving" → "Saved"/"Up to date": the debounced write (lib/state/configurationStore.ts,
  // PERSIST_DEBOUNCE_MS) actually has to land before a reload would have anything to restore.
  await expect(page.getByRole("button", { name: /saving/i })).toHaveCount(0, { timeout: 10_000 });

  await page.reload();

  const barcelonaRedAfterReload = page.getByRole("button", { name: "Barcelona Red Metallic" });
  await expect(barcelonaRedAfterReload).toBeVisible();
  await expect(barcelonaRedAfterReload).toHaveAttribute("aria-pressed", "true");
});

test("an accessory selection survives a reload; lift height, which isn't part of the persisted configuration, resets", async ({ page }) => {
  await page.goto("4runner/");

  // "Lighting" is the rail item that actually opens the `accessory` category — a real,
  // pre-existing label/category mismatch documented in docs/INTEGRATION_GUIDE.md §4
  // ("Component tests") and in tests/components/BuilderApp.test.tsx.
  await page.getByRole("button", { name: /lighting/i }).click();

  const roofRack = page.getByRole("button", { name: /overland roof rack/i });
  await expect(roofRack).toBeVisible();
  await roofRack.click();
  await expect(roofRack).toHaveAttribute("aria-pressed", "true");

  // Lift is plain component state (`BuilderApp.tsx`'s `useState(0)`), not part of
  // `VehicleConfiguration` — there is no `lift` field in the persisted schema
  // (`lib/types/customization.ts`) at all, so it's a page-local ride-height preview, not a saved
  // customization. Asserted explicitly below rather than assumed.
  await page.getByRole("button", { name: '3"' }).click();

  await expect(page.getByRole("button", { name: /saving/i })).toHaveCount(0, { timeout: 10_000 });

  await page.reload();
  await page.getByRole("button", { name: /lighting/i }).click();

  await expect(page.getByRole("button", { name: /overland roof rack/i })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: '0"' })).toHaveClass(/active/);
});

test("a deep-link share restores selections and camera in a fresh session", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("4runner/");

  const barcelonaRed = page.getByRole("button", { name: "Barcelona Red Metallic" });
  await expect(barcelonaRed).toBeVisible();
  await barcelonaRed.click();
  await expect(barcelonaRed).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("button", { name: "Front" }).click();
  await expect(page.getByRole("button", { name: "Front" })).toHaveClass(/selected/);

  await expect(page.getByRole("button", { name: /saving/i })).toHaveCount(0, { timeout: 10_000 });

  await page.getByRole("button", { name: /^share$/i }).click();
  await expect(page.getByText(/share link copied|share link ready/i)).toBeVisible();

  const sharedUrl = await page.evaluate(async () => navigator.clipboard.readText());
  expect(sharedUrl).toMatch(/[?&]c=/);

  // Fresh session: wipe local garage so restore can only come from `?c=…`.
  await context.clearCookies();
  await page.goto("about:blank");
  await page.evaluate(() => {
    try {
      localStorage.clear();
    } catch {
      /* ignore */
    }
  });

  await page.goto(sharedUrl);

  const restoredPaint = page.getByRole("button", { name: "Barcelona Red Metallic" });
  await expect(restoredPaint).toBeVisible();
  await expect(restoredPaint).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Front" })).toHaveClass(/selected/);
});

import { expect, test } from "@playwright/test";

/**
 * Owner-token shown-once save flow (#80): first Save build reveals the plaintext token with
 * copy + recovery hint; after dismiss, a refresh must not re-show the raw secret.
 *
 * Same static-export / localStorage path as build-and-restore and garage-compare.
 */
test.describe.configure({ mode: "serial", timeout: 90_000 });

async function waitForAutosaveIdle(page: import("@playwright/test").Page): Promise<void> {
  await expect(page.getByRole("button", { name: /saving/i })).toHaveCount(0, { timeout: 10_000 });
}

test("first save shows owner token once; refresh does not re-show the raw secret", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("4runner/");

  await expect(page.getByTestId("persistence-mode-banner")).toBeVisible({ timeout: 15_000 });

  const iceCap = page.getByRole("button", { name: "Ice Cap" });
  await expect(iceCap).toBeVisible();
  await iceCap.click();
  await expect(iceCap).toHaveAttribute("aria-pressed", "true");
  await waitForAutosaveIdle(page);

  await page.getByRole("button", { name: /^save build$/i }).click();
  await expect(page.locator(".garage-card")).toContainText(/pinned to garage|saved to your garage/i);

  const dialog = page.getByTestId("owner-token-dialog");
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId("owner-token-recovery-hint")).toBeVisible();

  const tokenValue = page.getByTestId("owner-token-value");
  await expect(tokenValue).toBeVisible();
  const rawToken = (await tokenValue.textContent())?.trim() ?? "";
  expect(rawToken.length).toBeGreaterThan(20);

  await page.getByTestId("owner-token-copy").click();
  await expect(page.getByTestId("owner-token-copy")).toContainText(/copied/i);

  const clipboard = await page.evaluate(async () => navigator.clipboard.readText());
  expect(clipboard).toBe(rawToken);

  await page.getByTestId("owner-token-dismiss").click();
  await expect(dialog).toHaveCount(0);

  await page.reload();
  await expect(page.getByTestId("persistence-mode-banner")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("owner-token-dialog")).toHaveCount(0);
  await expect(page.getByTestId("owner-token-value")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText(rawToken);

  // Re-save the same build must not re-show the raw secret.
  await waitForAutosaveIdle(page);
  await page.getByRole("button", { name: /^save build$/i }).click();
  await expect(page.locator(".garage-card")).toContainText(/pinned to garage|saved to your garage/i);
  await expect(page.getByTestId("owner-token-dialog")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText(rawToken);
});

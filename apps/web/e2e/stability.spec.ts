/**
 * Smoke checks that catch build-vs-server mismatches (stale bundle, missing
 * chunks) before the workflow tests run.
 */
import { test, expect } from "@playwright/test";

test("web shell loads without missing chunks or exceptions", async ({ page }) => {
  const failures: string[] = [];
  page.on("requestfailed", (request) => failures.push(`FAILED ${request.url()} ${request.failure()?.errorText}`));
  page.on("response", (response) => {
    if (response.status() === 404 && response.url().includes("_next/")) {
      failures.push(`404 ${response.url()}`);
    }
  });
  page.on("pageerror", (error) => failures.push(`PAGEERROR ${error.message}`));

  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Create your workspace|Sign in to your account|Manage your business/ })).toBeVisible({
    timeout: 20_000,
  });
  expect(failures).toEqual([]);
});

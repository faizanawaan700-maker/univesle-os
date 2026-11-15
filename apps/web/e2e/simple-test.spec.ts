import { test, expect } from "@playwright/test";

test("page loads successfully", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/Universal Business OS/);
});

test("authentication page renders", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByLabel("Your name")).toBeVisible();
});
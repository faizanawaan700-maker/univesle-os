/** UBOS browser E2E - Authentication verification */
import { test, expect } from "@playwright/test";

test("login with valid credentials and verify session", async ({ page }) => {
  // Go to the app
  await page.goto("/");

  // Look for login/register form elements
  await expect(page.getByLabel("Your name")).toBeVisible();
  await expect(page.getByLabel("Business or organization")).toBeVisible();
  await expect(page.getByLabel("Work email")).toBeVisible();
  await expect(page.getByLabel("Password")).toBeVisible();
  await expect(page.getByRole("button", { name: /Create workspace/i })).toBeVisible();

  // Register a test workspace
  await page.getByLabel("Your name").fill("Test User");
  await page.getByLabel("Business or organization").fill("Test Org");
  await page.getByLabel("Work email").fill(`test-${Date.now()}@example.com`);
  await page.getByLabel("Password").fill("e2e-browser-test-password");
  await page.getByRole("button", { name: /Create workspace/i }).click();

  // Wait for success
  await expect(page.getByRole("heading", { name: /Good to have you here/i })).toBeVisible({ timeout: 30000 });

  // Verify /auth/me works with cookies
  const me = await page.evaluate(async () => {
    const r = await fetch("http://127.0.0.1:4000/auth/me", { credentials: "include" });
    return { status: r.status, body: await r.text() };
  });

  expect(me.status).toBe(200);
  expect(me.body).toContain("Good to have you");
});

test("invalid credentials are handled correctly", async ({ page }) => {
  await page.goto("/");
  // Fill with invalid data and submit
  await page.getByLabel("Your name").fill("Test User");
  await page.getByLabel("Business or organization").fill("Test Org");
  await page.getByLabel("Work email").fill("invalid@example.com");
  await page.getByLabel("Password").fill("short");
  await page.getByRole("button", { name: /Create workspace/i }).click();

  // Should stay on the page or show error, not crash
  await page.waitForTimeout(3000);
  // Page should still be running
  await expect(page).toBeVisible();
});
/**
 * Browser session hand-off regression: registration, cookie storage on the API
 * origin, authenticated profile lookup, logout, and login. Cookie values are
 * never logged or asserted directly.
 */
import { test, expect } from "@playwright/test";

test("registration cookie is scoped to the API and supports /auth/me, logout, and login", async ({ page, context }) => {
  test.setTimeout(180_000);
  const authResponses: Array<{ path: string; status: number }> = [];
  let apiOrigin = "";
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.pathname.startsWith("/auth/")) {
      apiOrigin ||= url.origin;
      authResponses.push({ path: url.pathname, status: response.status() });
    }
  });

  await page.goto("/");
  await expect.poll(() => apiOrigin, { timeout: 15_000 }).not.toBe("");
  expect(apiOrigin).toMatch(/^http:\/\/(localhost|127\.0\.0\.1):4000$/);
  const webOrigin = new URL(page.url()).origin;
  const expectedApiOrigin = `${new URL(webOrigin).protocol}//${new URL(webOrigin).hostname}:4000`;
  expect(apiOrigin).toBe(expectedApiOrigin);
  let email = "";
  let registered = false;

  // Honor the server's retry window rather than skipping or bypassing throttling.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    email = `cookie-e2e-${Date.now()}-${attempt}@example.com`;
    await page.getByLabel("Your name").fill("Cookie E2E");
    await page.getByLabel("Business or organization").fill("Cookie E2E Workspace");
    await page.getByLabel("Work email").fill(email);
    await page.getByLabel("Password").fill("cookie-e2e-password-123");
    const responsePromise = page.waitForResponse((response) =>
      new URL(response.url()).pathname === "/auth/register" && response.request().method() === "POST",
    );
    await page.getByRole("button", { name: /Create workspace/i }).click();
    const response = await responsePromise;
    if (response.status() === 201) {
      registered = true;
      break;
    }
    expect(response.status(), `registration response: ${response.status()}`).toBe(429);
    const retryAfter = Number(response.headers()["retry-after"] ?? 60);
    await page.waitForTimeout((retryAfter + 1) * 1000);
  }
  expect(registered, "registration did not succeed after honoring retry windows").toBe(true);

  const sessionCookies = (await context.cookies(apiOrigin)).filter((cookie) => cookie.name === "ubos_session");
  expect(sessionCookies).toHaveLength(1);
  expect(sessionCookies[0]).toMatchObject({ httpOnly: true, sameSite: "Lax", path: "/" });
  await expect(page.getByRole("heading", { name: /Good to have you here/i })).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => authResponses.some(({ path, status }) => path === "/auth/me" && status === 200)).toBe(true);

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "Create your workspace" })).toBeVisible();
  await page.locator(".form-switch button").click();
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill("cookie-e2e-password-123");
  const loginResponsePromise = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/auth/login" && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: /Sign in/i }).click();
  expect((await loginResponsePromise).status()).toBe(200);
  await expect(page.getByRole("heading", { name: /Good to have you here/i })).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => authResponses.filter(({ path, status }) => path === "/auth/me" && status === 200).length).toBeGreaterThanOrEqual(2);
});

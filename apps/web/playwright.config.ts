import { defineConfig, devices } from "@playwright/test";

/**
 * Browser E2E configuration.
 *
 * Run through `npm run test:e2e` (see `e2e/run-e2e.ps1`), which starts the API on
 * 127.0.0.1:4000 and the web client on 127.0.0.1:3000 and rebuilds the web bundle
 * with `NEXT_PUBLIC_API_URL=http://127.0.0.1:4000`.
 *
 * Both origins use the same hostname, so the API session cookie (SameSite=Lax)
 * is first-party (same site) for the web page.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "retain-on-failure",
    viewport: { width: 1280, height: 900 },
  },
  projects: [{ name: "Chromium", use: { ...devices["Desktop Chrome"] } }],
});

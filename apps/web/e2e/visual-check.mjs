/**
 * Registers a workspace and captures the Analytics and Team tabs, plus any
 * console error, so the rendered result can be inspected rather than assumed.
 */
export default async function run(page, ui) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(`PAGEERROR ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`CONSOLE ${message.text()}`);
  });

  await page.goto("http://127.0.0.1:3000/");
  await page.getByLabel("Your name").fill("Visual Check");
  await page.getByLabel("Business or organization").fill("Visual Check Org");
  await page.getByLabel("Work email").fill(`visual-${Date.now()}@example.com`);
  await page.getByLabel("Password").fill("visual-check-password");
  await page.getByRole("button", { name: /Create workspace/i }).click();
  const heading = page.getByRole("heading", { name: /Manage your business/i });
  await heading.waitFor({ timeout: 30_000 }).catch(() => {});
  if (!(await heading.isVisible().catch(() => false))) {
    return {
      registered: false,
      body: (await page.evaluate(() => document.body.innerText)).slice(0, 400),
      errors,
    };
  }

  await page.getByRole("tab", { name: "Analytics" }).click();
  await page.waitForTimeout(2500);
  await page.screenshot({
    path: "e2e/artifacts/analytics.png",
    fullPage: true,
  });

  await page.getByRole("tab", { name: "Team" }).click();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: "e2e/artifacts/team.png", fullPage: true });

  return {
    registered: true,
    tabs: await page.getByRole("tab").allInnerTexts(),
    teamText: (await page.evaluate(() => document.body.innerText)).slice(
      0,
      600,
    ),
    errors,
  };
}

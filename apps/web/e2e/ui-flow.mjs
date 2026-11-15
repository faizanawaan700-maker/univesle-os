/**
 * Drives the real UI through the new tabs and returns diagnostics:
 * visible tab labels, a short text excerpt per tab, any runtime exception,
 * and whether the page fell into the generic error boundary.
 */
export default async function run(page) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(`PAGEERROR ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("401")) {
      errors.push(`CONSOLE ${message.text()}`);
    }
  });

  await page.goto("http://127.0.0.1:3000/");
  await page.getByLabel("Your name").fill("UI Flow");
  await page.getByLabel("Business or organization").fill("UI Flow Org");
  await page.getByLabel("Work email").fill(`ui-flow-${Date.now()}@example.com`);
  await page.getByLabel("Password").fill("ui-flow-password-123");
  await page.getByRole("button", { name: /Create workspace/i }).click();

  const heading = page.getByRole("heading", { name: /Manage your business/i });
  const registered = await heading
    .waitFor({ timeout: 30_000 })
    .then(() => true)
    .catch(() => false);
  if (!registered) {
    return {
      registered,
      alerts: await page.getByRole("alert").allInnerTexts(),
    };
  }

  const tabs = await page.getByRole("tab").allInnerTexts();
  const results = {};
  for (const tab of [
    "Products",
    "Inventory",
    "Sales",
    "Accounting",
    "Branches",
    "Team",
    "Analytics",
    "Audit history",
  ]) {
    if (!tabs.includes(tab)) {
      results[tab] = { skipped: "tab missing" };
      continue;
    }
    await page.getByRole("tab", { name: tab, exact: true }).click();
    await page.waitForTimeout(2200);
    const crashed = await page
      .getByText(/client-side exception/i)
      .isVisible()
      .catch(() => false);
    results[tab] = {
      crashed,
      excerpt: (await page.evaluate(() => document.body.innerText))
        .slice(0, 220)
        .replace(/\s+/g, " "),
    };
    if (crashed) break;
  }

  return { registered, tabs, results, errors };
}

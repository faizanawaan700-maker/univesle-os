/* Step 1: register only; report what the app shows and what the API returned. */
export default async function run(page) {
  const net = [];
  page.on("response", async (r) => {
    if (r.url().includes("4000")) {
      let body = "";
      try {
        body = (await r.text()).slice(0, 200);
      } catch {
        body = "<no body>";
      }
      net.push({ status: r.status(), method: r.request().method(), url: r.url(), body });
    }
  });

  const stamp = Date.now();
  await page.goto("http://localhost:3000/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector('input[name="email"]', { timeout: 45000 });
  await page.fill('input[name="name"]', "Step QA");
  await page.fill('input[name="organizationName"]', `Step QA Org ${stamp}`);
  await page.fill('input[name="email"]', `step.qa.${stamp}@example.com`);
  await page.fill('input[name="password"]', "ui-qa-password-12345");
  await page.getByRole("button", { name: /Create workspace/i }).click();
  await page.waitForTimeout(8000);
  return {
    net,
    url: page.url(),
    hasBusiness: (await page.locator("body").innerText()).includes("BUSINESS OPERATIONS"),
    tabs: await page.locator('[role="tab"]').allInnerTexts(),
    alerts: await page.locator('[role="alert"]').allInnerTexts(),
  };
}

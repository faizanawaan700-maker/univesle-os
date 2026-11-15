/* Step 2: register -> Products tab -> create. Report inputs, request bodies, results. */
export default async function run(page) {
  const net = [];
  page.on("response", async (r) => {
    if (r.url().includes("/business/products")) {
      let body = "";
      try {
        body = (await r.text()).slice(0, 240);
      } catch {
        body = "<no body>";
      }
      net.push({
        status: r.status(),
        method: r.request().method(),
        url: r.url(),
        sent: r.request().postData(),
        body,
      });
    }
  });

  const stamp = Date.now();
  const name = `Step2 Widget ${stamp}`;
  await page.goto("http://localhost:3000/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector('input[name="email"]', { timeout: 45000 });
  await page.fill('input[name="name"]', "Step2 QA");
  await page.fill('input[name="organizationName"]', `Step2 QA Org ${stamp}`);
  await page.fill('input[name="email"]', `step2.qa.${stamp}@example.com`);
  await page.fill('input[name="password"]', "ui-qa-password-12345");
  await page.getByRole("button", { name: /Create workspace/i }).click();
  await page.waitForSelector('[role="tab"]', { timeout: 45000 });

  await page.getByRole("tab", { name: "Products" }).first().click();
  await page.waitForTimeout(3000);
  const inputsAfterTab = await page
    .locator("input")
    .evaluateAll((els) => els.map((e) => ({ name: e.name, type: e.type, visible: !!e.offsetParent })));

  await page.fill('input[name="name"]', name);
  await page.fill('input[name="unitPrice"]', "42.50");
  await page.fill('input[name="costPrice"]', "30.00");
  await page.getByRole("button", { name: /Create product/i }).click();
  await page.waitForTimeout(6000);

  return {
    inputsAfterTab,
    net,
    alerts: await page.locator('[role="alert"], [role="status"]').allInnerTexts(),
    rows: await page.locator("tbody tr").count(),
    bodyHasName: (await page.locator("body").innerText()).includes(name),
  };
}

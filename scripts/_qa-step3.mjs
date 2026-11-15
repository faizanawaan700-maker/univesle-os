/* Step 3: does the create form submit at all? Report validity + payload attempt. */
export default async function run(page) {
  const net = [];
  page.on("request", (r) => {
    if (r.url().includes("/business/")) {
      net.push({ method: r.method(), url: r.url(), sent: r.postData() });
    }
  });

  const stamp = Date.now();
  const name = `Step3 Widget ${stamp}`;
  await page.goto("http://localhost:3000/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector('input[name="email"]', { timeout: 45000 });
  await page.fill('input[name="name"]', "Step3 QA");
  await page.fill('input[name="organizationName"]', `Step3 QA Org ${stamp}`);
  await page.fill('input[name="email"]', `step3.qa.${stamp}@example.com`);
  await page.fill('input[name="password"]', "ui-qa-password-12345");
  await page.getByRole("button", { name: /Create workspace/i }).click();
  await page.waitForSelector('[role="tab"]', { timeout: 45000 });
  await page.getByRole("tab", { name: "Products" }).first().click();
  await page.waitForTimeout(2500);

  const form = page.locator("form").filter({ has: page.locator('input[name="unitPrice"]') });
  const productName = form.locator('input[name="name"]').first();
  await productName.fill(name);
  await form.locator('input[name="unitPrice"]').fill("42.50");
  await form.locator('input[name="costPrice"]').fill("30.00");

  const before = await form.evaluate((f) => ({
    valid: f.checkValidity(),
    invalid: [...f.querySelectorAll("input")].map((i) => ({
      name: i.name,
      value: i.value,
      valid: i.checkValidity(),
      message: i.validationMessage,
    })),
  }));
  await form.getByRole("button", { name: /Create product/i }).click();
  await page.waitForTimeout(5000);
  const after = await form.evaluate((f) => ({
    values: [...f.querySelectorAll("input")].map((i) => ({ name: i.name, value: i.value })),
  }));
  return {
    name,
    before,
    after,
    net,
    alerts: await page.locator('[role="alert"], [role="status"], .alert').allInnerTexts(),
  };
}

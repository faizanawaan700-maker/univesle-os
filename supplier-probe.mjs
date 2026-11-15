export default async function run(page) {
  const logs = [];
  page.on("pageerror", (e) => logs.push("PAGEERROR " + e.message));
  page.on("response", async (r) => {
    const p = new URL(r.url()).pathname;
    if (
      p.startsWith("/business/suppliers") ||
      p.startsWith("/business/purchases")
    ) {
      logs.push(
        r.request().method() +
          " " +
          p +
          " " +
          r.status() +
          " :: " +
          (await r.text().catch(() => "")).slice(0, 150),
      );
    }
  });
  await page.waitForSelector("input[name=email]", { timeout: 30000 });
  await page.getByLabel("Your name").fill("Sup");
  await page.getByLabel("Business or organization").fill("Sup Org");
  await page.getByLabel("Work email").fill(`sup-${Date.now()}@example.com`);
  await page.getByLabel("Password").fill("sup-password-12345");
  await page.getByRole("button", { name: /Create workspace/i }).click();
  await page
    .getByRole("heading", { name: /Good to have you here/i })
    .waitFor({ timeout: 30000 });

  await page.getByRole("tab", { name: "Suppliers", exact: true }).click();
  await page.waitForTimeout(1500);
  const form = page.locator("form", {
    has: page.getByRole("heading", { name: "Add supplier" }),
  });
  logs.push("ADD_SUPPLIER_FORM=" + (await form.count()));
  await form.locator('input[name="name"]').fill("Probe Supplier");
  await form.getByRole("button", { name: /Create supplier/i }).click();
  await page.waitForTimeout(2500);
  logs.push(
    "SUPPLIER_CELL=" +
      (await page.getByRole("cell", { name: "Probe Supplier" }).count()),
  );

  await page.getByRole("tab", { name: "Purchases", exact: true }).click();
  await page.waitForTimeout(2000);
  const pf = page.locator("form", {
    has: page.getByRole("heading", { name: "Receive purchase invoice" }),
  });
  logs.push("PURCHASE_FORM=" + (await pf.count()));
  const opts = await pf
    .locator('select[name="supplierId"] option')
    .allInnerTexts()
    .catch(() => []);
  logs.push("SUPPLIER_OPTIONS=" + JSON.stringify(opts));
  return { logs };
}

export default async function run(page) {
  const logs = [];
  page.on("pageerror", (e) => logs.push("PAGEERROR " + e.message));
  page.on("response", async (r) => {
    const p = new URL(r.url()).pathname;
    if (
      p.startsWith("/business/purchases") &&
      r.request().method() === "POST"
    ) {
      logs.push(
        "POST purchases " +
          r.status() +
          " :: " +
          (await r.text().catch(() => "")).slice(0, 200),
      );
    }
  });
  await page.waitForSelector("input[name=email]", { timeout: 30000 });
  await page.getByLabel("Your name").fill("Pur");
  await page.getByLabel("Business or organization").fill("Pur Org");
  await page.getByLabel("Work email").fill(`pur-${Date.now()}@example.com`);
  await page.getByLabel("Password").fill("pur-password-12345");
  await page.getByRole("button", { name: /Create workspace/i }).click();
  await page
    .getByRole("heading", { name: /Good to have you here/i })
    .waitFor({ timeout: 30000 });

  // supplier
  await page.getByRole("tab", { name: "Suppliers", exact: true }).click();
  await page.waitForTimeout(1200);
  const sf = page.locator("form", {
    has: page.getByRole("heading", { name: "Add supplier" }),
  });
  await sf.locator('input[name="name"]').fill("Pur Supplier");
  await sf.getByRole("button", { name: /Create supplier/i }).click();
  await page.waitForTimeout(2000);

  // product
  await page.getByRole("tab", { name: "Products", exact: true }).click();
  await page.waitForTimeout(1200);
  await page.getByLabel("Product name").fill("Pur Product");
  await page.getByLabel("Selling price").fill("10.00");
  await page.getByLabel("Unit cost").fill("5.00");
  await page.getByRole("button", { name: /Create product/i }).click();
  await page.waitForTimeout(2000);

  // purchase
  await page.getByRole("tab", { name: "Purchases", exact: true }).click();
  await page.waitForTimeout(1500);
  const pf = page.locator("form", {
    has: page.getByRole("heading", { name: "Receive purchase invoice" }),
  });
  await pf
    .locator('select[name="supplierId"]')
    .selectOption({ label: "Pur Supplier" });
  await pf.locator('input[name="invoiceNumber"]').fill("SUP-1");
  await pf
    .locator('select[name="productId-0"]')
    .selectOption({ label: "Pur Product" });
  await pf.locator('input[name="quantity-0"]').fill("4");
  await pf.locator('input[name="unitCost-0"]').fill("5.00");
  logs.push(
    "ADD_LINE_COUNT=" +
      (await pf.getByRole("button", { name: /Add line/i }).count()),
  );
  await pf.getByRole("button", { name: /Add line/i }).click();
  await page.waitForTimeout(500);
  logs.push(
    "PRODUCT2_COUNT=" +
      (await pf.locator('select[name="productId-1"]').count()),
  );
  await pf
    .locator('select[name="productId-1"]')
    .selectOption({ label: "Pur Product" });
  await pf.locator('input[name="quantity-1"]').fill("2");
  await pf.locator('input[name="unitCost-1"]').fill("5.00");
  await pf.getByRole("button", { name: /^Receive invoice$/i }).click();
  await page.waitForTimeout(3000);
  logs.push(
    "BANNER=" + JSON.stringify(await page.locator(".alert").allInnerTexts()),
  );
  return { logs };
}

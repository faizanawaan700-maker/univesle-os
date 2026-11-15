export default async function run(page) {
  const logs = [];
  page.on("pageerror", (e) => logs.push("PAGEERROR " + e.message));
  page.on("response", async (r) => {
    const p = new URL(r.url()).pathname;
    if (p.startsWith("/business/sales") && r.request().method() === "POST") {
      logs.push(
        "POST sales " +
          r.status() +
          " :: " +
          (await r.text().catch(() => "")).slice(0, 180),
      );
    }
  });
  await page.waitForSelector("input[name=email]", { timeout: 30000 });
  await page.getByLabel("Your name").fill("Sale");
  await page.getByLabel("Business or organization").fill("Sale Org");
  await page.getByLabel("Work email").fill(`sale-${Date.now()}@example.com`);
  await page.getByLabel("Password").fill("sale-password-12345");
  await page.getByRole("button", { name: /Create workspace/i }).click();
  await page
    .getByRole("heading", { name: /Good to have you here/i })
    .waitFor({ timeout: 30000 });

  await page.getByRole("tab", { name: "Products", exact: true }).click();
  await page.waitForTimeout(1200);
  await page.getByLabel("Product name").fill("Sale Product");
  await page.getByLabel("Selling price").fill("10.00");
  await page.getByLabel("Unit cost").fill("5.00");
  await page.getByRole("button", { name: /Create product/i }).click();
  await page.waitForTimeout(1500);

  await page.getByRole("tab", { name: "Inventory", exact: true }).click();
  await page.waitForTimeout(1200);
  const inv = page.locator("form", {
    has: page.getByRole("heading", { name: "Adjust stock" }),
  });
  logs.push("ADJUST_FORM=" + (await inv.count()));
  await inv
    .locator('select[name="productId"]')
    .selectOption({ label: "Sale Product" });
  await inv.locator('input[name="quantityDelta"]').fill("10");
  await inv.getByRole("button", { name: /Record adjustment/i }).click();
  await page.waitForTimeout(2500);
  logs.push(
    "AFTER_ADJUST_ALERTS=" +
      JSON.stringify(await page.locator(".alert").allInnerTexts()),
  );

  await page.getByRole("tab", { name: "Sales", exact: true }).click();
  await page.waitForTimeout(1500);
  const sf = page.locator("form", {
    has: page.getByRole("heading", { name: "Create sales invoice" }),
  });
  logs.push("SALES_FORM=" + (await sf.count()));
  logs.push("P1=" + (await sf.locator('select[name="productId-0"]').count()));
  await sf
    .locator('select[name="productId-0"]')
    .selectOption({ label: "Sale Product" });
  await sf.locator('input[name="quantity-0"]').fill("2");
  logs.push(
    "ADDLINE=" + (await sf.getByRole("button", { name: /Add line/i }).count()),
  );
  await sf.getByRole("button", { name: /Add line/i }).click();
  await page.waitForTimeout(500);
  logs.push("P2=" + (await sf.locator('select[name="productId-1"]').count()));
  await sf
    .locator('select[name="productId-1"]')
    .selectOption({ label: "Sale Product" });
  await sf.locator('input[name="quantity-1"]').fill("3");
  await sf.getByRole("button", { name: /^Create invoice$/i }).click();
  await page.waitForTimeout(3000);
  logs.push(
    "FINAL_ALERTS=" +
      JSON.stringify(await page.locator(".alert").allInnerTexts()),
  );
  return { logs };
}

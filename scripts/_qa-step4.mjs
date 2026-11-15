/* Step 4: full Products workflow through the real UI, reported as evidence. */
export default async function run(page) {
  const steps = [];
  const net = [];
  page.on("response", (r) => {
    if (
      r.url().includes("/business/products") &&
      r.request().method() !== "GET"
    ) {
      net.push(
        `${r.request().method()} ${r.url().replace("http://localhost:4000", "")} -> ${r.status()}`,
      );
    }
  });

  const stamp = Date.now();
  const name = `UI Widget ${stamp}`;
  const renamed = `${name} Edited`;

  await page.goto("http://localhost:3000/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector('input[name="email"]', { timeout: 45000 });
  await page.fill('input[name="name"]', "Product QA");
  await page.fill('input[name="organizationName"]', `Product QA Org ${stamp}`);
  await page.fill('input[name="email"]', `product.qa.${stamp}@example.com`);
  await page.fill('input[name="password"]', "ui-qa-password-12345");
  await page.getByRole("button", { name: /Create workspace/i }).click();
  await page.waitForSelector('[role="tab"]', { timeout: 45000 });

  const openProducts = async () => {
    await page.getByRole("tab", { name: "Products" }).first().click();
    await page.waitForSelector('input[name="unitPrice"]', { timeout: 30000 });
    await page.waitForTimeout(1200);
  };
  await openProducts();
  steps.push({
    step: "empty-state",
    text: (await page.locator(".business-empty").innerText()).trim(),
  });

  // Create
  const form = page
    .locator("form")
    .filter({ has: page.locator('input[name="unitPrice"]') });
  await form.locator('input[name="name"]').first().fill(name);
  await form.locator('input[name="sku"]').fill(`UI-${stamp}`);
  await form.locator('input[name="unitPrice"]').fill("42.50");
  await form.locator('input[name="costPrice"]').fill("30.00");
  await form.getByRole("button", { name: /Create product/i }).click();
  try {
    await page
      .getByRole("cell", { name, exact: true })
      .waitFor({ state: "visible", timeout: 20000 });
  } catch {
    return {
      failedAt: "create",
      formValues: await form.evaluate((f) =>
        [...f.querySelectorAll("input")].map((i) => `${i.name}=${i.value}`),
      ),
      alerts: await page.locator('[role="alert"], [role="status"]').allInnerTexts(),
      mutations: net,
      body: (await page.locator("body").innerText()).slice(-600),
    };
  }
  steps.push({ step: "created", rows: await page.locator("tbody tr").count() });

  // Search
  await page.getByLabel("Search products").fill(`UI Widget ${stamp}`);
  await page.waitForTimeout(2500);
  steps.push({ step: "search", rows: await page.locator("tbody tr").count() });

  // Edit
  await page.getByRole("button", { name: `Edit ${name}` }).click();
  await page.waitForTimeout(800);
  const editForm = page
    .locator("form")
    .filter({ has: page.getByRole("button", { name: /Save changes/i }) });
  await editForm.locator('input[name="name"]').fill(renamed);
  await editForm.getByRole("button", { name: /Save changes/i }).click();
  await page
    .getByRole("button", { name: `Edit ${renamed}` })
    .waitFor({ state: "visible", timeout: 20000 });
  steps.push({
    step: "edited",
    notice: (await page.locator(".alert.success").innerText()).trim(),
  });

  // Reload persistence
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[role="tab"]', { timeout: 45000 });
  await openProducts();
  await page.getByLabel("Search products").fill(renamed);
  await page.waitForTimeout(2500);
  steps.push({
    step: "after-reload",
    persisted: (await page.locator("tbody").innerText()).includes(renamed),
    price: await page.locator("tbody tr td").nth(3).innerText(),
  });

  // Archive (confirm dialog)
  await page
    .getByRole("button", { name: /^Archive$/ })
    .first()
    .click();
  await page.waitForTimeout(600);
  steps.push({
    step: "confirm-open",
    dialog: (await page.locator('[role="alertdialog"]').innerText())
      .trim()
      .slice(0, 80),
  });
  await page.getByRole("button", { name: /^Archive product$/ }).click();
  await page.waitForTimeout(3000);
  steps.push({
    step: "archived",
    hiddenFromActive: !(await page.locator("tbody").innerText()).includes(
      renamed,
    ),
    notice: (await page.locator(".alert.success").innerText()).trim(),
  });

  // Restore through the archived filter
  await page.getByLabel("Include archived").check();
  await page.waitForTimeout(2500);
  const archivedRow = await page.locator("tbody tr").count();
  const statusCell = await page.locator("tbody tr td").nth(5).innerText();
  await page
    .getByRole("button", { name: /^Restore$/ })
    .first()
    .click();
  await page.waitForTimeout(3000);
  steps.push({
    step: "restored",
    archivedRowsShown: archivedRow,
    archivedStatus: statusCell,
    activeAgain: (await page.locator("tbody tr").first().innerText()).includes(
      "Active",
    ),
    notice: (await page.locator(".alert.success").innerText()).trim(),
  });

  await page.screenshot({ path: "products-ui-qa.png", fullPage: true });
  return { name: renamed, steps, mutations: net };
}

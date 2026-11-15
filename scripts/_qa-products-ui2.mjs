/* Browser QA for the Products UI, using the real form field names.
 * register -> Products tab -> create -> search -> edit -> reload -> archive -> restore */
export default async function run(page, ui) {
  const steps = [];
  const stamp = Date.now();
  const name = `QA Widget ${stamp}`;
  const renamed = `${name} Edited`;
  const email = `ui.qa.${stamp}@example.com`;
  const text = async () => page.locator("body").innerText();

  await page.goto("http://localhost:3000/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector('input[name="email"]', { timeout: 45000 });

  await page.fill('input[name="name"]', "UI QA");
  await page.fill('input[name="organizationName"]', `UI QA Org ${stamp}`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', "ui-qa-password-12345");
  await page.getByRole("button", { name: /Create workspace/i }).click();

  await page.waitForSelector('nav, [role="tablist"], #business-operations', {
    timeout: 45000,
  });
  steps.push({ step: "registered", url: page.url() });

  const productsTab = page.getByRole("tab", { name: "Products" });
  if (await productsTab.count()) await productsTab.first().click();
  else await page.getByText("Products", { exact: true }).first().click();

  await page.waitForSelector('input[name="unitPrice"]', { timeout: 30000 });
  steps.push({ step: "products-tab", loaded: true });

  // Create
  await page.fill('input[name="name"]', name);
  await page.fill('input[name="sku"]', `QA-${stamp}`);
  await page.fill('input[name="unitPrice"]', "42.50");
  await page.fill('input[name="costPrice"]', "30.00");
  await page.getByRole("button", { name: /Create product/i }).click();
  try {
    await page.waitForFunction(
      (n) => document.body.innerText.includes(n),
      { timeout: 12000 },
      name,
    );
  } catch {
    const alerts = await page
      .locator('[role="alert"], .alert, .error')
      .allInnerTexts();
    return {
      stage: "after-create",
      alerts,
      body: (await text()).slice(-1500),
      steps,
    };
  }
  steps.push({ step: "created", visible: true });

  // Search
  const search = page.getByLabel("Search products");
  await search.fill(name);
  await page.waitForTimeout(2000);
  const afterSearch = await text();
  steps.push({
    step: "search",
    rows: await page.locator("tbody tr").count(),
    hasProduct: afterSearch.includes(name),
  });

  // Edit
  await page.getByRole("button", { name: new RegExp(`^Edit ${name}`) }).click();
  await page.waitForTimeout(800);
  const editName = page.locator('form input[name="name"]').nth(1);
  await editName.fill(renamed);
  await page.getByRole("button", { name: /Save changes/i }).click();
  await page.waitForFunction(
    (n) => document.body.innerText.includes(n),
    { timeout: 30000 },
    renamed,
  );
  steps.push({ step: "edited", visible: true });

  // Reload persistence
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[role="tab"]', { timeout: 45000 });
  await page.getByRole("tab", { name: "Products" }).first().click();
  await page.waitForSelector('input[name="unitPrice"]', { timeout: 30000 });
  await page.getByLabel("Search products").fill(renamed);
  await page.waitForTimeout(2500);
  steps.push({ step: "reloaded", persisted: (await text()).includes(renamed) });

  // Archive
  await page
    .getByRole("button", { name: /^Archive$/ })
    .first()
    .click();
  await page.waitForTimeout(600);
  await page.getByRole("button", { name: /^Archive product$/ }).click();
  await page.waitForTimeout(2500);
  steps.push({
    step: "archived",
    hiddenFromActive: !(await text()).includes(renamed),
  });

  // Restore from the archived view
  await page.getByLabel("Include archived").check();
  await page.waitForTimeout(2500);
  const archivedVisible = (await text()).includes(renamed);
  await page
    .getByRole("button", { name: /^Restore$/ })
    .first()
    .click();
  await page.waitForTimeout(2500);
  steps.push({
    step: "restored",
    archivedVisible,
    activeAgain: (await text()).includes("Active"),
  });

  await page.screenshot({ path: "products-ui-qa.png", fullPage: true });
  return { email, name: renamed, steps };
}

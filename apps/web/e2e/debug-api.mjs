export default async function run(page) {
  await page.goto("http://localhost:3000/");
  await page.getByLabel("Your name").fill("Api User");
  await page.getByLabel("Business or organization").fill("Api Org");
  await page.getByLabel("Work email").fill(`api-${Date.now()}@example.com`);
  await page.getByLabel("Password").fill("api-browser-password");
  await page.getByRole("button", { name: /Create workspace/i }).click();
  await page.waitForTimeout(3000);

  return await page.evaluate(async () => {
    const orgs = await (await fetch("http://localhost:4000/organizations", { credentials: "include" })).json();
    const orgId = orgs[0].id;
    const h = { "X-Organization-Id": orgId };
    const products = await (await fetch("http://localhost:4000/business/products", { credentials: "include", headers: h })).json();
    const categories = await (await fetch("http://localhost:4000/business/categories", { credentials: "include", headers: h })).json();
    return {
      productsIsArray: Array.isArray(products),
      productsKeys: Array.isArray(products) ? null : Object.keys(products),
      productsSample: JSON.stringify(products).slice(0, 200),
      categoriesIsArray: Array.isArray(categories),
      categoriesSample: JSON.stringify(categories).slice(0, 200),
    };
  });
}

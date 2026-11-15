/* Diagnose the create-product click: capture the request that leaves the page. */
export default async function run(page) {
  const events = [];
  page.on("request", (r) => {
    if (r.url().includes("4000")) {
      events.push({ dir: "req", method: r.method(), url: r.url(), body: r.postData() });
    }
  });
  page.on("response", async (r) => {
    if (r.url().includes("4000")) {
      let body = "";
      try {
        body = (await r.text()).slice(0, 300);
      } catch {
        body = "<no body>";
      }
      events.push({ dir: "res", status: r.status(), url: r.url(), body });
    }
  });
  page.on("pageerror", (e) => events.push({ dir: "pageerror", message: String(e) }));

  const stamp = Date.now();
  await page.goto("http://localhost:3000/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector('input[name="email"]', { timeout: 45000 });
  await page.fill('input[name="name"]', "Net QA");
  await page.fill('input[name="organizationName"]', `Net QA Org ${stamp}`);
  await page.fill('input[name="email"]', `net.qa.${stamp}@example.com`);
  await page.fill('input[name="password"]', "ui-qa-password-12345");
  await page.getByRole("button", { name: /Create workspace/i }).click();
  await page.waitForSelector('input[name="unitPrice"]', { timeout: 45000 });
  await page.getByRole("tab", { name: "Products" }).first().click();
  await page.waitForSelector('input[name="unitPrice"]', { timeout: 30000 });

  const name = `Net Widget ${stamp}`;
  await page.fill('input[name="name"]', name);
  await page.fill('input[name="unitPrice"]', "42.50");
  await page.fill('input[name="costPrice"]', "30.00");
  events.push({ dir: "before-click", value: await page.inputValue('input[name="name"]') });
  await page.getByRole("button", { name: /Create product/i }).click();
  await page.waitForTimeout(6000);
  return { name, events, bodyTail: (await page.locator("body").innerText()).slice(-600) };
}

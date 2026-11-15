export default async function run(page) {
  const responses = [];
  const errors = [];
  page.on("response", (r) => {
    if (r.status() >= 400) responses.push({ url: r.url(), status: r.status() });
  });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.waitForSelector("input[name=email]", { timeout: 30000 });
  await page.waitForTimeout(500);
  return {
    body: (await page.locator("body").innerText()).slice(0, 700),
    alerts: await page.locator("[role=alert]").allInnerTexts(),
    registerButton: await page
      .getByRole("button", { name: /Create workspace/i })
      .isVisible(),
    responses,
    errors,
  };
}

export default async function run(page, ui) {
  const consoleErrors = [];
  const pageErrors = [];
  const failedRequests = [];
  const authResponses = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("requestfailed", (request) => failedRequests.push({ url: request.url(), failure: request.failure()?.errorText }));
  page.on("response", (response) => {
    if (/\/(auth\/|organizations\/current)/.test(new URL(response.url()).pathname)) {
      authResponses.push({ path: new URL(response.url()).pathname, status: response.status() });
    }
  });

  await page.goto("http://localhost:3000");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByLabel("Work email").fill("ubos-browser-qa-20261109@test.local");
  await page.getByLabel("Password").fill("UBOS-Disposable-QA-Only-20261109!");
  await page.getByRole("button", { name: /^Sign in/i }).click();

  const dashboard = await page.getByRole("heading", { name: /Good to have you here/i }).waitFor({ timeout: 30000 }).then(() => true).catch(() => false);
  const errorText = await page.locator("body").innerText();
  const businessUi = await page.getByRole("tab").allInnerTexts().catch(() => []);
  const businessSection = await page.getByRole("region", { name: "Business operations" }).count().catch(() => 0);
  if (businessUi.includes("Products")) {
    await page.getByRole("tab", { name: "Products" }).click();
    await page.getByRole("tabpanel").getByText(/Loading products/i).waitFor({ state: "hidden", timeout: 10000 }).catch(() => {});
  }
  return {
    dashboard,
    businessSection,
    businessUi,
    componentErrorPresent: /Element type is invalid: expected a string/.test(errorText) || pageErrors.some((e) => e.includes("Element type is invalid")),
    bodyExcerpt: errorText.slice(0, 1200),
    consoleErrors,
    pageErrors,
    failedRequests,
    authResponses,
    sessionCookieMetadata: (await page.context().cookies()).filter((c) => c.name === "ubos_session").map((c) => ({ name: c.name, domain: c.domain, httpOnly: c.httpOnly, sameSite: c.sameSite })),
  };
}

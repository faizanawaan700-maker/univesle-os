export default async function run(page) {
  const responses = [];
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("response", async (r) => {
    if (r.url().includes("/auth/")) {
      const h = r.headers();
      responses.push({
        path: new URL(r.url()).pathname,
        status: r.status(),
        allowOrigin: h["access-control-allow-origin"] ?? null,
        allowCredentials: h["access-control-allow-credentials"] ?? null,
        setCookiePresent: !!h["set-cookie"],
        setCookieAttrs: (h["set-cookie"] ?? "")
          .split(";")
          .slice(1)
          .map((x) => x.trim().split("=")[0]),
      });
    }
  });
  await page.waitForSelector("input[name=email]");
  await page.locator(".form-switch button").click();
  await page
    .getByLabel("Work email")
    .fill("browser-qa-1794384684871-382882@example.test");
  await page.getByLabel("Password").fill("browser-qa-password-123");
  await page.getByRole("button", { name: /Sign in/i }).click();
  await page.waitForTimeout(3000);
  const cookies = (await page.context().cookies("http://localhost:4000"))
    .filter((c) => c.name === "ubos_session")
    .map((c) => ({
      domain: c.domain,
      path: c.path,
      sameSite: c.sameSite,
      httpOnly: c.httpOnly,
      secure: c.secure,
      expires: c.expires,
    }));
  return {
    responses,
    cookies,
    body: (await page.locator("body").innerText()).slice(0, 600),
    errors,
    origin: await page.evaluate(() => location.origin),
  };
}

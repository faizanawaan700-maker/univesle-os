/**
 * Diagnostic: capture the exact Set-Cookie / Cookie exchange for register → me.
 * Run with: node <skill-dir>/browser.mjs http://127.0.0.1:3000 --script e2e/debug-auth.mjs
 * Output contains no session values, only header presence and cookie attributes.
 */
export default async function run(page) {
  const events = [];
  page.on("response", async (response) => {
    const url = response.url();
    if (!url.includes("/auth/")) return;
    const headers = response.headers();
    events.push({
      phase: "response",
      url,
      status: response.status(),
      setCookiePresent: Boolean(headers["set-cookie"]),
      setCookieAttributes: headers["set-cookie"]
        ? headers["set-cookie"].split(";").slice(1).map((part) => part.trim())
        : [],
    });
  });
  page.on("request", (request) => {
    if (!request.url().includes("/auth/")) return;
    const cookie = request.headers()["cookie"];
    events.push({
      phase: "request",
      url: request.url(),
      method: request.method(),
      origin: request.headers()["origin"] ?? null,
      hasCookieHeader: Boolean(cookie),
      cookieNames: cookie
        ? cookie.split(";").map((part) => part.split("=")[0].trim())
        : [],
    });
  });

  await page.goto("/");
  await page.getByLabel("Your name").fill("Auth Debug");
  await page.getByLabel("Business or organization").fill("Auth Debug Org");
  await page
    .getByLabel("Work email")
    .fill(`auth-debug-${Date.now()}@example.com`);
  await page.getByLabel("Password").fill("auth-debug-password-123");
  await page.getByRole("button", { name: /Create workspace/i }).click();
  await page.waitForTimeout(5000);

  const cookies = await page.context().cookies();
  return {
    pageOrigin: new URL(page.url()).origin,
    events,
    browserCookies: cookies.map((cookie) => ({
      name: cookie.name,
      domain: cookie.domain,
      path: cookie.path,
      sameSite: cookie.sameSite,
      secure: cookie.secure,
      httpOnly: cookie.httpOnly,
    })),
    bodySnippet: (await page.evaluate(() => document.body.innerText)).slice(
      0,
      400,
    ),
  };
}

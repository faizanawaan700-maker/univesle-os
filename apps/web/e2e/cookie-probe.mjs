/**
 * Isolates the cookie question from application code: register, then call
 * /auth/me directly against a diagnostic API from a page on the web origin.
 * Reports only cookie metadata, never token values.
 */
async function probe(page, apiOrigin) {
  return page.evaluate(async (origin) => {
    const email = `cookie-probe-${Date.now()}@example.com`;
    const body = JSON.stringify({
      email,
      password: "cookie-probe-password-123",
      name: "Cookie Probe",
      organizationName: "Cookie Probe Org",
    });
    const register = await fetch(`${origin}/auth/register`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body,
    });
    const me = await fetch(`${origin}/auth/me`, { credentials: "include" });
    return {
      registerStatus: register.status,
      meStatus: me.status,
      visibleDocumentCookie: document.cookie,
    };
  }, apiOrigin);
}

export default async function run(page) {
  const results = {};
  for (const origin of ["http://127.0.0.1:3000", "http://localhost:3000"]) {
    await page.goto(`${origin}/`);
    try {
      results[origin] = await probe(page, "http://127.0.0.1:4300");
    } catch (error) {
      results[origin] = { error: error.message };
    }
    results[`${origin}#cookies`] = (await page.context().cookies())
      .filter((cookie) => cookie.name === "ubos_session")
      .map((cookie) => ({ domain: cookie.domain, sameSite: cookie.sameSite, secure: cookie.secure }));
  }
  return results;
}

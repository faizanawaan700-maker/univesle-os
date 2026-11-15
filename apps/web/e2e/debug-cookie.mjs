export default async function run(page) {
  const log = [];
  page.on("response", async (res) => {
    if (res.url().includes("/auth/")) {
      log.push({
        url: res.url(),
        status: res.status(),
        setCookie: res.headers()["set-cookie"] ?? null,
      });
    }
  });

  await page.goto("http://localhost:3000/");
  await page.getByLabel("Your name").fill("Cookie User");
  await page.getByLabel("Business or organization").fill("Cookie Org");
  await page.getByLabel("Work email").fill(`cookie-${Date.now()}@example.com`);
  await page.getByLabel("Password").fill("cookie-browser-password");
  await page.getByRole("button", { name: /Create workspace/i }).click();
  await page.waitForTimeout(4000);

  const cookies = await page.context().cookies();
  const me = await page.evaluate(async () => {
    const r = await fetch("http://localhost:4000/auth/me", {
      credentials: "include",
    });
    return { status: r.status, body: (await r.text()).slice(0, 200) };
  });

  return {
    authResponses: log,
    cookies: cookies.map((c) => ({
      name: c.name,
      domain: c.domain,
      path: c.path,
      sameSite: c.sameSite,
      secure: c.secure,
      httpOnly: c.httpOnly,
    })),
    me,
    body: await page.evaluate(() => document.body.innerText.slice(0, 200)),
  };
}

export default async function run(page) {
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push("CONSOLE: " + msg.text());
  });
  page.on("pageerror", (err) =>
    errors.push("PAGEERROR: " + err.message + "\nSTACK: " + err.stack),
  );

  await page.goto("http://localhost:3000/");
  await page.getByLabel("Your name").fill("Debug User");
  await page.getByLabel("Business or organization").fill("Debug Org");
  await page.getByLabel("Work email").fill(`debug-${Date.now()}@example.com`);
  await page.getByLabel("Password").fill("debug-browser-password");
  await page.getByRole("button", { name: /Create workspace/i }).click();
  await page
    .getByRole("heading", { name: /Manage your business/i })
    .waitFor({ timeout: 30000 });

  errors.length = 0;
  await page.getByRole("tab", { name: "Products" }).click();
  await page.waitForTimeout(3000);

  const body = await page.evaluate(() => document.body.innerText.slice(0, 500));
  const cookies = await page.context().cookies();
  return { errors, body, cookies: cookies.map((c) => ({ name: c.name, domain: c.domain, path: c.path, sameSite: c.sameSite, secure: c.secure })) };
}

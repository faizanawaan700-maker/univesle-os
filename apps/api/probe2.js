// Temporary probe: why does the webhook-secret route answer 401 for a freshly
// registered organization while the same call succeeds for a newly created one?
const API = "http://127.0.0.1:4000";
const ORIGIN = "http://127.0.0.1:3000";

async function registerN(count) {
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const response = await fetch(`${API}/auth/register`, {
      method: "POST",
      headers: { origin: ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({
        email: `probe2-${Date.now()}-${i}@example.com`,
        password: "probe-password-1234",
        name: "Probe 2",
        organizationName: `Probe 2 Org ${Date.now()} ${i}`,
      }),
    });
    const cookie = (response.headers.get("set-cookie") ?? "").split(";")[0];
    out.push({
      status: response.status,
      cookie,
      body:
        response.status === 201 ? await response.json() : await response.text(),
    });
  }
  return out;
}

(async () => {
  const users = await registerN(3);
  for (const [index, user] of users.entries()) {
    if (user.status !== 201) {
      console.log(
        index,
        "register",
        user.status,
        String(user.body).slice(0, 120),
      );
      continue;
    }
    const organizationId = user.body.user.organizations[0].id;
    const secret = await fetch(`${API}/business/integrations/testpay/secret`, {
      method: "POST",
      headers: {
        origin: ORIGIN,
        cookie: user.cookie,
        "x-organization-id": organizationId,
      },
    });
    console.log(
      index,
      "secret",
      secret.status,
      (await secret.text()).slice(0, 120),
    );
  }
})();

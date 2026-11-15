// Temporary probe: register, then call the webhook-secret route and report the
// exact status and body so a 401 can be explained rather than guessed.
const API = "http://127.0.0.1:4000";
const ORIGIN = "http://127.0.0.1:3000";

(async () => {
  const register = await fetch(`${API}/auth/register`, {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({
      email: `probe-${Date.now()}@example.com`,
      password: "probe-password-1234",
      name: "Probe",
      organizationName: `Probe Org ${Date.now()}`,
    }),
  });
  const cookie = (register.headers.get("set-cookie") ?? "").split(";")[0];
  const body = await register.json();
  const organizationId = body.user.organizations[0].id;

  const secret = await fetch(`${API}/business/integrations/testpay/secret`, {
    method: "POST",
    headers: { origin: ORIGIN, cookie, "x-organization-id": organizationId },
  });
  console.log("secret status", secret.status, await secret.text());

  const events = await fetch(`${API}/business/integrations/events`, {
    headers: { origin: ORIGIN, cookie, "x-organization-id": organizationId },
  });
  console.log(
    "events status",
    events.status,
    (await events.text()).slice(0, 200),
  );
})();

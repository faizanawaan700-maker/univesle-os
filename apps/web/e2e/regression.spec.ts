/**
 * Cross-phase regression guards for work completed on 2026-11-08:
 * Phase 3 pagination/filters, Phase 4 accounting invariants, Phase 5 team
 * lifecycle and Phase 6 analytics. All requests are organization-scoped and
 * every organization is created fresh for this run.
 */
import { createHmac } from "node:crypto";
import { test, expect, request, type APIRequestContext } from "@playwright/test";



// NOTE: kept as a literal so this spec has no Node type dependency.
const API = "http://127.0.0.1:4000";
const ORIGIN = "http://127.0.0.1:3000";
const password = "regression-suite-password";

async function register(request: APIRequestContext, label: string) {
  const attemptRegister = (suffix: string) =>
    request.post(`${API}/auth/register`, {
      headers: { origin: ORIGIN },
      data: {
        email: `regression-${label}-${suffix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`,
        password,
        name: `Regression ${label}`,
        organizationName: `Regression Org ${label} ${suffix} ${Date.now()}`,
      },
    });

  // Registration is throttled to 8/minute per IP; wait out a 429 rather than
  // weakening the control. Each attempt must replace the previous response.
  let response = await attemptRegister("first");
  for (let attempt = 0; response.status() === 429 && attempt < 10; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 21_000));
    response = await attemptRegister(`retry${attempt}`);
  }
  expect(response.status(), await response.text()).toBe(201);
  const body = (await response.json()) as {
    user: { organizations: Array<{ id: string }> };
  };
  const organizationId = body.user.organizations[0].id;
  const cookie = (response.headers()["set-cookie"] ?? "").split(";")[0];
  return {
    organizationId,
    headers: { origin: ORIGIN, cookie, "x-organization-id": organizationId },
  };
}

// Each case registers its own organization, and the API throttles registration to
// 8/minute per IP. Helpers wait the window out, so the per-test budget must cover
// at least one throttle window (21s) plus the workload.
test.describe.configure({ mode: "serial" });
test.beforeEach(async ({}, testInfo) => {
  testInfo.setTimeout(testInfo.timeout + 180_000);
});

/**
 * A fresh request context per test, so cookies from one organization's session
 * can never leak into another organization's requests.
 */
async function newApi() {
  // An explicit, empty storage state prevents any cookie jar inherited from the
  // worker's fixture context from being replayed with these requests.
  return request.newContext({
    baseURL: API,
    storageState: { cookies: [], origins: [] },
    extraHTTPHeaders: { origin: ORIGIN },
  });
}

test("Phase 4: journal postings enforce exact, one-sided, balanced, active accounts", async ({
  request,
}) => {
  const ws = await register(request, "accounting");
  const create = async (
    code: string,
    type = "ASSET",
    normalBalance = "DEBIT",
  ) => {
    const response = await request.post(`${API}/business/accounts`, {
      headers: ws.headers,
      data: { code, name: `Account ${code}`, type, normalBalance },
    });
    expect(response.status()).toBe(201);
    return (await response.json()) as { id: string };
  };
  const cash = await create("1000");
  const equity = await create("3000", "EQUITY", "CREDIT");
  const closed = await create("4000", "REVENUE", "CREDIT");
  await request.patch(`${API}/business/accounts/${closed.id}`, {
    headers: ws.headers,
    data: { isActive: false },
  });

  const post = (lines: unknown[]) =>
    request.post(`${API}/business/journal-entries`, {
      headers: ws.headers,
      data: { description: "Regression entry", lines },
    });

  expect(
    (
      await post([{ accountId: cash.id, debit: "10.00", credit: "10.00" }])
    ).status(),
  ).toBe(400);
  expect(
    (
      await post([
        { accountId: cash.id, debit: "0.00", credit: "0.00" },
        { accountId: equity.id, debit: "0.00", credit: "0.00" },
      ])
    ).status(),
  ).toBe(400);
  expect(
    (
      await post([
        { accountId: cash.id, debit: "10.00", credit: "0.00" },
        { accountId: equity.id, debit: "0.00", credit: "9.00" },
      ])
    ).status(),
  ).toBe(400);
  expect(
    (
      await post([
        { accountId: closed.id, debit: "10.00", credit: "0.00" },
        { accountId: equity.id, debit: "0.00", credit: "10.00" },
      ])
    ).status(),
  ).toBe(400);
  expect(
    (
      await post([
        { accountId: cash.id, debit: 10.1, credit: 0 },
        { accountId: equity.id, debit: 0, credit: 10.1 },
      ])
    ).status(),
  ).toBe(400);

  const ok = await post([
    { accountId: cash.id, debit: "0.01", credit: "0.00" },
    { accountId: equity.id, debit: "0.00", credit: "0.01" },
  ]);
  expect(ok.status()).toBe(201);
  expect(((await ok.json()) as { total: string }).total).toBe("0.01");

  const page = await request.get(`${API}/business/journal-entries?limit=1`, {
    headers: ws.headers,
  });
  const body = (await page.json()) as {
    items: Array<{ status: string }>;
    hasMore: boolean;
    nextCursor: string | null;
  };
  expect(body.items).toHaveLength(1);
  expect(body.items[0].status).toBe("POSTED");
});

test("Phase 5: invitation lifecycle, role permissions and last-owner protection", async ({
  request,
}) => {
  const ws = await register(request, "team");
  const roles = (await (
    await request.get(`${API}/business/team/roles`, { headers: ws.headers })
  ).json()) as Array<{
    id: string;
    key: string;
  }>;
  const ownerRole = roles.find((role) => role.key === "owner")!;
  const limited = await request.post(`${API}/business/team/roles`, {
    headers: ws.headers,
    data: { name: "Viewer", key: "viewer", permissions: ["catalog.read"] },
  });
  expect(limited.status()).toBe(201);
  const viewerRole = (await limited.json()) as { id: string };

  const invitation = await request.post(`${API}/business/team/invitations`, {
    headers: ws.headers,
    data: { email: `invitee-${Date.now()}@example.com`, roleId: viewerRole.id },
  });
  expect(invitation.status()).toBe(201);
  const { token } = (await invitation.json()) as { token: string };

  const accepted = await request.post(`${API}/invitations/accept`, {
    headers: { origin: ORIGIN },
    data: { token, name: "Invited Viewer", password },
  });
  expect(accepted.status()).toBe(201);
  expect(
    ((await accepted.json()) as { organization: { role: string } }).organization
      .role,
  ).toBe("viewer");

  // Unknown permissions are rejected instead of silently dropped.
  const badRole = await request.post(`${API}/business/team/roles`, {
    headers: ws.headers,
    data: {
      name: "Bogus",
      key: "bogus",
      permissions: ["not.a.real.permission"],
    },
  });
  expect(badRole.status()).toBe(400);

  // The sole owner cannot be demoted.
  const members = (await (
    await request.get(`${API}/business/team/members`, { headers: ws.headers })
  ).json()) as {
    items: Array<{ id: string; role: { key: string } }>;
  };
  const owner = members.items.find((member) => member.role.key === "owner")!;
  const demoteResponse = await request.patch(
    `${API}/business/team/members/${owner.id}/role`,
    {
      headers: ws.headers,
      data: { roleId: viewerRole.id },
    },
  );
  expect(demoteResponse.status()).toBe(409);
  expect(ownerRole.key).toBe("owner");
});

test("Phase 6: analytics reconciles to stored invoices and separates predictions", async ({
  request,
}) => {
  const ws = await register(request, "analytics");
  const product = (await (
    await request.post(`${API}/business/products`, {
      headers: ws.headers,
      data: {
        name: "Analytics product",
        unitPrice: "12.50",
        costPrice: "7.00",
      },
    })
  ).json()) as { id: string };
  await request.post(`${API}/business/inventory/adjustments`, {
    headers: { ...ws.headers, "idempotency-key": `analytics-${Date.now()}` },
    data: { productId: product.id, quantityDelta: 10, reason: "count" },
  });
  const sale = await request.post(`${API}/business/sales`, {
    headers: {
      ...ws.headers,
      "idempotency-key": `analytics-sale-${Date.now()}`,
    },
    data: { items: [{ productId: product.id, quantity: 2 }] },
  });
  expect(sale.status()).toBe(201);

  const analytics = await request.get(
    `${API}/business/analytics?forecastDays=3`,
    { headers: ws.headers },
  );
  expect(analytics.status()).toBe(200);
  const body = (await analytics.json()) as {
    facts: { sales: { total: string; invoiceCount: number } };
    trends: { total: string };
    topProducts: Array<{ name: string; revenue: string }>;
    forecast: { generated: boolean; disclosure?: string };
    limitations: string[];
  };
  expect(body.facts.sales.total).toBe("25.00");
  expect(body.facts.sales.invoiceCount).toBe(1);
  expect(body.trends.total).toBe("25.00");
  expect(body.topProducts[0]).toMatchObject({
    name: "Analytics product",
    revenue: "25.00",
  });
  expect(body.forecast.generated).toBe(true);
  expect(body.forecast.disclosure).toMatch(/Prediction only/);
  expect(body.limitations.join(" ")).toMatch(
    /not an accounting-grade valuation/,
  );
});

test("Phase 3: movement ledger pages, filters and stays tenant-scoped", async ({
  request,
}) => {
  const ws = await register(request, "movements");
  const product = (await (
    await request.post(`${API}/business/products`, {
      headers: ws.headers,
      data: { name: "Movement product", unitPrice: "5.00", costPrice: "2.00" },
    })
  ).json()) as { id: string };
  for (const delta of [4, 3, 2]) {
    await request.post(`${API}/business/inventory/adjustments`, {
      headers: {
        ...ws.headers,
        "idempotency-key": `mv-${delta}-${Date.now()}`,
      },
      data: { productId: product.id, quantityDelta: delta, reason: "count" },
    });
  }
  const first = await request.get(
    `${API}/business/inventory/movements?limit=2`,
    { headers: ws.headers },
  );
  const firstPage = (await first.json()) as {
    items: Array<{ id: string }>;
    hasMore: boolean;
    nextCursor: string | null;
  };
  expect(firstPage.items).toHaveLength(2);
  expect(firstPage.hasMore).toBe(true);
  const second = await request.get(
    `${API}/business/inventory/movements?limit=2&cursor=${encodeURIComponent(firstPage.nextCursor!)}`,
    { headers: ws.headers },
  );
  const secondPage = (await second.json()) as {
    items: Array<{ id: string }>;
    hasMore: boolean;
  };
  expect(secondPage.items).toHaveLength(1);
  expect(secondPage.hasMore).toBe(false);
  expect(
    secondPage.items.some((row) =>
      firstPage.items.some((first) => first.id === row.id),
    ),
  ).toBe(false);

  const other = await register(request, "movements-other");
  const crossTenant = await request.get(`${API}/business/inventory/movements`, {
    headers: { ...other.headers, "x-organization-id": ws.organizationId },
  });
  expect(crossTenant.status()).toBe(403);
});

test("Phase 7/9: assistant is read-only, proposals never write, health endpoints answer", async ({ request }) => {
  const ws = await register(request, "assistant");
  const tools = await request.get(`${API}/business/assistant/tools`, { headers: ws.headers });
  expect(tools.status()).toBe(200);
  expect(((await tools.json()) as { writes: boolean }).writes).toBe(false);

  const answer = await request.post(`${API}/business/assistant/ask`, {
    headers: ws.headers,
    data: { intent: "sales_summary" },
  });
  expect(answer.status()).toBe(201);
  const body = (await answer.json()) as { readOnly: boolean; scope: string; organizationId: string };
  expect(body.readOnly).toBe(true);
  expect(body.scope).toBe("organization");
  expect(body.organizationId).toBe(ws.organizationId);

  // The tool allowlist rejects free-form intents rather than guessing.
  const unknown = await request.post(`${API}/business/assistant/ask`, {
    headers: ws.headers,
    data: { intent: "delete_everything" },
  });
  expect(unknown.status()).toBe(400);

  // A proposal is recorded and approved but never executed.
  const proposal = await request.post(`${API}/business/assistant/proposals`, {
    headers: ws.headers,
    data: { kind: "adjust_stock", rationale: "Reduce damaged units", payload: "{\"productId\":\"x\",\"quantityDelta\":-1}" },
  });
  expect(proposal.status()).toBe(201);
  const proposalBody = (await proposal.json()) as { id: string; status: string };
  expect(proposalBody.status).toBe("PENDING_APPROVAL");

  const approved = await request.post(
    `${API}/business/assistant/proposals/${proposalBody.id}/approve`,
    { headers: ws.headers, data: {} },
  );
  expect(approved.status()).toBe(201);
  expect(((await approved.json()) as { executed: boolean }).executed).toBe(false);

  const health = await request.get(`${API}/health/live`);
  expect(health.status()).toBe(200);
  const ready = await request.get(`${API}/health/ready`);
  expect(ready.status()).toBe(200);
  expect(((await ready.json()) as { database: string }).database).toBe("up");
});

test("Phase 8: webhook signatures, replay defense and localization settings", async () => {
  // A dedicated context so no earlier test's session cookie can be sent instead.
  const request = await newApi();
  try {
  const ws = await register(request, "integrations");
  // Webhook secrets are per organization and returned once.
  const created = await request.post(`${API}/business/integrations/testpay/secret`, {
    headers: ws.headers,
  });
  expect(created.status()).toBe(201);
  const secret = ((await created.json()) as { secret: string }).secret;
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const payload = JSON.stringify({ id: "evt_1", amount: 1000 });
  const signature = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");

  {
    // Unsigned calls are rejected before anything is stored.
    const unsigned = await request.post(`${API}/business/integrations/testpay/events`, {
      headers: ws.headers,
      data: { eventId: "evt_1", eventType: "payment.succeeded", payload },
    });
    expect([401, 403]).toContain(unsigned.status());

    const badSignature = await request.post(`${API}/business/integrations/testpay/events`, {
      headers: { ...ws.headers, "x-ubos-signature": "deadbeef", "x-ubos-timestamp": timestamp },
      data: { eventId: "evt_1", eventType: "payment.succeeded", payload },
    });
    expect([401, 403]).toContain(badSignature.status());

    const stale = await request.post(`${API}/business/integrations/testpay/events`, {
      headers: {
        ...ws.headers,
        "x-ubos-signature": createHmac("sha256", secret)
          .update(`${Number(timestamp) - 3600}.${payload}`)
          .digest("hex"),
        "x-ubos-timestamp": String(Number(timestamp) - 3600),
      },
      data: { eventId: "evt_1", eventType: "payment.succeeded", payload },
    });
    expect(stale.status()).toBe(401);

    const accepted = await request.post(`${API}/business/integrations/testpay/events`, {
      headers: { ...ws.headers, "x-ubos-signature": signature, "x-ubos-timestamp": timestamp },
      data: { eventId: "evt_1", eventType: "payment.succeeded", payload },
    });
    if (accepted.status() !== 201) {
      throw new Error(`accepted=${accepted.status()} body=${await accepted.text()} payload=${payload}`);
    }
    expect(accepted.status()).toBe(201);
    expect(((await accepted.json()) as { duplicate: boolean }).duplicate).toBe(false);

    // Replaying the identical delivery produces one stored event.
    const replay = await request.post(`${API}/business/integrations/testpay/events`, {
      headers: { ...ws.headers, "x-ubos-signature": signature, "x-ubos-timestamp": timestamp },
      data: { eventId: "evt_1", eventType: "payment.succeeded", payload },
    });
    const replayBody = (await replay.json()) as { duplicate?: boolean; statusCode?: number };
    expect(replayBody.duplicate === true || replay.status() === 409).toBe(true);

    const events = await request.get(`${API}/business/integrations/events`, { headers: ws.headers });
    const listed = (await events.json()) as { items: Array<{ eventId: string }> };
    expect(listed.items.filter((item) => item.eventId === "evt_1")).toHaveLength(1);

    // A different tenant sees none of these events.
    const other = await register(request, "integrations-other");
    const otherEvents = await request.get(`${API}/business/integrations/events`, { headers: other.headers });
    expect(((await otherEvents.json()) as { items: unknown[] }).items).toHaveLength(0);

    // Localization settings validate and persist per organization.
    const settings = await request.patch(`${API}/business/integrations/settings`, {
      headers: ws.headers,
      data: { locale: "en-GB", currencyCode: "EUR", timeZone: "Europe/Berlin" },
    });
    expect(settings.status()).toBe(200);
    expect(((await settings.json()) as { currencyCode: string }).currencyCode).toBe("EUR");
    const invalid = await request.patch(`${API}/business/integrations/settings`, {
      headers: ws.headers,
      data: { timeZone: "Mars/Olympus_Mons" },
    });
    expect(invalid.status()).toBe(400);
  }
  } finally {
    await request.dispose();
  }
});

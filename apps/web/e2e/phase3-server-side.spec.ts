/**
 * Phase 3 — server-side pagination, filters and scope, exercised through HTTP.
 *
 * These tests register unique organizations, so they are isolated and safe to
 * repeat against the local `ubos_development` database.
 */
import { test, expect, type APIRequestContext } from "@playwright/test";

const API = "http://127.0.0.1:4000";
const password = "phase3-browser-test-password";

type Workspace = { organizationId: string; headers: Record<string, string> };

async function registerWorkspace(
  request: APIRequestContext,
  label: string,
): Promise<Workspace> {
  // Registration is throttled (8/min/IP). Wait out a 429 instead of weakening
  // the production security control for tests.
  let response = await request.post(`${API}/auth/register`, {
    headers: { origin: "http://127.0.0.1:3000" },
    data: {
      email: `phase3-${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`,
      password,
      name: `Phase 3 ${label}`,
      organizationName: `Phase 3 Org ${label} ${Date.now()}`,
    },
  });
  for (let attempt = 0; response.status() === 429 && attempt < 8; attempt += 1) {
    const retryAfter = Number(response.headers()["retry-after"] ?? 15);
    await new Promise((resolve) => setTimeout(resolve, (retryAfter + 1) * 1000));
    response = await request.post(`${API}/auth/register`, {
      headers: { origin: "http://127.0.0.1:3000" },
      data: {
        email: `phase3-${label}-retry${attempt}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`,
        password,
        name: `Phase 3 ${label}`,
        organizationName: `Phase 3 Org ${label} ${Date.now()}`,
      },
    });
  }
  expect(response.status(), await response.text()).toBe(201);
  const body = (await response.json()) as {
    user: { organizations: Array<{ id: string }> };
  };
  const organizationId = body.user.organizations[0].id;
  const cookieHeader = response.headers()["set-cookie"] ?? "";
  const cookie = cookieHeader.split(";")[0];
  return {
    organizationId,
    headers: {
      origin: "http://127.0.0.1:3000",
      cookie,
      "x-organization-id": organizationId,
    },
  };
}

async function createProduct(
  request: APIRequestContext,
  workspace: Workspace,
  name: string,
) {
  const response = await request.post(`${API}/business/products`, {
    headers: workspace.headers,
    data: { name, unitPrice: "10.00", costPrice: "5.00" },
  });
  expect(response.status()).toBe(201);
  return (await response.json()) as { id: string };
}

test.describe("Phase 3 pagination and filters", () => {
  // Each case registers a fresh organization and registration is throttled to 8
  // per minute per IP, so the helper may wait out a full window before starting.
  test.beforeEach(async ({}, testInfo) => {
    testInfo.setTimeout(testInfo.timeout + 180_000);
  });
  test("products paginate without silent truncation and page two continues page one", async ({
    request,
  }) => {
    const workspace = await registerWorkspace(request, "products");
    const created: string[] = [];
    for (let index = 0; index < 7; index += 1) {
      created.push(
        (await createProduct(request, workspace, `Paged product ${index}`)).id,
      );
    }

    const first = await request.get(`${API}/business/products?limit=3`, {
      headers: workspace.headers,
    });
    expect(first.status()).toBe(200);
    const firstPage = (await first.json()) as {
      items: Array<{ id: string }>;
      hasMore: boolean;
      nextCursor: string | null;
    };
    expect(firstPage.items).toHaveLength(3);
    expect(firstPage.hasMore).toBe(true);
    expect(firstPage.nextCursor).toBeTruthy();

    const second = await request.get(
      `${API}/business/products?limit=3&cursor=${encodeURIComponent(firstPage.nextCursor!)}`,
      { headers: workspace.headers },
    );
    const secondPage = (await second.json()) as {
      items: Array<{ id: string }>;
      hasMore: boolean;
      nextCursor: string | null;
    };
    expect(secondPage.items).toHaveLength(3);
    const firstIds = firstPage.items.map((item) => item.id);
    expect(secondPage.items.some((item) => firstIds.includes(item.id))).toBe(
      false,
    );

    const third = await request.get(
      `${API}/business/products?limit=3&cursor=${encodeURIComponent(secondPage.nextCursor!)}`,
      { headers: workspace.headers },
    );
    const thirdPage = (await third.json()) as {
      items: Array<{ id: string }>;
      hasMore: boolean;
      nextCursor: string | null;
    };
    expect(thirdPage.items).toHaveLength(1);
    expect(thirdPage.hasMore).toBe(false);
    expect(thirdPage.nextCursor).toBeNull();
    const allIds = [
      ...firstIds,
      ...secondPage.items.map((i) => i.id),
      ...thirdPage.items.map((i) => i.id),
    ];
    expect(new Set(allIds).size).toBe(7);
    expect(created.every((id) => allIds.includes(id))).toBe(true);
  });

  test("stock movement history is paginated, filterable, and tenanted", async ({
    request,
  }) => {
    const workspace = await registerWorkspace(request, "movements");
    const product = await createProduct(request, workspace, "Movement product");
    for (const delta of [5, 3, -1]) {
      const response = await request.post(
        `${API}/business/inventory/adjustments`,
        {
          headers: {
            ...workspace.headers,
            "idempotency-key": `mv-${delta}-${Date.now()}-${Math.random()}`,
          },
          data: {
            productId: product.id,
            quantityDelta: delta,
            reason: "count",
          },
        },
      );
      expect(response.status()).toBe(201);
    }

    const page = await request.get(
      `${API}/business/inventory/movements?limit=2`,
      { headers: workspace.headers },
    );
    expect(page.status()).toBe(200);
    const body = (await page.json()) as {
      items: Array<{ id: string; reason: string }>;
      hasMore: boolean;
      nextCursor: string | null;
    };
    expect(body.items).toHaveLength(2);
    expect(body.hasMore).toBe(true);

    const filtered = await request.get(
      `${API}/business/inventory/movements?productId=${product.id}&reason=count&limit=10`,
      { headers: workspace.headers },
    );
    const filteredBody = (await filtered.json()) as {
      items: Array<{ reason: string }>;
    };
    expect(filteredBody.items.length).toBe(3);
    expect(filteredBody.items.every((item) => item.reason === "count")).toBe(
      true,
    );

    const otherWorkspace = await registerWorkspace(request, "movements-other");
    const crossTenant = await request.get(
      `${API}/business/inventory/movements`,
      {
        headers: {
          ...otherWorkspace.headers,
          "x-organization-id": workspace.organizationId,
        },
      },
    );
    expect(crossTenant.status()).toBe(403);
  });

  test("chart of accounts pages by code and journal entries page by recency", async ({
    request,
  }) => {
    const workspace = await registerWorkspace(request, "accounts");
    // The standard chart exists automatically once a document is posted, so this
    // test adds its own codes outside that range to prove pagination works for an
    // arbitrary number of accounts.
    for (const [code, name] of [
      ["9001", "Test cash"],
      ["9002", "Test payables"],
      ["9003", "Test equity"],
      ["9004", "Test sales"],
    ]) {
      const created = await request.post(`${API}/business/accounts`, {
        headers: workspace.headers,
        data: { code, name, type: "ASSET", normalBalance: "DEBIT" },
      });
      expect(created.status()).toBe(201);
    }

    const accounts = await request.get(`${API}/business/accounts?limit=2`, {
      headers: workspace.headers,
    });
    const accountPage = (await accounts.json()) as {
      items: Array<{ code: string }>;
      hasMore: boolean;
      nextCursor: string | null;
    };
    expect(accountPage.items.map((account) => account.code)).toEqual([
      "9001",
      "9002",
    ]);
    expect(accountPage.hasMore).toBe(true);

    const nextAccounts = await request.get(
      `${API}/business/accounts?limit=2&cursor=${encodeURIComponent(accountPage.nextCursor!)}`,
      { headers: workspace.headers },
    );
    const nextPage = (await nextAccounts.json()) as {
      items: Array<{ code: string }>;
    };
    expect(nextPage.items.map((account) => account.code)).toEqual([
      "9003",
      "9004",
    ]);

    // Resolve accounts by code across every page: the standard chart plus the
    // four test accounts span more than one page of results.
    const allAccounts: Array<{ id: string; code: string }> = [];
    let accountCursor: string | null = null;
    do {
      const response = await request.get(
        `${API}/business/accounts?limit=50${accountCursor ? `&cursor=${encodeURIComponent(accountCursor)}` : ""}`,
        { headers: workspace.headers },
      );
      const page = (await response.json()) as {
        items: Array<{ id: string; code: string }>;
        nextCursor: string | null;
      };
      allAccounts.push(...page.items);
      accountCursor = page.nextCursor;
    } while (accountCursor);
    const accountId = (code: string) => allAccounts.find((a) => a.code === code)?.id;
    // 9001 and 9003 were created above; the standard chart is also present.
    const debitAccount = accountId("9001") ?? accountId("1000");
    const creditAccount = accountId("9003") ?? accountId("3000");
    expect(debitAccount, "debit account must be resolvable").toBeTruthy();
    expect(creditAccount, "credit account must be resolvable").toBeTruthy();

    const created = await request.post(`${API}/business/journal-entries`, {
      headers: workspace.headers,
      data: {
        description: "Opening entry",
        lines: [
          { accountId: debitAccount, debit: "100", credit: "0" },
          { accountId: creditAccount, debit: "0", credit: "100" },
        ],
      },
    });
    expect(created.status()).toBe(201);

    const journals = await request.get(
      `${API}/business/journal-entries?limit=1&status=POSTED`,
      { headers: workspace.headers },
    );
    const journalPage = (await journals.json()) as {
      items: Array<{ description: string }>;
    };
    expect(journalPage.items).toHaveLength(1);
    expect(journalPage.items[0].description).toBe("Opening entry");
  });

  test("audit history supports action and entity filters within the tenant", async ({
    request,
  }) => {
    const workspace = await registerWorkspace(request, "audit");
    await createProduct(request, workspace, "Audit product");

    const filtered = await request.get(
      `${API}/business/audit?action=catalog.product_created`,
      {
        headers: workspace.headers,
      },
    );
    expect(filtered.status()).toBe(200);
    const body = (await filtered.json()) as {
      items: Array<{ action: string; entityType: string }>;
    };
    expect(body.items.length).toBeGreaterThan(0);
    expect(
      body.items.every((entry) => entry.action === "catalog.product_created"),
    ).toBe(true);

    const otherWorkspace = await registerWorkspace(request, "audit-other");
    const crossTenant = await request.get(
      `${API}/business/audit?action=catalog.product_created`,
      {
        headers: {
          ...otherWorkspace.headers,
          "x-organization-id": workspace.organizationId,
        },
      },
    );
    expect(crossTenant.status()).toBe(403);
  });
});

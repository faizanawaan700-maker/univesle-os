/**
 * Products end-to-end integration (real PostgreSQL, real Nest HTTP stack).
 *
 * Covers the full catalog lifecycle through the HTTP surface the UI uses:
 * create -> list -> search -> retrieve -> update -> reload -> soft delete ->
 * restore -> tenant isolation -> validation -> permission enforcement.
 *
 * A disposable organization is registered per run and every row it produced is
 * removed in `afterAll`; no pre-existing business data is touched.
 */
import { assertIntegrationDatabase } from "./test-support/assert-integration-database";

assertIntegrationDatabase();

import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import { database } from "@ubos/database";
import { AppModule } from "./app.module";

const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN ?? "http://localhost:3000";
const runId = randomUUID();
const emailPrefix = `ubos-phase2-products-${runId}`;
const password = "phase-two-products-password";

type SessionUser = {
  id: string;
  email: string;
  organizations: Array<{ id: string }>;
};

type Product = {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  unitPrice: string;
  costPrice: string;
  lowStockAt: number;
  isActive: boolean;
  category?: { id: string; name: string } | null;
  inventory?: { quantity: number } | null;
};

type Page = {
  items: Product[];
  nextCursor: string | null;
  hasMore: boolean;
};

let app: INestApplication | undefined;
let baseUrl: string;
const createdOrganizationIds: string[] = [];

async function request(
  path: string,
  method = "GET",
  options: { cookie?: string; organizationId?: string; body?: unknown } = {},
): Promise<Response> {
  const headers: Record<string, string> = { origin: FRONTEND_ORIGIN };
  if (options.cookie) headers.cookie = options.cookie;
  if (options.organizationId)
    headers["x-organization-id"] = options.organizationId;
  if (options.body !== undefined) headers["content-type"] = "application/json";
  return fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

async function register(
  email: string,
  organizationName: string,
): Promise<{ cookie: string; user: SessionUser }> {
  const response = await request("/auth/register", "POST", {
    body: { email, name: "Products Owner", organizationName, password },
  });
  const body = (await response.json()) as { user?: SessionUser };
  const cookie = (response.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  if (response.status !== 201 || !body.user)
    throw new Error(
      `Registration failed with status ${response.status}: ${JSON.stringify(body)}`,
    );
  for (const organization of body.user.organizations)
    createdOrganizationIds.push(organization.id);
  return { cookie, user: body.user };
}

beforeAll(async () => {
  await database.$connect();
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  app = moduleRef.createNestApplication();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await app.listen(0, "127.0.0.1");
  const address = app.getHttpServer().address();
  if (!address || typeof address === "string")
    throw new Error("Could not determine test address.");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  if (createdOrganizationIds.length > 0) {
    // Disposable organizations only; journals restrict accounts, so go in order.
    await database.journalEntryLine.deleteMany({
      where: {
        journalEntry: { organizationId: { in: createdOrganizationIds } },
      },
    });
    await database.journalEntry.deleteMany({
      where: { organizationId: { in: createdOrganizationIds } },
    });
    await database.account.deleteMany({
      where: { organizationId: { in: createdOrganizationIds } },
    });
    await database.organization.deleteMany({
      where: { id: { in: createdOrganizationIds } },
    });
    await database.user.deleteMany({
      where: { email: { startsWith: `${emailPrefix}-` } },
    });
  }
  await app?.close();
  await database.$disconnect();
});

describe("Products — real CRUD, isolation and soft delete", () => {
  const ownerEmail = `${emailPrefix}-owner@example.com`;

  let cookie: string;
  let organizationId: string;
  let outsiderCookie: string;
  let outsiderOrganizationId: string;
  let productId: string;
  const sku = `SKU-${runId.slice(0, 8)}`;

  it("creates a product with an opening inventory row", async () => {
    const owner = await register(ownerEmail, "Phase 2 Products Org");
    cookie = owner.cookie;
    organizationId = owner.user.organizations[0].id;

    const response = await request("/business/products", "POST", {
      cookie,
      organizationId,
      body: {
        name: `Integration Widget ${runId.slice(0, 6)}`,
        sku,
        barcode: `BC-${runId.slice(0, 8)}`,
        unitPrice: "125.50",
        costPrice: "80.25",
        lowStockAt: 3,
      },
    });
    expect(response.status).toBe(201);
    const product = (await response.json()) as Product;
    expect(product.id).toBeTruthy();
    expect(product.name).toContain("Integration Widget");
    expect(product.sku).toBe(sku);
    expect(String(product.unitPrice)).toBe("125.5");
    expect(product.isActive).toBe(true);
    productId = product.id;

    // Persistence is proven from the database, not from the response echo.
    const stored = await database.product.findFirst({
      where: { id: productId, organizationId },
      include: { inventory: true },
    });
    expect(stored).not.toBeNull();
    expect(stored?.organizationId).toBe(organizationId);
    expect(stored?.inventory?.quantity).toBe(0);
  });

  it("lists the product from the database", async () => {
    const response = await request("/business/products?limit=100", "GET", {
      cookie,
      organizationId,
    });
    expect(response.status).toBe(200);
    const page = (await response.json()) as Page;
    expect(Array.isArray(page.items)).toBe(true);
    expect(page.items.some((item) => item.id === productId)).toBe(true);
  });

  it("finds the product by name search", async () => {
    const response = await request(
      `/business/products?search=${encodeURIComponent(sku)}`,
      "GET",
      { cookie, organizationId },
    );
    expect(response.status).toBe(200);
    const page = (await response.json()) as Page;
    expect(page.items.map((item) => item.id)).toEqual([productId]);
  });

  it("retrieves the product by id", async () => {
    const response = await request(`/business/products/${productId}`, "GET", {
      cookie,
      organizationId,
    });
    expect(response.status).toBe(200);
    const product = (await response.json()) as Product;
    expect(product.id).toBe(productId);
    expect(product.sku).toBe(sku);
  });

  it("updates the product and persists the change", async () => {
    const response = await request(`/business/products/${productId}`, "PATCH", {
      cookie,
      organizationId,
      body: { name: "Integration Widget Renamed", unitPrice: "99.99" },
    });
    expect(response.status).toBe(200);

    const stored = await database.product.findFirst({
      where: { id: productId, organizationId },
    });
    expect(stored?.name).toBe("Integration Widget Renamed");
    expect(String(stored?.unitPrice)).toBe("99.99");
    // Omitted fields must stay untouched (PATCH semantics).
    expect(String(stored?.costPrice)).toBe("80.25");
    expect(stored?.sku).toBe(sku);

    // A fresh read (simulates the reloaded page) returns the new values.
    const reload = await request(`/business/products/${productId}`, "GET", {
      cookie,
      organizationId,
    });
    expect(((await reload.json()) as Product).name).toBe(
      "Integration Widget Renamed",
    );
  });

  it("keeps the product invisible to another organization", async () => {
    const outsider = await register(
      `outsider.${runId.slice(0, 8)}.${Date.now()}@example.com`,
      "Phase 2 Outsider Org",
    );
    outsiderCookie = outsider.cookie;
    outsiderOrganizationId = outsider.user.organizations[0].id;

    const read = await request(`/business/products/${productId}`, "GET", {
      cookie: outsiderCookie,
      organizationId: outsiderOrganizationId,
    });
    expect(read.status).toBe(404);

    const list = await request("/business/products?limit=100", "GET", {
      cookie: outsiderCookie,
      organizationId: outsiderOrganizationId,
    });
    const page = (await list.json()) as Page;
    expect(page.items.some((item) => item.id === productId)).toBe(false);

    const write = await request(`/business/products/${productId}`, "PATCH", {
      cookie: outsiderCookie,
      organizationId: outsiderOrganizationId,
      body: { name: "Hijacked" },
    });
    expect(write.status).toBe(404);

    const stored = await database.product.findFirst({
      where: { id: productId },
    });
    expect(stored?.name).toBe("Integration Widget Renamed");
  });

  it("rejects invalid payloads with 400", async () => {
    const blank = await request("/business/products", "POST", {
      cookie,
      organizationId,
      body: { name: "   ", unitPrice: "1.00", costPrice: "0.50" },
    });
    expect(blank.status).toBe(400);

    const badMoney = await request("/business/products", "POST", {
      cookie,
      organizationId,
      body: { name: "Bad Money", unitPrice: "12.123", costPrice: "1.00" },
    });
    expect(badMoney.status).toBe(400);

    const missingPrice = await request("/business/products", "POST", {
      cookie,
      organizationId,
      body: { name: "No Price" },
    });
    expect(missingPrice.status).toBe(400);

    const unknownField = await request("/business/products", "POST", {
      cookie,
      organizationId,
      body: {
        name: "Unknown Field",
        unitPrice: "1.00",
        costPrice: "0.50",
        organizationId: "should-not-be-here",
      },
    });
    // A tenant id smuggled in the body must be rejected, never honoured.
    expect(unknownField.status).toBe(400);

    const otherUnknownField = await request("/business/products", "POST", {
      cookie,
      organizationId,
      body: { name: "Other Unknown", unitPrice: "1.00", costPrice: "0.5", bogus: true },
    });
    expect(otherUnknownField.status).toBe(400);

    const created = await database.product.count({
      where: { organizationId, name: { in: ["Unknown Field", "Other Unknown"] } },
    });
    expect(created).toBe(0);
  });

  it("rejects a duplicate SKU with 409 and keeps the original", async () => {
    const duplicate = await request("/business/products", "POST", {
      cookie,
      organizationId,
      body: {
        name: "Duplicate SKU",
        sku,
        unitPrice: "5.00",
        costPrice: "1.00",
      },
    });
    expect(duplicate.status).toBe(409);

    const count = await database.product.count({
      where: { organizationId, sku },
    });
    expect(count).toBe(1);
  });

  it("archives, hides from the catalog, and restores the product", async () => {
    const response = await request(
      `/business/products/${productId}/archive`,
      "POST",
      { cookie, organizationId },
    );
    expect(response.status).toBe(201);
    expect(((await response.json()) as Product).isActive).toBe(false);

    const stored = await database.product.findFirst({
      where: { id: productId },
    });
    expect(stored).not.toBeNull(); // retained for history
    expect(stored?.isActive).toBe(false);

    const activeList = await request("/business/products?limit=100", "GET", {
      cookie,
      organizationId,
    });
    const activePage = (await activeList.json()) as Page;
    expect(activePage.items.some((item) => item.id === productId)).toBe(false);

    const archived = await request(
      "/business/products?limit=100&includeInactive=true",
      "GET",
      { cookie, organizationId },
    );
    const archivedPage = (await archived.json()) as Page;
    expect(archivedPage.items.some((item) => item.id === productId)).toBe(true);

    const restore = await request(
      `/business/products/${productId}/restore`,
      "POST",
      { cookie, organizationId },
    );
    expect(restore.status).toBe(201);
    expect(((await restore.json()) as Product).isActive).toBe(true);

    // Restored products return to the default catalog view.
    const restoredList = await request("/business/products?limit=100", "GET", {
      cookie,
      organizationId,
    });
    expect(
      ((await restoredList.json()) as Page).items.some((i) => i.id === productId),
    ).toBe(true);

    // Archive/restore are audited, never a silent flip.
    const actions = await database.auditLog.findMany({
      where: { organizationId, entityType: "product", entityId: productId },
      select: { action: true },
    });
    expect(actions.map((a) => a.action)).toEqual(
      expect.arrayContaining([
        "catalog.product_created",
        "catalog.product_updated",
        "catalog.product_archived",
        "catalog.product_restored",
      ]),
    );
  });

  it("rejects requests without an organization scope", async () => {
    // OrganizationScopeGuard owns this: no `X-Organization-Id` is a 403, not a
    // silent fallback to "whatever organization the user happens to have".
    const response = await request("/business/products", "GET", { cookie });
    expect(response.status).toBe(403);

    const write = await request("/business/products", "POST", {
      cookie,
      body: { name: "No Scope", unitPrice: "1.00", costPrice: "1.00" },
    });
    expect(write.status).toBe(403);
  });
});

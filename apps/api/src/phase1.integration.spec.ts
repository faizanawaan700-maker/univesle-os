import { assertIntegrationDatabase } from "./test-support/assert-integration-database";

assertIntegrationDatabase();

import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { createHash, randomUUID } from "node:crypto";
import { database } from "@ubos/database";
import { AppModule } from "./app.module";

const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN ?? "http://localhost:3000";
const runId = randomUUID();
const emailPrefix = `ubos-integration-${runId}-`;
const password = "phase-one-integration-test-password";

type RegisteredUser = {
  status: number;
  message?: string | string[];
  user: {
    id: string;
    email: string;
    name: string;
    organizations: Array<{ id: string; name: string; role: string }>;
  };
  cookie: string;
  token: string;
  cookieHeader: string;
};

let app: INestApplication | undefined;
let baseUrl: string;
let connected = false;
let cleanupNeeded = false;
const createdOrganizationIds: string[] = [];
let owner: RegisteredUser;

async function request(
  path: string,
  method = "GET",
  options: { cookie?: string; organizationId?: string; body?: unknown; idempotencyKey?: string } = {},
): Promise<Response> {
  const headers: Record<string, string> = { origin: FRONTEND_ORIGIN };
  if (options.cookie) headers.cookie = options.cookie;
  if (options.organizationId) headers["x-organization-id"] = options.organizationId;
  if (options.idempotencyKey) headers["idempotency-key"] = options.idempotencyKey;
  else if (["/business/sales", "/business/purchases", "/business/payments", "/business/inventory/adjustments"].includes(path)) {
    headers["idempotency-key"] = randomUUID();
  }
  if (options.body !== undefined) headers["content-type"] = "application/json";

  return fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

async function register(email: string, name: string, organizationName: string) {
  let response = await request("/auth/register", "POST", {
    body: { email, name, organizationName, password },
  });
  // Registration is throttled to 8 requests/minute per IP. Integration runs
  // legitimately create many fresh accounts, so wait out the throttle window
  // instead of disabling the production control.
  for (let attempt = 0; response.status === 429 && attempt < 10; attempt += 1) {
    const retryAfter = Number(response.headers.get("retry-after") ?? 15);
    await new Promise((resolve) => setTimeout(resolve, (retryAfter + 1) * 1000));
    response = await request("/auth/register", "POST", {
      body: { email: email.replace("@", `-retry${attempt}@`), name, organizationName, password },
    });
  }
  const body = (await response.json()) as { user?: RegisteredUser["user"]; message?: string | string[] };
  const cookieHeader = response.headers.get("set-cookie") ?? "";
  const cookie = cookieHeader.split(";")[0] ?? "";
  const separator = cookie.indexOf("=");
  const token =
    separator < 0 ? "" : decodeURIComponent(cookie.slice(separator + 1));

  if (response.status === 201) {
    cleanupNeeded = true;
    for (const organization of body.user?.organizations ?? []) {
      createdOrganizationIds.push(organization.id);
    }
  }

  return {
    status: response.status,
    user: body.user as RegisteredUser["user"],
    message: body.message,
    cookie,
    token,
    cookieHeader,
  } satisfies RegisteredUser;
}

// This suite makes real HTTP calls and may wait out the registration throttle
// (8 signups/minute per IP), so the default 5s per-test budget is too small.
jest.setTimeout(120_000);

beforeAll(async () => {
  await database.$connect();
  connected = true;
  const target = await database.$queryRaw<Array<{ database_name: string }>>`
    SELECT current_database() AS database_name
  `;
  if (target[0]?.database_name !== "ubos_development") {
    throw new Error("Connected database does not match the dedicated ubos_development target.");
  }

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
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
  if (!address || typeof address === "string") {
    throw new Error("Could not determine the integration API's local address.");
  }
  baseUrl = `http://127.0.0.1:${address.port}`;

  owner = await register(
    `${emailPrefix}owner@example.com`,
    "Integration Owner",
    "Integration Organization",
  );
});

afterAll(async () => {
  if (app) await app.close();
  if (connected && cleanupNeeded) {
    // Accounting rows must be removed before organizations (Restrict FK on account).
    await database.journalEntryLine.deleteMany({
      where: { journalEntry: { organizationId: { in: createdOrganizationIds } } },
    });
    await database.journalEntry.deleteMany({
      where: { organizationId: { in: createdOrganizationIds } },
    });
    await database.account.deleteMany({
      where: { organizationId: { in: createdOrganizationIds } },
    });
    await database.payment.deleteMany({
      where: { organizationId: { in: createdOrganizationIds } },
    });
    await database.saleItem.deleteMany({
      where: { organizationId: { in: createdOrganizationIds } },
    });
    await database.purchaseInvoiceItem.deleteMany({
      where: { organizationId: { in: createdOrganizationIds } },
    });
    await database.stockMovement.deleteMany({
      where: { organizationId: { in: createdOrganizationIds } },
    });
    await database.sale.deleteMany({
      where: { organizationId: { in: createdOrganizationIds } },
    });
    await database.purchaseInvoice.deleteMany({
      where: { organizationId: { in: createdOrganizationIds } },
    });
    // Automatic postings create journals whose lines RESTRICT account deletion.
    await database.journalEntryLine.deleteMany({
      where: { journalEntry: { organizationId: { in: createdOrganizationIds } } },
    });
    await database.journalEntry.deleteMany({
      where: { organizationId: { in: createdOrganizationIds } },
    });
    await database.account.deleteMany({
      where: { organizationId: { in: createdOrganizationIds } },
    });
    await database.accountingPeriod.deleteMany({
      where: { organizationId: { in: createdOrganizationIds } },
    });
    await database.organization.deleteMany({
      where: { id: { in: createdOrganizationIds } },
    });
    await database.user.deleteMany({
      where: { email: { startsWith: emailPrefix } },
    });
  }
  if (connected) {
    await database.$disconnect();
  }
});

describe("Phase 1 PostgreSQL integration", () => {
  it("registers an owner, persists membership and permissions, and stores only a session hash", async () => {
    expect(owner.status).toBe(201);
    expect(owner.user.email).toBe(`${emailPrefix}owner@example.com`);
    expect(owner.user.organizations).toHaveLength(1);
    expect(owner.user.organizations[0]?.role).toBe("owner");
    expect(owner.cookieHeader.toLowerCase().includes("httponly")).toBe(true);
    // The web client (:3000) and API (:4000) are separate origins, so the session
    // cookie must be `lax`; `strict` would drop it on every credentialed API call.
    // CSRF is enforced by OriginGuard on mutating requests instead.
    expect(owner.cookieHeader.toLowerCase().includes("samesite=lax")).toBe(true);
    expect(owner.cookieHeader.toLowerCase().includes("samesite=strict")).toBe(false);
    expect(owner.cookie.startsWith("ubos_session=")).toBe(true);

    const session = await database.session.findUnique({
      where: {
        tokenHash: createHash("sha256").update(owner.token).digest("hex"),
      },
    });
    expect(Boolean(session && session.userId === owner.user.id)).toBe(true);
    expect(Boolean(session && session.tokenHash !== owner.token)).toBe(true);

    const membership = await database.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId: owner.user.organizations[0]!.id,
          userId: owner.user.id,
        },
      },
      include: { role: { include: { permissions: { include: { permission: true } } } } },
    });
    expect(membership?.role.key).toBe("owner");
    expect(
      membership?.role.permissions.some(
        ({ permission }) => permission.key === "organization.read",
      ),
    ).toBe(true);

    const currentOrganization = await request("/organizations/current", "GET", {
      cookie: owner.cookie,
      organizationId: owner.user.organizations[0]!.id,
    });
    expect(currentOrganization.status).toBe(200);
  });

  it("logs in, authenticates the persisted session, and revokes it on logout", async () => {
    const login = await request("/auth/login", "POST", {
      body: { email: owner.user.email.toUpperCase(), password },
    });
    expect(login.status).toBe(200);
    const loginCookieHeader = login.headers.get("set-cookie") ?? "";
    const loginCookie = loginCookieHeader.split(";")[0] ?? "";

    const profile = await request("/auth/me", "GET", { cookie: loginCookie });
    expect(profile.status).toBe(200);
    const profileBody = (await profile.json()) as { id: string; email: string };
    expect(profileBody.id).toBe(owner.user.id);
    expect(profileBody.email).toBe(owner.user.email);

    const failedLogin = await request("/auth/login", "POST", {
      body: { email: owner.user.email, password: `${password}-wrong` },
    });
    expect(failedLogin.status).toBe(401);

    const logout = await request("/auth/logout", "POST", { cookie: loginCookie });
    expect(logout.status).toBe(204);
    const revokedProfile = await request("/auth/me", "GET", { cookie: loginCookie });
    expect(revokedProfile.status).toBe(401);
  });

  it("isolates tenants and denies organization access when the member role lacks permission", async () => {
    const guest = await register(
      `${emailPrefix}guest@example.com`,
      "Integration Guest",
      "Guest Organization",
    );
    expect(guest.status).toBe(201);

    const ownerOrganizationId = owner.user.organizations[0]!.id;
    const crossTenant = await request("/organizations/current", "GET", {
      cookie: guest.cookie,
      organizationId: ownerOrganizationId,
    });
    expect(crossTenant.status).toBe(403);

    const guestMemberships = await request("/organizations", "GET", {
      cookie: guest.cookie,
    });
    const initialMemberships = (await guestMemberships.json()) as Array<{ id: string }>;
    expect(guestMemberships.status).toBe(200);
    expect(initialMemberships.map(({ id }) => id)).toEqual([
      guest.user.organizations[0]!.id,
    ]);

    const viewerRole = await database.role.create({
      data: {
        organizationId: ownerOrganizationId,
        name: "Viewer",
        key: "integration-viewer",
      },
    });
    await database.organizationMember.create({
      data: {
        organizationId: ownerOrganizationId,
        userId: guest.user.id,
        roleId: viewerRole.id,
      },
    });

    const viewerAccess = await request("/organizations/current", "GET", {
      cookie: guest.cookie,
      organizationId: ownerOrganizationId,
    });
    expect(viewerAccess.status).toBe(403);

    const viewerCatalogAccess = await request("/business/products", "GET", {
      cookie: guest.cookie,
      organizationId: ownerOrganizationId,
    });
    expect(viewerCatalogAccess.status).toBe(403);

    const ownerAccess = await request("/organizations/current", "GET", {
      cookie: owner.cookie,
      organizationId: ownerOrganizationId,
    });
    expect(ownerAccess.status).toBe(200);
  });

  it("rejects cross-organization references at the PostgreSQL foreign-key layer", async () => {
    const tenantA = await register(
      `${emailPrefix}a@example.com`,
      "FK Test Tenant A",
      "FK Test Organization A",
    );
    const otherTenant = await register(
      `${emailPrefix}b@example.com`,
      "FK Test Tenant",
      "FK Test Organization",
    );
    if (tenantA.status !== 201 || otherTenant.status !== 201) {
      throw new Error(
        `Foreign-key fixture registration failed: ${JSON.stringify({ tenantA: tenantA.message, tenantB: otherTenant.message })}`,
      );
    }

    const organizationA = tenantA.user.organizations[0]!.id;
    const organizationB = otherTenant.user.organizations[0]!.id;
    const userA = tenantA.user.id;
    const memberA = await database.organizationMember.findUniqueOrThrow({
      where: { organizationId_userId: { organizationId: organizationA, userId: userA } },
    });
    const memberB = await database.organizationMember.findUniqueOrThrow({
      where: {
        organizationId_userId: {
          organizationId: organizationB,
          userId: otherTenant.user.id,
        },
      },
    });
    const roleB = await database.role.findFirstOrThrow({
      where: { organizationId: organizationB, key: "owner" },
    });
    const categoryB = await database.productCategory.create({
      data: { organizationId: organizationB, name: `FK category ${runId}` },
    });
    const productA = await database.product.create({
      data: {
        organizationId: organizationA,
        name: `FK product A ${runId}`,
        unitPrice: "1.00",
        costPrice: "0.50",
      },
    });
    const productB = await database.product.create({
      data: {
        organizationId: organizationB,
        name: `FK product B ${runId}`,
        unitPrice: "1.00",
        costPrice: "0.50",
      },
    });
    const customerB = await database.customer.create({
      data: { organizationId: organizationB, name: `FK customer ${runId}` },
    });
    const supplierB = await database.supplier.create({
      data: { organizationId: organizationB, name: `FK supplier ${runId}` },
    });
    const saleA = await database.sale.create({
      data: {
        organizationId: organizationA,
        invoiceNumber: `FKA-${runId.slice(0, 12)}`,
        subtotal: "1.00",
        discount: "0.00",
        tax: "0.00",
        total: "1.00",
      },
    });
    const saleB = await database.sale.create({
      data: {
        organizationId: organizationB,
        invoiceNumber: `FKB-${runId.slice(0, 12)}`,
        subtotal: "1.00",
        discount: "0.00",
        tax: "0.00",
        total: "1.00",
      },
    });
    const invoiceB = await database.purchaseInvoice.create({
      data: {
        organizationId: organizationB,
        supplierId: supplierB.id,
        invoiceNumber: `FKB-${runId.slice(0, 12)}`,
        subtotal: "1.00",
        tax: "0.00",
        total: "1.00",
      },
    });
    const invoiceA = await database.purchaseInvoice.create({
      data: {
        organizationId: organizationA,
        supplierId: (await database.supplier.create({
          data: { organizationId: organizationA, name: `FK supplier A ${runId}` },
        })).id,
        invoiceNumber: `FKA-${runId.slice(0, 12)}`,
        subtotal: "1.00",
        tax: "0.00",
        total: "1.00",
      },
    });
    const branchB = await database.branch.create({
      data: { organizationId: organizationB, name: `FK branch ${runId}` },
    });

    const assertRejected = async (write: Promise<unknown>) => {
      await expect(write).rejects.toThrow(/foreign key constraint/i);
    };
    const assertCheckRejected = async (write: Promise<unknown>) => {
      await expect(write).rejects.toThrow(/Payment_exactly_one_target_check/);
    };

    await assertRejected(database.product.create({
      data: {
        organizationId: organizationA,
        categoryId: categoryB.id,
        name: `Invalid category reference ${runId}`,
        unitPrice: "1.00",
        costPrice: "0.50",
      },
    }));
    await assertRejected(database.inventory.create({
      data: { organizationId: organizationA, productId: productB.id },
    }));
    await assertRejected(database.stockMovement.create({
      data: {
        organizationId: organizationA,
        productId: productB.id,
        quantityDelta: 1,
        reason: "count",
      },
    }));
    await assertRejected(database.sale.create({
      data: {
        organizationId: organizationA,
        customerId: customerB.id,
        invoiceNumber: `FKC-${runId.slice(0, 12)}`,
        subtotal: "1.00",
        discount: "0.00",
        tax: "0.00",
        total: "1.00",
      },
    }));
    await assertRejected(database.saleItem.create({
      data: {
        organizationId: organizationA,
        saleId: saleB.id,
        productId: productA.id,
        description: "Cross tenant sale",
        quantity: 1,
        unitPrice: "1.00",
        lineTotal: "1.00",
      },
    }));
    await assertRejected(database.saleItem.create({
      data: {
        organizationId: organizationA,
        saleId: saleA.id,
        productId: productB.id,
        description: "Cross tenant product",
        quantity: 1,
        unitPrice: "1.00",
        lineTotal: "1.00",
      },
    }));
    await assertRejected(database.purchaseInvoice.create({
      data: {
        organizationId: organizationA,
        supplierId: supplierB.id,
        invoiceNumber: `FKC-${runId.slice(0, 12)}`,
        subtotal: "1.00",
        tax: "0.00",
        total: "1.00",
      },
    }));
    await assertRejected(database.purchaseInvoiceItem.create({
      data: {
        organizationId: organizationA,
        purchaseInvoiceId: invoiceB.id,
        productId: productA.id,
        description: "Cross tenant invoice",
        quantity: 1,
        unitCost: "1.00",
        lineTotal: "1.00",
      },
    }));
    await assertRejected(database.purchaseInvoiceItem.create({
      data: {
        organizationId: organizationA,
        purchaseInvoiceId: invoiceA.id,
        productId: productB.id,
        description: "Cross tenant product",
        quantity: 1,
        unitCost: "1.00",
        lineTotal: "1.00",
      },
    }));
    await assertRejected(database.payment.create({
      data: { organizationId: organizationA, saleId: saleB.id, amount: "1.00", method: "cash" },
    }));
    await assertRejected(database.payment.create({
      data: {
        organizationId: organizationA,
        purchaseInvoiceId: invoiceB.id,
        amount: "1.00",
        method: "cash",
      },
    }));
    await assertCheckRejected(database.payment.create({
      data: { organizationId: organizationA, amount: "1.00", method: "cash" },
    }));
    await assertCheckRejected(database.payment.create({
      data: {
        organizationId: organizationA,
        saleId: saleA.id,
        purchaseInvoiceId: invoiceA.id,
        amount: "1.00",
        method: "cash",
      },
    }));
    await assertRejected(database.organizationMember.create({
      data: { organizationId: organizationA, userId: otherTenant.user.id, roleId: roleB.id },
    }));
    await assertRejected(database.branchAccess.create({
      data: { organizationId: organizationA, memberId: memberA.id, branchId: branchB.id },
    }));
    await assertRejected(database.branchAccess.create({
      data: { organizationId: organizationA, memberId: memberB.id, branchId: branchB.id },
    }));

    await database.inventory.create({
      data: { organizationId: organizationA, productId: productA.id, quantity: 1 },
    });
    const rollbackKey = `rollback-${runId}`;
    const rollbackKeyHash = createHash("sha256").update(rollbackKey).digest("hex");
    const beforeRollback = {
      inventoryQuantity: (await database.inventory.findUniqueOrThrow({ where: { productId: productA.id } })).quantity,
      sales: await database.sale.count({ where: { organizationId: organizationA } }),
      saleItems: await database.saleItem.count({ where: { organizationId: organizationA } }),
      movements: await database.stockMovement.count({ where: { organizationId: organizationA } }),
      auditEvents: await database.auditLog.count({
        where: { organizationId: organizationA, actorId: tenantA.user.id, action: "sales.invoice_created" },
      }),
    };
    const failedSale = await request("/business/sales", "POST", {
      cookie: tenantA.cookie,
      organizationId: organizationA,
      idempotencyKey: rollbackKey,
      body: {
        items: [
          { productId: productA.id, quantity: 1 },
          { productId: productA.id, quantity: 1 },
        ],
      },
    });
    expect(failedSale.status).toBe(409);
    expect((await database.inventory.findUniqueOrThrow({ where: { productId: productA.id } })).quantity)
      .toBe(beforeRollback.inventoryQuantity);
    expect(await database.sale.count({ where: { organizationId: organizationA } })).toBe(beforeRollback.sales);
    expect(await database.saleItem.count({ where: { organizationId: organizationA } })).toBe(beforeRollback.saleItems);
    expect(await database.stockMovement.count({ where: { organizationId: organizationA } })).toBe(beforeRollback.movements);
    expect(await database.auditLog.count({
      where: { organizationId: organizationA, actorId: tenantA.user.id, action: "sales.invoice_created" },
    })).toBe(beforeRollback.auditEvents);
    expect(await database.idempotencyRecord.count({
      where: {
        organizationId: organizationA,
        actorId: tenantA.user.id,
        operation: "sales.invoice.create",
        keyHash: rollbackKeyHash,
      },
    })).toBe(0);

    const retriedSale = await request("/business/sales", "POST", {
      cookie: tenantA.cookie,
      organizationId: organizationA,
      idempotencyKey: rollbackKey,
      body: { items: [{ productId: productA.id, quantity: 1 }] },
    });
    expect(retriedSale.status).toBe(201);
    expect((await database.inventory.findUniqueOrThrow({ where: { productId: productA.id } })).quantity).toBe(0);
    expect(await database.idempotencyRecord.count({
      where: {
        organizationId: organizationA,
        actorId: tenantA.user.id,
        operation: "sales.invoice.create",
        keyHash: rollbackKeyHash,
      },
    })).toBe(1);

    const categoryProduct = await database.product.create({
      data: {
        organizationId: organizationB,
        categoryId: categoryB.id,
        name: `SET NULL category ${runId}`,
        unitPrice: "1.00",
        costPrice: "0.50",
      },
    });
    await database.productCategory.delete({ where: { id: categoryB.id } });
    expect((await database.product.findUniqueOrThrow({ where: { id: categoryProduct.id } })).categoryId).toBeNull();

    const customerSale = await database.sale.create({
      data: {
        organizationId: organizationB,
        customerId: customerB.id,
        invoiceNumber: `FKC-${runId.slice(0, 12)}`,
        subtotal: "1.00",
        discount: "0.00",
        tax: "0.00",
        total: "1.00",
      },
    });
    await database.customer.delete({ where: { id: customerB.id } });
    expect((await database.sale.findUniqueOrThrow({ where: { id: customerSale.id } })).customerId).toBeNull();

  });

  it("creates scoped catalog, stock, sales, procurement, payments, and report records", async () => {
    const ownerCookie = owner.cookie;
    const organizationId = owner.user.organizations[0]!.id;
    const scoped = { cookie: ownerCookie, organizationId };

    const categoryResponse = await request("/business/categories", "POST", {
      ...scoped,
      body: { name: `Integration category ${runId}` },
    });
    expect(categoryResponse.status).toBe(201);
    const category = (await categoryResponse.json()) as { id: string };

    const productResponse = await request("/business/products", "POST", {
      ...scoped,
      body: {
        name: `Integration item ${runId}`,
        sku: `TEST-${runId.slice(0, 8)}`,
        categoryId: category.id,
        unitPrice: "12.35",
        costPrice: "7.05",
      },
    });
    expect(productResponse.status).toBe(201);
    const product = (await productResponse.json()) as { id: string };

    const adjustmentKey = `adjust-${runId}`;
    const adjustmentBody = { productId: product.id, quantityDelta: 10, reason: "count" };
    const adjustment = await request("/business/inventory/adjustments", "POST", {
      ...scoped,
      body: adjustmentBody,
      idempotencyKey: adjustmentKey,
    });
    expect(adjustment.status).toBe(201);
    const adjustmentResult = (await adjustment.json()) as { id: string };
    const adjustmentReplay = await request("/business/inventory/adjustments", "POST", {
      ...scoped,
      body: adjustmentBody,
      idempotencyKey: adjustmentKey,
    });
    expect(adjustmentReplay.status).toBe(201);
    expect(((await adjustmentReplay.json()) as { id: string }).id).toBe(adjustmentResult.id);
    const adjustmentMismatch = await request("/business/inventory/adjustments", "POST", {
      ...scoped,
      body: { ...adjustmentBody, quantityDelta: 9 },
      idempotencyKey: adjustmentKey,
    });
    expect(adjustmentMismatch.status).toBe(409);

    const customerResponse = await request("/business/customers", "POST", {
      ...scoped,
      body: { name: `Integration customer ${runId}`, email: `${emailPrefix}customer@example.com` },
    });
    expect(customerResponse.status).toBe(201);
    const customer = (await customerResponse.json()) as { id: string };

    const clearContact = await request("/business/customers/" + customer.id, "PATCH", {
      ...scoped,
      body: { email: null, phone: null, notes: null },
    });
    expect(clearContact.status).toBe(200);
    const clearedContact = (await clearContact.json()) as { email: string | null; phone: string | null; notes: string | null };
    expect(clearedContact).toMatchObject({ email: null, phone: null, notes: null });

    const supplierResponse = await request("/business/suppliers", "POST", {
      ...scoped,
      body: {
        name: `Integration supplier ${runId}`,
        email: `${emailPrefix}sup@example.com`,
        phone: "555-0102",
        notes: "Supplier clear fixture",
      },
    });
    expect(supplierResponse.status).toBe(201);
    const supplier = (await supplierResponse.json()) as { id: string };

    const clearSupplier = await request(`/business/suppliers/${supplier.id}`, "PATCH", {
      ...scoped,
      body: { email: null, phone: null, notes: null },
    });
    expect(clearSupplier.status).toBe(200);
    expect(await clearSupplier.json()).toMatchObject({ email: null, phone: null, notes: null });

    const saleResponse = await request("/business/sales", "POST", {
      ...scoped,
      body: {
        customerId: customer.id,
        items: [{ productId: product.id, quantity: 2 }],
        tax: "0.03",
      },
    });
    expect(saleResponse.status).toBe(201);
    const sale = (await saleResponse.json()) as { id: string; total: string };
    expect(sale.total).toBe("24.73");

    const balanceBeforeOverpaymentResponse = await request("/business/sales", "GET", scoped);
    expect(balanceBeforeOverpaymentResponse.status).toBe(200);
    const salesBeforeOverpayment = (await balanceBeforeOverpaymentResponse.json()) as {
      items: Array<{ id: string; outstanding: string }>;
    };
    const balanceBeforeOverpayment = salesBeforeOverpayment.items.find(({ id }) => id === sale.id)?.outstanding;
    expect(balanceBeforeOverpayment).toBe("24.73");

    const overpayment = await request("/business/payments", "POST", {
      ...scoped,
      body: { saleId: sale.id, amount: "24.74", method: "cash" },
    });
    expect(overpayment.status).toBe(400);

    const balanceAfterOverpaymentResponse = await request("/business/sales", "GET", scoped);
    expect(balanceAfterOverpaymentResponse.status).toBe(200);
    const salesAfterOverpayment = (await balanceAfterOverpaymentResponse.json()) as {
      items: Array<{ id: string; outstanding: string }>;
    };
    expect(salesAfterOverpayment.items.find(({ id }) => id === sale.id)?.outstanding).toBe(
      balanceBeforeOverpayment,
    );

    const salesPayment = await request("/business/payments", "POST", {
      ...scoped,
      body: { saleId: sale.id, amount: "10.00", method: "cash", reference: `SALE-REF-${runId.slice(0, 8)}` },
    });
    expect(salesPayment.status).toBe(201);
    expect(((await salesPayment.json()) as { reference: string | null }).reference).toBe(`SALE-REF-${runId.slice(0, 8)}`);
    const saleAfterPaymentResponse = await request("/business/sales", "GET", scoped);
    const saleAfterPayment = ((await saleAfterPaymentResponse.json()) as {
      items: Array<{ id: string; payments: Array<{ reference: string | null }> }>;
    }).items.find(({ id }) => id === sale.id);
    expect(saleAfterPayment?.payments.map(({ reference }) => reference)).toContain(`SALE-REF-${runId.slice(0, 8)}`);

    const purchaseResponse = await request("/business/purchases", "POST", {
      ...scoped,
      body: {
        supplierId: supplier.id,
        invoiceNumber: `SUP-${runId.slice(0, 12)}`,
        items: [{ productId: product.id, quantity: 3, unitCost: "7.05" }],
        tax: "0.02",
      },
    });
    expect(purchaseResponse.status).toBe(201);
    const purchase = (await purchaseResponse.json()) as { id: string; total: string };
    expect(purchase.total).toBe("21.17");

    const purchasePayment = await request("/business/payments", "POST", {
      ...scoped,
      body: { purchaseInvoiceId: purchase.id, amount: "5.00", method: "bank_transfer", reference: `PUR-REF-${runId.slice(0, 8)}` },
    });
    expect(purchasePayment.status).toBe(201);
    expect(((await purchasePayment.json()) as { reference: string | null }).reference).toBe(`PUR-REF-${runId.slice(0, 8)}`);
    const purchaseAfterPaymentResponse = await request("/business/purchases", "GET", scoped);
    const purchaseAfterPayment = ((await purchaseAfterPaymentResponse.json()) as {
      items: Array<{ id: string; payments: Array<{ reference: string | null }> }>;
    }).items.find(({ id }) => id === purchase.id);
    expect(purchaseAfterPayment?.payments.map(({ reference }) => reference)).toContain(`PUR-REF-${runId.slice(0, 8)}`);

    const stockResponse = await request("/business/inventory", "GET", scoped);
    expect(stockResponse.status).toBe(200);
    const stock = (await stockResponse.json()) as {
      items: Array<{ productId: string; quantity: number }>;
      recentMovements: Array<{ productId: string; reason: string; quantityDelta: number }>;
    };
    expect(stock.items.find(({ productId }) => productId === product.id)?.quantity).toBe(11);
    const productMovements = stock.recentMovements.filter(
      ({ productId }) => productId === product.id,
    );
    const movementDeltas = Object.fromEntries(
      productMovements.map(({ reason, quantityDelta }) => [reason, quantityDelta]),
    );
    expect(movementDeltas).toEqual({ count: 10, sale: -2, purchase: 3 });
    expect(Object.values(movementDeltas).reduce((total, delta) => total + delta, 0)).toBe(11);

    const otherTenant = await register(
      `${emailPrefix}bt@example.com`,
      "Business Tenant",
      "Business Tenant Organization",
    );
    if (otherTenant.status !== 201) {
      throw new Error(`Business tenant registration failed: ${JSON.stringify(otherTenant.message)}`);
    }
    const otherOrganizationId = otherTenant.user.organizations[0]!.id;
    const crossTenantInventory = await request("/business/inventory", "GET", {
      cookie: otherTenant.cookie,
      organizationId,
    });
    expect(crossTenantInventory.status).toBe(403);

    const crossTenantSale = await request("/business/sales", "POST", {
      cookie: otherTenant.cookie,
      organizationId: otherOrganizationId,
      body: { items: [{ productId: product.id, quantity: 1 }] },
    });
    expect(crossTenantSale.status).toBe(404);

    const reportResponse = await request("/business/reports/summary", "GET", scoped);
    expect(reportResponse.status).toBe(200);
    const report = (await reportResponse.json()) as {
      salesTotal: string;
      customerOutstanding: string;
      purchasesTotal: string;
      supplierOutstanding: string;
      inventoryUnits: number;
      inventoryCostValue: string;
    };
    expect(report.salesTotal).toBe("24.73");
    expect(report.customerOutstanding).toBe("14.73");
    expect(report.purchasesTotal).toBe("21.17");
    expect(report.supplierOutstanding).toBe("16.17");
    expect(report.inventoryUnits).toBeGreaterThanOrEqual(11);
    expect(report.inventoryCostValue).toMatch(/^\d+\.\d{2}$/);

    const concurrentPayments = await Promise.all([
      request("/business/payments", "POST", {
        ...scoped,
        idempotencyKey: `concurrent-payment-${runId}`,
        body: { saleId: sale.id, amount: "10.00", method: "cash" },
      }),
      request("/business/payments", "POST", {
        ...scoped,
        idempotencyKey: `concurrent-payment-${runId}`,
        body: { saleId: sale.id, amount: "10.00", method: "cash" },
      }),
    ]);
    expect(concurrentPayments.map(({ status }) => status)).toEqual([201, 201]);
    const concurrentPaymentIds = await Promise.all(
      concurrentPayments.map(async (response) => ((await response.json()) as { id: string }).id),
    );
    expect(concurrentPaymentIds[0]).toBe(concurrentPaymentIds[1]);

    const secondProductResponse = await request("/business/products", "POST", {
      ...scoped,
      body: {
        name: `Integration second item ${runId}`,
        sku: `TEST2-${runId.slice(0, 8)}`,
        unitPrice: "2.00",
        costPrice: "1.00",
      },
    });
    expect(secondProductResponse.status).toBe(201);
    const secondProduct = (await secondProductResponse.json()) as { id: string };
    const secondAdjustment = await request("/business/inventory/adjustments", "POST", {
      ...scoped,
      body: { productId: secondProduct.id, quantityDelta: 5, reason: "count" },
    });
    expect(secondAdjustment.status).toBe(201);

    const multiLineSaleResponse = await request("/business/sales", "POST", {
      ...scoped,
      body: { items: [{ productId: product.id, quantity: 1 }, { productId: secondProduct.id, quantity: 2 }] },
    });
    expect(multiLineSaleResponse.status).toBe(201);
    const multiLineSale = (await multiLineSaleResponse.json()) as { id: string; total: string };
    expect(multiLineSale.total).toBe("16.35");
    const salesWithDetailsResponse = await request("/business/sales", "GET", scoped);
    const salesWithDetails = (await salesWithDetailsResponse.json()) as {
      items: Array<{
        id: string;
        items: Array<{ productId: string; quantity: number; lineTotal: string }>;
        payments: Array<{ reference: string | null }>;
      }>;
    };
    const detailedSale = salesWithDetails.items.find(({ id }) => id === multiLineSale.id);
    expect(detailedSale?.items).toEqual([
      expect.objectContaining({ productId: product.id, quantity: 1, lineTotal: "12.35" }),
      expect.objectContaining({ productId: secondProduct.id, quantity: 2, lineTotal: "4" }),
    ]);
    expect(detailedSale?.payments).toEqual([]);

    const multiLinePurchaseResponse = await request("/business/purchases", "POST", {
      ...scoped,
      body: {
        supplierId: supplier.id,
        invoiceNumber: `MULTI-${runId.slice(0, 12)}`,
        items: [{ productId: product.id, quantity: 1, unitCost: "7.05" }, { productId: secondProduct.id, quantity: 2, unitCost: "1.00" }],
      },
    });
    expect(multiLinePurchaseResponse.status).toBe(201);
    const multiLinePurchase = (await multiLinePurchaseResponse.json()) as { id: string; total: string };
    expect(multiLinePurchase.total).toBe("9.05");
    const purchasesWithDetailsResponse = await request("/business/purchases", "GET", scoped);
    const purchasesWithDetails = (await purchasesWithDetailsResponse.json()) as {
      items: Array<{
        id: string;
        items: Array<{ productId: string; quantity: number; lineTotal: string }>;
        payments: Array<{ reference: string | null }>;
      }>;
    };
    const detailedPurchase = purchasesWithDetails.items.find(({ id }) => id === multiLinePurchase.id);
    expect(detailedPurchase?.items).toEqual([
      expect.objectContaining({ productId: product.id, quantity: 1, lineTotal: "7.05" }),
      expect.objectContaining({ productId: secondProduct.id, quantity: 2, lineTotal: "2" }),
    ]);
    expect(detailedPurchase?.payments).toEqual([]);

    const inventoryAfterMultiLineResponse = await request("/business/inventory", "GET", scoped);
    expect(inventoryAfterMultiLineResponse.status).toBe(200);
    const inventoryAfterMultiLine = (await inventoryAfterMultiLineResponse.json()) as {
      items: Array<{ productId: string; quantity: number }>;
      recentMovements: Array<{ productId: string; quantityDelta: number }>;
    };
    const productQuantities = new Map(inventoryAfterMultiLine.items.map(({ productId, quantity }) => [productId, quantity]));
    expect(productQuantities.get(product.id)).toBe(11);
    expect(productQuantities.get(secondProduct.id)).toBe(5);
    for (const productId of [product.id, secondProduct.id]) {
      const movementTotal = inventoryAfterMultiLine.recentMovements
        .filter((movement) => movement.productId === productId)
        .reduce((total, movement) => total + movement.quantityDelta, 0);
      expect(movementTotal).toBe(productQuantities.get(productId));
    }
  });
});

describe("Phase 3/4 PostgreSQL integration: pagination, audit, accounting", () => {
  let orgId: string;

  beforeAll(() => {
    orgId = owner.user.organizations[0].id;
  });

  it("paginates products with a stable cursor and no silent truncation", async () => {
    const scoped = { cookie: owner.cookie, organizationId: orgId };
    const created: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      const response = await request("/business/products", "POST", {
        ...scoped,
        body: {
          name: `Paged Product ${index} ${runId.slice(0, 6)}`,
          unitPrice: "1.00",
          costPrice: "0.50",
        },
      });
      expect(response.status).toBe(201);
      created.push(((await response.json()) as { id: string }).id);
    }

    const firstPageResponse = await request("/business/products?limit=2", "GET", scoped);
    expect(firstPageResponse.status).toBe(200);
    const firstPage = (await firstPageResponse.json()) as {
      items: Array<{ id: string }>;
      nextCursor: string | null;
      hasMore: boolean;
    };
    expect(firstPage.items).toHaveLength(2);
    expect(firstPage.hasMore).toBe(true);
    expect(firstPage.nextCursor).toBeTruthy();

    const secondPageResponse = await request(
      `/business/products?limit=2&cursor=${encodeURIComponent(firstPage.nextCursor!)}`,
      "GET",
      scoped,
    );
    expect(secondPageResponse.status).toBe(200);
    const secondPage = (await secondPageResponse.json()) as {
      items: Array<{ id: string }>;
      nextCursor: string | null;
    };
    expect(secondPage.items).toHaveLength(2);

    const firstIds = new Set(firstPage.items.map(({ id }) => id));
    for (const item of secondPage.items) {
      expect(firstIds.has(item.id)).toBe(false);
    }

    const invalidCursor = await request("/business/products?cursor=not-a-cursor", "GET", scoped);
    expect(invalidCursor.status).toBe(400);
  });

  it("searches products by name within the organization", async () => {
    const scoped = { cookie: owner.cookie, organizationId: orgId };
    const unique = `Searchable-${runId.slice(0, 8)}`;
    const created = await request("/business/products", "POST", {
      ...scoped,
      body: { name: unique, unitPrice: "2.00", costPrice: "1.00" },
    });
    expect(created.status).toBe(201);

    const searchResponse = await request(`/business/products?search=${unique}`, "GET", scoped);
    expect(searchResponse.status).toBe(200);
    const search = (await searchResponse.json()) as { items: Array<{ name: string }> };
    expect(search.items).toHaveLength(1);
    expect(search.items[0].name).toBe(unique);
  });

  it("exposes organization-scoped audit history", async () => {
    const scoped = { cookie: owner.cookie, organizationId: orgId };
    const response = await request("/business/audit?limit=5", "GET", scoped);
    expect(response.status).toBe(200);
    const page = (await response.json()) as {
      items: Array<{ action: string; organizationId: string }>;
      hasMore: boolean;
    };
    expect(page.items.length).toBeGreaterThan(0);
    for (const entry of page.items) {
      expect(entry.organizationId).toBe(orgId);
    }
  });

  it("creates a chart of accounts and posts a balanced journal entry", async () => {
    const scoped = { cookie: owner.cookie, organizationId: orgId };
    const cash = await request("/business/accounts", "POST", {
      ...scoped,
      body: { code: "9001", name: "Cash", type: "ASSET", normalBalance: "DEBIT" },
    });
    expect(cash.status).toBe(201);
    const cashAccount = (await cash.json()) as { id: string };

    const revenue = await request("/business/accounts", "POST", {
      ...scoped,
      body: { code: "9002", name: "Sales Revenue", type: "REVENUE", normalBalance: "CREDIT" },
    });
    expect(revenue.status).toBe(201);
    const revenueAccount = (await revenue.json()) as { id: string };

    const duplicate = await request("/business/accounts", "POST", {
      ...scoped,
      body: { code: "9001", name: "Cash Duplicate", type: "ASSET", normalBalance: "DEBIT" },
    });
    expect(duplicate.status).toBe(409);

    const unbalanced = await request("/business/journal-entries", "POST", {
      ...scoped,
      body: {
        description: "Unbalanced entry",
        lines: [
          { accountId: cashAccount.id, debit: "100", credit: "0", orderIndex: 0 },
          { accountId: revenueAccount.id, debit: "0", credit: "90", orderIndex: 1 },
        ],
      },
    });
    expect(unbalanced.status).toBe(400);

    const posted = await request("/business/journal-entries", "POST", {
      ...scoped,
      body: {
        description: "Cash sale",
        lines: [
          { accountId: cashAccount.id, debit: "100", credit: "0", orderIndex: 0 },
          { accountId: revenueAccount.id, debit: "0", credit: "100", orderIndex: 1 },
        ],
      },
    });
    expect(posted.status).toBe(201);

    const cashBalance = await request(`/business/accounts/${cashAccount.id}/balance`, "GET", scoped);
    expect(cashBalance.status).toBe(200);
    const cashResult = (await cashBalance.json()) as { balance: string; debitTotal: string };
    expect(cashResult.debitTotal).toBe("100.00");
    expect(cashResult.balance).toBe("100.00");

    const revenueBalance = await request(`/business/accounts/${revenueAccount.id}/balance`, "GET", scoped);
    const revenueResult = (await revenueBalance.json()) as { balance: string; creditTotal: string };
    expect(revenueResult.creditTotal).toBe("100.00");
    expect(revenueResult.balance).toBe("100.00");

    const journals = await request("/business/journal-entries", "GET", scoped);
    expect(journals.status).toBe(200);
    // Journal lists are cursor-paginated envelopes (Phase 3).
    const journalList = (await journals.json()) as {
      items: Array<{ status: string; lines: unknown[] }>;
      hasMore: boolean;
    };
    expect(journalList.items.some((entry) => entry.status === "POSTED" && entry.lines.length === 2)).toBe(true);
  });

  it("rejects journal lines that reference another organization's account", async () => {
    const other = await register(
      `ubos-acct-${runId.slice(0, 8)}-other@example.com`,
      "Other Accounting Owner",
      "Other Accounting Org",
    );
    expect({ status: other.status, message: other.message }).toEqual({ status: 201, message: undefined });
    const otherOrgId = other.user.organizations[0].id;
    const otherAccount = await request("/business/accounts", "POST", {
      cookie: other.cookie,
      organizationId: otherOrgId,
      body: { code: "9001", name: "Other Cash", type: "ASSET", normalBalance: "DEBIT" },
    });
    expect(otherAccount.status).toBe(201);
    const otherAccountId = ((await otherAccount.json()) as { id: string }).id;

    const ownAccount = await request("/business/accounts", "POST", {
      cookie: owner.cookie,
      organizationId: orgId,
      body: { code: "9003", name: "Accounts Payable", type: "LIABILITY", normalBalance: "CREDIT" },
    });
    expect(ownAccount.status).toBe(201);
    const ownAccountId = ((await ownAccount.json()) as { id: string }).id;

    const crossTenant = await request("/business/journal-entries", "POST", {
      cookie: owner.cookie,
      organizationId: orgId,
      body: {
        description: "Cross-tenant attempt",
        lines: [
          { accountId: ownAccountId, debit: "10", credit: "0", orderIndex: 0 },
          { accountId: otherAccountId, debit: "0", credit: "10", orderIndex: 1 },
        ],
      },
    });
    expect(crossTenant.status).toBe(400);
  });

  it("manages branches with organization scoping", async () => {
    const scoped = { cookie: owner.cookie, organizationId: orgId };
    const created = await request("/business/branches", "POST", {
      ...scoped,
      body: { name: `Main Branch ${runId.slice(0, 6)}` },
    });
    expect(created.status).toBe(201);
    const branch = (await created.json()) as { id: string; name: string };

    const list = await request("/business/branches", "GET", scoped);
    expect(list.status).toBe(200);
    const branches = (await list.json()) as Array<{ id: string }>;
    expect(branches.some(({ id }) => id === branch.id)).toBe(true);

    const updated = await request(`/business/branches/${branch.id}`, "PATCH", {
      ...scoped,
      body: { name: `Renamed Branch ${runId.slice(0, 6)}` },
    });
    expect(updated.status).toBe(200);

    const removed = await request(`/business/branches/${branch.id}`, "DELETE", scoped);
    expect(removed.status).toBe(200);
  });
});

describe("Products routes: CRUD, search, soft delete and tenant isolation", () => {
  it("creates, lists, searches, reads, updates, reloads and soft deletes a product", async () => {
    const scoped = { cookie: owner.cookie, organizationId: owner.user.organizations[0].id };
    const unique = `Route-Product-${runId.slice(0, 8)}`;

    const created = await request("/products", "POST", {
      ...scoped,
      body: {
        name: unique,
        sku: `SKU-${runId.slice(0, 8)}`,
        barcode: `BAR-${runId.slice(0, 8)}`,
        unitPrice: "12.50",
        costPrice: "7.25",
        lowStockAt: 4,
      },
    });
    expect(created.status).toBe(201);
    const product = (await created.json()) as {
      id: string;
      name: string;
      unitPrice: string;
      costPrice: string;
      lowStockAt: number;
      isActive: boolean;
      inventory: { quantity: number };
    };
    expect(product.name).toBe(unique);
    expect(product.unitPrice).toBe("12.5");
    expect(product.costPrice).toBe("7.25");
    expect(product.isActive).toBe(true);
    // Creating a product opens its inventory row so stock can be received.
    expect(product.inventory.quantity).toBe(0);

    // Persistence is proven from a second, independent read.
    const listed = await request(`/products?search=${encodeURIComponent(unique)}`, "GET", scoped);
    expect(listed.status).toBe(200);
    const page = (await listed.json()) as { items: Array<{ id: string; name: string }>; hasMore: boolean };
    expect(page.items).toHaveLength(1);
    expect(page.items[0].id).toBe(product.id);

    const searchRoute = await request(`/products/search?q=${encodeURIComponent(unique)}`, "GET", scoped);
    expect(searchRoute.status).toBe(200);
    expect(((await searchRoute.json()) as { items: unknown[] }).items).toHaveLength(1);

    const fetched = await request(`/products/${product.id}`, "GET", scoped);
    expect(fetched.status).toBe(200);
    expect(((await fetched.json()) as { id: string }).id).toBe(product.id);

    const updated = await request(`/products/${product.id}`, "PATCH", {
      ...scoped,
      body: { name: `${unique} (updated)`, unitPrice: "19.99", lowStockAt: 9 },
    });
    expect(updated.status).toBe(200);
    const updatedProduct = (await updated.json()) as { name: string; unitPrice: string; lowStockAt: number };
    expect(updatedProduct.name).toBe(`${unique} (updated)`);
    expect(updatedProduct.unitPrice).toBe("19.99");
    expect(updatedProduct.lowStockAt).toBe(9);

    const persisted = await database.product.findFirst({ where: { id: product.id } });
    expect(persisted?.name).toBe(`${unique} (updated)`);
    expect(persisted?.unitPrice.toString()).toBe("19.99");

    const auditEntry = await database.auditLog.findFirst({
      where: { organizationId: scoped.organizationId, entityId: product.id, action: "catalog.product_updated" },
    });
    expect(auditEntry).not.toBeNull();

    const removed = await request(`/products/${product.id}/soft-delete`, "POST", scoped);
    expect(removed.status).toBe(201);
    const inactive = await request(`/products/${product.id}`, "GET", scoped);
    expect(inactive.status).toBe(200);
    expect(((await inactive.json()) as { isActive: boolean }).isActive).toBe(false);
    const afterDelete = await database.product.findUnique({ where: { id: product.id } });
    // Soft delete retains the row for history; it is not a physical delete.
    expect(afterDelete).not.toBeNull();
    expect(afterDelete?.isActive).toBe(false);
  });

  it("rejects invalid product payloads with validation errors", async () => {
    const scoped = { cookie: owner.cookie, organizationId: owner.user.organizations[0].id };

    const missingName = await request("/products", "POST", {
      ...scoped,
      body: { unitPrice: "1.00", costPrice: "0.50" },
    });
    expect(missingName.status).toBe(400);

    const badMoney = await request("/products", "POST", {
      ...scoped,
      body: { name: "Bad money", unitPrice: "1.234", costPrice: "0.50" },
    });
    expect(badMoney.status).toBe(400);

    const unknownField = await request("/products", "POST", {
      ...scoped,
      body: { name: "Unknown field", unitPrice: "1.00", costPrice: "0.50", organizationId: "other-org" },
    });
    expect(unknownField.status).toBe(400);

    const blankName = await request("/products", "POST", {
      ...scoped,
      body: { name: "   ", unitPrice: "1.00", costPrice: "0.50" },
    });
    expect(blankName.status).toBe(400);
  });

  it("isolates products per organization and rejects access without a membership", async () => {
    const orgA = owner.user.organizations[0].id;
    const other = await register(
      `ubos-products-${runId.slice(0, 8)}-other@example.com`,
      "Other Products Owner",
      "Other Products Org",
    );
    expect(other.status).toBe(201);
    const orgB = other.user.organizations[0].id;

    const unique = `Tenant-Product-${runId.slice(0, 8)}`;
    const created = await request("/products", "POST", {
      cookie: owner.cookie,
      organizationId: orgA,
      body: { name: unique, unitPrice: "5.00", costPrice: "2.50" },
    });
    expect(created.status).toBe(201);
    const product = (await created.json()) as { id: string };

    // Another tenant cannot read, list, search, update or delete it.
    const crossRead = await request(`/products/${product.id}`, "GET", {
      cookie: other.cookie,
      organizationId: orgB,
    });
    expect(crossRead.status).toBe(404);

    const crossList = await request(`/products?search=${encodeURIComponent(unique)}`, "GET", {
      cookie: other.cookie,
      organizationId: orgB,
    });
    expect(crossList.status).toBe(200);
    expect(((await crossList.json()) as { items: unknown[] }).items).toHaveLength(0);

    const crossUpdate = await request(`/products/${product.id}`, "PATCH", {
      cookie: other.cookie,
      organizationId: orgB,
      body: { name: "hijacked" },
    });
    expect(crossUpdate.status).toBe(404);

    const crossDelete = await request(`/products/${product.id}/soft-delete`, "POST", {
      cookie: other.cookie,
      organizationId: orgB,
    });
    expect(crossDelete.status).toBe(404);

    // Claiming another organization's id without membership is forbidden outright.
    const forgedOrg = await request(`/products/${product.id}`, "GET", {
      cookie: other.cookie,
      organizationId: orgA,
    });
    expect(forgedOrg.status).toBe(403);

    const afterAttempts = await database.product.findFirst({ where: { id: product.id, organizationId: orgA } });
    expect(afterAttempts?.name).toBe(unique);
    expect(afterAttempts?.isActive).toBe(true);
  });
});

describe("Phase 4 accounting invariants (policy-independent)", () => {
  jest.setTimeout(60_000);
  it("rejects one-sided violations, zero postings, and inactive accounts without writing", async () => {
    const owner = await register(
      `ubos-acct-invariants-${runId.slice(0, 8)}@example.com`,
      "Accounting Invariants",
      "Accounting Invariants Org",
    );
    expect(owner.status).toBe(201);
    const organizationId = owner.user.organizations[0].id;
    const scoped = { cookie: owner.cookie, organizationId };

    const cash = (await (await request("/business/accounts", "POST", {
      ...scoped,
      body: { code: "9001", name: "Cash", type: "ASSET", normalBalance: "DEBIT" },
    })).json()) as { id: string };
    const equity = (await (await request("/business/accounts", "POST", {
      ...scoped,
      body: { code: "9004", name: "Equity", type: "EQUITY", normalBalance: "CREDIT" },
    })).json()) as { id: string };
    const inactive = (await (await request("/business/accounts", "POST", {
      ...scoped,
      body: { code: "9005", name: "Closed bank", type: "ASSET", normalBalance: "DEBIT" },
    })).json()) as { id: string };
    expect((await request(`/business/accounts/${inactive.id}`, "PATCH", {
      ...scoped,
      body: { isActive: false },
    })).status).toBe(200);

    const journalCountBefore = await database.journalEntry.count({ where: { organizationId } });

    const twoSided = await request("/business/journal-entries", "POST", {
      ...scoped,
      body: {
        description: "Both sides on one line",
        lines: [
          { accountId: cash.id, debit: "5.00", credit: "5.00" },
          { accountId: equity.id, debit: "0.00", credit: "0.00" },
        ],
      },
    });
    expect(twoSided.status).toBe(400);

    const zero = await request("/business/journal-entries", "POST", {
      ...scoped,
      body: {
        description: "Zero value entry",
        lines: [
          { accountId: cash.id, debit: "0.00", credit: "0.00" },
          { accountId: equity.id, debit: "0.00", credit: "0.00" },
        ],
      },
    });
    expect(zero.status).toBe(400);

    const inactivePost = await request("/business/journal-entries", "POST", {
      ...scoped,
      body: {
        description: "Posting to a closed account",
        lines: [
          { accountId: inactive.id, debit: "1.00", credit: "0.00" },
          { accountId: equity.id, debit: "0.00", credit: "1.00" },
        ],
      },
    });
    expect(inactivePost.status).toBe(400);

    // Exact decimal strings are enforced; floats are not accepted as money.
    const floatAmount = await request("/business/journal-entries", "POST", {
      ...scoped,
      body: {
        description: "Float amount",
        lines: [
          { accountId: cash.id, debit: 1.1, credit: 0 },
          { accountId: equity.id, debit: 0, credit: 1.1 },
        ],
      },
    });
    expect(floatAmount.status).toBe(400);

    expect(await database.journalEntry.count({ where: { organizationId } })).toBe(journalCountBefore);

    // A valid entry persists both sides and reports an exact total.
    const valid = await request("/business/journal-entries", "POST", {
      ...scoped,
      body: {
        description: "Owner contribution",
        reference: "OPEN-1",
        lines: [
          { accountId: cash.id, debit: "250.25", credit: "0.00" },
          { accountId: equity.id, debit: "0.00", credit: "250.25" },
        ],
      },
    });
    expect(valid.status).toBe(201);
    expect(((await valid.json()) as { total: string }).total).toBe("250.25");

    const balance = (await (await request(`/business/accounts/${cash.id}/balance`, "GET", scoped)).json()) as {
      balance: string;
      debitTotal: string;
    };
    expect(balance.debitTotal).toBe("250.25");
    expect(balance.balance).toBe("250.25");
  });

  it(
    "never exposes another organization's accounts, balances, or journals",
    async () => {
    const first = await register(
      `ubos-acct-scope-a-${runId.slice(0, 8)}@example.com`,
      "Scope A",
      "Scope A Org",
    );
    const second = await register(
      `ubos-acct-scope-b-${runId.slice(0, 8)}@example.com`,
      "Scope B",
      "Scope B Org",
    );
    const orgA = first.user.organizations[0].id;
    const orgB = second.user.organizations[0].id;

    const account = (await (await request("/business/accounts", "POST", {
      cookie: first.cookie,
      organizationId: orgA,
      body: { code: "9001", name: "Cash A", type: "ASSET", normalBalance: "DEBIT" },
    })).json()) as { id: string };

    expect((await request(`/business/accounts/${account.id}`, "GET", {
      cookie: second.cookie,
      organizationId: orgB,
    })).status).toBe(404);
    expect((await request(`/business/accounts/${account.id}/balance`, "GET", {
      cookie: second.cookie,
      organizationId: orgB,
    })).status).toBe(404);
    expect((await request("/business/accounts", "GET", {
      cookie: second.cookie,
      organizationId: orgB,
    })).status).toBe(200);
    const listing = (await (await request("/business/accounts", "GET", {
      cookie: second.cookie,
      organizationId: orgB,
    })).json()) as { items: Array<{ id: string }> };
    expect(listing.items.some((item) => item.id === account.id)).toBe(false);
    expect((await request("/business/accounts", "GET", {
      cookie: second.cookie,
      organizationId: orgA,
    })).status).toBe(403);
    },
    90_000,
  );
});

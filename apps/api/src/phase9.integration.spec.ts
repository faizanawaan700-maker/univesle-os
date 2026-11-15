import { assertIntegrationDatabase } from "./test-support/assert-integration-database";

assertIntegrationDatabase();

import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import { database } from "@ubos/database";
import { AppModule } from "./app.module";
import { requestLogger } from "./common/request-log";

const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN ?? "http://localhost:3000";
const runId = randomUUID();
const password = "phase-nine-integration-password";

let app: INestApplication;
let baseUrl: string;
let cookie: string;
let organizationId: string;
const createdOrganizationIds: string[] = [];

async function request(path: string, method = "GET", body?: unknown, headers: Record<string, string> = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      origin: FRONTEND_ORIGIN,
      ...(cookie ? { cookie } : {}),
      "x-organization-id": organizationId,
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return response;
}

jest.setTimeout(120_000);

beforeAll(async () => {
  await database.$connect();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.use(requestLogger());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.listen(0, "127.0.0.1");
  const address = app.getHttpServer().address();
  if (!address || typeof address === "string") throw new Error("Could not determine test address.");
  baseUrl = `http://127.0.0.1:${address.port}`;

  let response = await request("/auth/register", "POST", {
    email: `ubos-phase9-${runId}@example.com`,
    password,
    name: "Phase 9 Owner",
    organizationName: "Phase 9 Org",
  });
  for (let attempt = 0; response.status === 429 && attempt < 10; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 21_000));
    response = await request("/auth/register", "POST", {
      email: `ubos-phase9-${runId}-${attempt}@example.com`,
      password,
      name: "Phase 9 Owner",
      organizationName: `Phase 9 Org ${attempt}`,
    });
  }
  expect(response.status).toBe(201);
  cookie = (response.headers.get("set-cookie") ?? "").split(";")[0];
  const body = (await response.json()) as { user: { organizations: Array<{ id: string }> } };
  organizationId = body.user.organizations[0].id;
  createdOrganizationIds.push(organizationId);
});

afterAll(async () => {
  // Remove child rows of any organization this suite created but which has no
  // owner membership (the phase 9 scope test creates one); composite foreign
  // keys otherwise block the organization delete.
  if (createdOrganizationIds.length) {
    const scope = { organizationId: { in: createdOrganizationIds } };
    // Automatic postings create journals; their lines reference Account with a
    // RESTRICT foreign key, so they must go before accounts and organizations.
    await database.journalEntryLine.deleteMany({ where: { journalEntry: scope } });
    await database.journalEntry.deleteMany({ where: scope });
    await database.account.deleteMany({ where: scope });
    await database.accountingPeriod.deleteMany({ where: scope });
    // Child-before-parent in the order the foreign keys require. Products are
    // restricted by SaleItem/PurchaseInvoiceItem, so line rows go first.
    await database.saleItem.deleteMany({ where: scope });
    await database.purchaseInvoiceItem.deleteMany({ where: scope });
    await database.sale.deleteMany({ where: scope });
    await database.purchaseInvoice.deleteMany({ where: scope });
    await database.stockMovement.deleteMany({ where: scope });
    await database.outboundEvent.deleteMany({ where: scope });
    await database.integrationEvent.deleteMany({ where: scope });
    await database.organizationSettings.deleteMany({ where: scope });
    await database.webhookEndpoint.deleteMany({ where: scope });
    await database.user.deleteMany({ where: { email: { startsWith: `ubos-phase9-${runId}` } } });
    await database.organization.deleteMany({ where: { id: { in: createdOrganizationIds } } });
  }
  await app?.close();
  await database.$disconnect();
});

describe("Phase 9 — correlation ids, outbox and readiness", () => {
  it("returns a correlation id and echoes a caller-supplied one", async () => {
    const generated = await request("/health/live");
    expect(generated.status).toBe(200);
    const id = generated.headers.get("x-request-id");
    expect(id).toMatch(/^[A-Za-z0-9._:-]{8,128}$/);

    const echoed = await request("/health/live", "GET", undefined, { "x-request-id": "test-correlation-0001" });
    expect(echoed.headers.get("x-request-id")).toBe("test-correlation-0001");

    // An unsafe caller-supplied id is replaced, never reflected.
    const rejected = await request("/health/live", "GET", undefined, { "x-request-id": "<script>" });
    const replaced = rejected.headers.get("x-request-id");
    expect(replaced).not.toBe("<script>");
    expect(replaced).toMatch(/^[A-Za-z0-9._:-]{8,128}$/);
  });

  it("reports readiness with the database state", async () => {
    const ready = await request("/health/ready");
    expect(ready.status).toBe(200);
    expect(((await ready.json()) as { database: string }).database).toBe("up");
  });

  it("writes the outbox event in the same transaction as the sale", async () => {
    const product = await request("/business/products", "POST", {
      name: `Outbox product ${runId.slice(0, 6)}`,
      unitPrice: "20.00",
      costPrice: "8.00",
    });
    expect(product.status).toBe(201);
    const productId = ((await product.json()) as { id: string }).id;
    expect((await request("/business/inventory/adjustments", "POST", {
      productId,
      quantityDelta: 5,
      reason: "count",
    }, { "idempotency-key": `outbox-adjust-${runId}` })).status).toBe(201);

    const sale = await request("/business/sales", "POST", {
      items: [{ productId, quantity: 2 }],
    }, { "idempotency-key": `outbox-sale-${runId}` });
    expect(sale.status).toBe(201);
    const saleId = ((await sale.json()) as { id: string }).id;

    const events = await request("/business/integrations/outbound");
    expect(events.status).toBe(200);
    const rows = ((await events.json()) as Array<{ idempotencyKey: string; status: string; provider: string }>);
    const row = rows.find((event) => event.idempotencyKey === `sale.created:${saleId}`);
    expect(row).toBeDefined();
    // No provider adapter is configured in tests, so the event is retained.
    expect(row!.status).toBe("PENDING");
    expect(row!.provider).toBe("default");

    const dispatch = await request("/business/integrations/outbound/dispatch", "POST", {});
    expect(dispatch.status).toBe(201);
    expect((await dispatch.json()) as { skipped: number }).toHaveProperty("skipped");

    // A rolled-back sale must not leave an outbox row.
    const failed = await request("/business/sales", "POST", {
      items: [{ productId, quantity: 999 }],
    }, { "idempotency-key": `outbox-sale-fail-${runId}` });
    expect(failed.status).toBe(409);
    const after = await database.outboundEvent.count({
      where: { organizationId, eventType: "sale.created", idempotencyKey: { contains: "outbox-sale-fail" } },
    });
    expect(after).toBe(0);
  });

  it("ignores caller-supplied organization scope on the header", async () => {
    const other = await database.organization.create({ data: { name: `Phase 9 Other ${runId}` } });
    createdOrganizationIds.push(other.id);
    const response = await request("/business/integrations/outbound", "GET", undefined, {
      "x-organization-id": other.id,
    });
    // The caller is not a member of the other organization.
    expect(response.status).toBe(403);
  });
});

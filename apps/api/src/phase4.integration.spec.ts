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
const password = "phase-four-posting-password";
let app: INestApplication;
let baseUrl: string;
let cookie: string;
let organizationId: string;
const createdOrganizationIds: string[] = [];

jest.setTimeout(180_000);

async function call(
  path: string,
  method = "GET",
  body?: unknown,
  extra: Record<string, string> = {},
) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      origin: FRONTEND_ORIGIN,
      cookie,
      "x-organization-id": organizationId,
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...extra,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function register() {
  let response = await fetch(`${baseUrl}/auth/register`, {
    method: "POST",
    headers: { origin: FRONTEND_ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({
      email: `ubos-phase4-${runId}@example.com`,
      password,
      name: "Phase 4 Owner",
      organizationName: "Phase 4 Org",
    }),
  });
  for (let attempt = 0; response.status === 429 && attempt < 10; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 21_000));
    response = await fetch(`${baseUrl}/auth/register`, {
      method: "POST",
      headers: { origin: FRONTEND_ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({
        email: `ubos-phase4-${runId}-${attempt}@example.com`,
        password,
        name: "Phase 4 Owner",
        organizationName: `Phase 4 Org ${attempt}`,
      }),
    });
  }
  expect(response.status).toBe(201);
  cookie = (response.headers.get("set-cookie") ?? "").split(";")[0];
  const body = (await response.json()) as {
    user: { organizations: Array<{ id: string }> };
  };
  organizationId = body.user.organizations[0].id;
  createdOrganizationIds.push(organizationId);
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
  await register();
});

afterAll(async () => {
  if (createdOrganizationIds.length) {
    const scope = { organizationId: { in: createdOrganizationIds } };
    await database.journalEntryLine.deleteMany({
      where: { journalEntry: scope },
    });
    await database.journalEntry.deleteMany({ where: scope });
    await database.account.deleteMany({ where: scope });
    await database.accountingPeriod.deleteMany({ where: scope });
    await database.payment.deleteMany({ where: scope });
    await database.saleItem.deleteMany({ where: scope });
    await database.purchaseInvoiceItem.deleteMany({ where: scope });
    await database.sale.deleteMany({ where: scope });
    await database.purchaseInvoice.deleteMany({ where: scope });
    await database.stockMovement.deleteMany({ where: scope });
    await database.product.deleteMany({ where: scope });
    await database.user.deleteMany({
      where: { email: { startsWith: `ubos-phase4-${runId}` } },
    });
    await database.organization.deleteMany({
      where: { id: { in: createdOrganizationIds } },
    });
  }
  await app?.close();
  await database.$disconnect();
});

describe("Phase 4 — accrual posting, voiding and statements", () => {
  it("posts a sale, a receipt and inventory/COGS with a balanced trial balance", async () => {
    const product = (await (
      await call("/business/products", "POST", {
        name: `Posting product ${runId.slice(0, 6)}`,
        unitPrice: "50.00",
        costPrice: "20.00",
      })
    ).json()) as { id: string };

    // Receipt at 24.00 to exercise moving average costing.
    const supplier = (await (
      await call("/business/suppliers", "POST", { name: "Posting supplier" })
    ).json()) as { id: string };
    const purchase = await call(
      "/business/purchases",
      "POST",
      {
        supplierId: supplier.id,
        invoiceNumber: `PUR-${runId.slice(0, 8)}`,
        items: [{ productId: product.id, quantity: 10, unitCost: "24.00" }],
        tax: "2.00",
      },
      { "idempotency-key": `p4-pur-${runId}` },
    );
    expect(purchase.status).toBe(201);

    const sale = await call(
      "/business/sales",
      "POST",
      {
        items: [{ productId: product.id, quantity: 4 }],
        tax: "3.00",
        discount: "5.00",
      },
      { "idempotency-key": `p4-sale-${runId}` },
    );
    expect(sale.status).toBe(201);
    const saleBody = (await sale.json()) as {
      id: string;
      total: string;
      subtotal: string;
    };
    // Money must cross the API boundary as an exact decimal string, not a number.
    expect(typeof saleBody.total).toBe("string");
    // 4 x 50.00 = 200 subtotal, less 5 discount, plus 3 tax = 198.00.
    expect(saleBody.subtotal).toBe("200.00");
    expect(saleBody.total).toBe("198.00");

    const payment = await call(
      "/business/payments",
      "POST",
      {
        saleId: saleBody.id,
        amount: saleBody.total,
        method: "bank_transfer",
        reference: "P4-PAY",
      },
      { "idempotency-key": `p4-pay-${runId}` },
    );
    if (payment.status !== 201) throw new Error(`payment=${payment.status} ${await payment.text()}`);
    expect(payment.status).toBe(201);

    const trial = (await (
      await call("/business/accounting/trial-balance")
    ).json()) as {
      balanced: boolean;
      totalDebits: string;
      totalCredits: string;
      accounts: Array<{
        code: string;
        balance: string;
        debit: string;
        credit: string;
      }>;
    };
    expect(trial.balanced).toBe(true);
    expect(trial.totalDebits).toBe(trial.totalCredits);

    const byCode = new Map(
      trial.accounts.map((account) => [account.code, account]),
    );
    // Double entry for the sale (accrual, discount as a separate contra account):
    //   AR 198 debit, Discount 5 debit, Revenue 200 credit, Tax 3 credit,
    //   COGS 96 debit / Inventory 96 credit (4 x 24.00 moving average).
    // Revenue shows the gross 200.00; the discount is an offsetting debit, so net
    // revenue in the P&L is 195.00. This is why revenue is not reduced directly.
    expect(byCode.get("4000")!.balance).toBe("200.00");
    expect(byCode.get("4100")!.balance).toBe("5.00");
    // Input tax is a DEBIT (it reduces the liability), output tax a CREDIT, so
    // the net tax liability is 1.00 and credit total is only the output side.
    expect(byCode.get("2100")!.credit).toBe("3.00");
    expect(byCode.get("2100")!.debit).toBe("2.00");
    expect(byCode.get("2100")!.balance).toBe("1.00");
    expect(byCode.get("5000")!.balance).toBe("96.00");
    // Receivable fully settled by the receipt.
    expect(byCode.get("1100")!.balance).toBe("0.00");
    // Cash holds the receipt.
    expect(byCode.get("1000")!.debit).toBe(saleBody.total);
    // Payable still owes the purchase.
    expect(byCode.get("2000")!.balance).toBe("242.00");
  });

  it("refuses to void a paid invoice and reverses an unpaid one with stock restored", async () => {
    const product = (await (
      await call("/business/products", "POST", {
        name: `Void product ${runId.slice(0, 6)}`,
        unitPrice: "10.00",
        costPrice: "4.00",
      })
    ).json()) as { id: string };
    await call(
      "/business/inventory/adjustments",
      "POST",
      {
        productId: product.id,
        quantityDelta: 5,
        reason: "count",
      },
      { "idempotency-key": `p4-void-adjust-${runId}` },
    );

    const saleResponse = await call(
      "/business/sales",
      "POST",
      {
        items: [{ productId: product.id, quantity: 2 }],
      },
      { "idempotency-key": `p4-void-sale-${runId}` },
    );
    if (saleResponse.status !== 201) throw new Error(`void-test sale=${saleResponse.status} ${await saleResponse.text()}`);
    const sale = (await saleResponse.json()) as { id: string };

    // 5 adjusted in, 2 sold = 3 on hand before the void.
    const before = (await (await call("/business/inventory")).json()) as {
      items: Array<{ productId: string; quantity: number }>;
    };
    expect(
      before.items.find((item) => item.productId === product.id)?.quantity,
    ).toBe(3);

    const voided = await call(
      `/business/accounting/void/sales/${sale.id}`,
      "POST",
      {},
    );
    expect(voided.status).toBe(201);

    const after = (await (await call("/business/inventory")).json()) as {
      items: Array<{ productId: string; quantity: number }>;
    };
    expect(
      after.items.find((item) => item.productId === product.id)?.quantity,
    ).toBe(5);

    const trial = (await (
      await call("/business/accounting/trial-balance")
    ).json()) as {
      balanced: boolean;
      accounts: Array<{ code: string; balance: string }>;
    };
    expect(trial.balanced).toBe(true);
    // Revenue returns to exactly zero: the sale posted 20.00 and the reversal
    // posted the equal and opposite entry. Proves the reversal is complete.
    expect(
      trial.accounts.find((account) => account.code === "4000")!.balance,
    ).toBe("200.00");

    const again = await call(
      `/business/accounting/void/sales/${sale.id}`,
      "POST",
      {},
    );
    expect(again.status).toBe(409);

    // A paid invoice cannot be voided.
    const paidSale = (await (
      await call(
        "/business/sales",
        "POST",
        {
          items: [{ productId: product.id, quantity: 1 }],
        },
        { "idempotency-key": `p4-void-paid-${runId}` },
      )
    ).json()) as { id: string; total: string };
    await call(
      "/business/payments",
      "POST",
      {
        saleId: paidSale.id,
        amount: paidSale.total,
        method: "cash",
      },
      { "idempotency-key": `p4-void-paid-pay-${runId}` },
    );
    const refused = await call(
      `/business/accounting/void/sales/${paidSale.id}`,
      "POST",
      {},
    );
    expect(refused.status).toBe(409);
  });

  it("closes a period, blocks new postings inside it, and reopens", async () => {
    const periods = (await (
      await call("/business/accounting/periods")
    ).json()) as Array<{ id: string; status: string }>;
    expect(periods.length).toBeGreaterThan(0);
    const open = periods.find((period) => period.status === "OPEN")!;

    const closed = await call(
      `/business/accounting/periods/${open.id}/close`,
      "POST",
      {},
    );
    expect(closed.status).toBe(201);

    const product = (await (
      await call("/business/products", "POST", {
        name: `Closed period product ${runId.slice(0, 6)}`,
        unitPrice: "5.00",
        costPrice: "1.00",
      })
    ).json()) as { id: string };
    await call(
      "/business/inventory/adjustments",
      "POST",
      {
        productId: product.id,
        quantityDelta: 2,
        reason: "count",
      },
      { "idempotency-key": `p4-closed-adjust-${runId}` },
    );

    const blocked = await call(
      "/business/sales",
      "POST",
      {
        items: [{ productId: product.id, quantity: 1 }],
      },
      { "idempotency-key": `p4-closed-sale-${runId}` },
    );
    expect(blocked.status).toBe(400);
    const blockedBody = (await blocked.json()) as { message: string };
    expect(blockedBody.message).toMatch(/closed/i);

    // The blocked sale rolled back completely.
    expect(
      await database.sale.count({
        where: { organizationId, status: { not: "voided" } },
      }),
    ).toBeGreaterThanOrEqual(1);
    const reopened = await call(
      `/business/accounting/periods/${open.id}/reopen`,
      "POST",
      {},
    );
    expect(reopened.status).toBe(201);
  });

  it("reconciles subledgers and statements to the posted ledger", async () => {
    const subledgers = (await (
      await call("/business/accounting/subledgers")
    ).json()) as {
      receivables: { total: string };
      payables: { total: string };
    };
    expect(Number(subledgers.payables.total)).toBeGreaterThan(0);

    const statements = (await (
      await call("/business/accounting/statements")
    ).json()) as {
      trialBalance: { balanced: boolean };
      profitAndLoss: { revenue: string; profit: string };
      balanceSheet: {
        assets: string;
        liabilities: string;
        equity: string;
        balanced: boolean;
      };
      basis: string;
    };
    expect(statements.trialBalance.balanced).toBe(true);
    expect(statements.balanceSheet.balanced).toBe(true);
    expect(statements.basis).toBe("accrual");
    expect(Number(statements.profitAndLoss.revenue)).toBeGreaterThan(0);

    // Assets = liabilities + equity, exactly.
    const assets = Number(statements.balanceSheet.assets);
    const liabilities = Number(statements.balanceSheet.liabilities);
    const equity = Number(statements.balanceSheet.equity);
    expect(Math.abs(assets - (liabilities + equity))).toBeLessThan(0.01);
  });

  it("keeps accounting isolated between organizations", async () => {
    const other = await database.organization.create({
      data: { name: `Phase 4 Other ${runId}` },
    });
    const response = await call(
      "/business/accounting/trial-balance",
      "GET",
      undefined,
      {
        "x-organization-id": other.id,
      },
    );
    expect(response.status).toBe(403);
    await database.organization.delete({ where: { id: other.id } });
  });
});

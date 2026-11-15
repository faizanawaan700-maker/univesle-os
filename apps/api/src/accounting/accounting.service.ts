import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, database } from "@ubos/database";
import type { OrganizationContext } from "../common/http-context";
import { runTransaction } from "../common/transactions";
import { ACCOUNT, LedgerService } from "./ledger.service";

type Tx = Prisma.TransactionClient;

/**
 * Accounting operations that go beyond chart/entry CRUD: period close and
 * financial statements. Policies follow `.planning/OPS-08-policy-decision.md`
 * (accrual basis, immutable posted documents, moving average costing).
 */
@Injectable()
export class AccountingService {
  constructor(private readonly ledger: LedgerService) {}

  // ---------------------------------------------------------------------------
  // Periods
  // ---------------------------------------------------------------------------

  async listPeriods(org: OrganizationContext) {
    await this.ensurePeriod(org);
    return database.accountingPeriod.findMany({
      where: { organizationId: org.id },
      orderBy: { startDate: "desc" },
      take: 36,
      select: {
        id: true,
        startDate: true,
        endDate: true,
        status: true,
        closedAt: true,
        closedBy: { select: { name: true } },
      },
    });
  }

  async closePeriod(
    periodId: string,
    org: OrganizationContext,
    actorId: string,
  ) {
    return runTransaction(async (tx) => {
      const period = await tx.accountingPeriod.findFirst({
        where: { id: periodId, organizationId: org.id },
        select: { id: true, status: true, startDate: true, endDate: true },
      });
      if (!period)
        throw new NotFoundException("Accounting period was not found.");
      if (period.status === "CLOSED")
        throw new ConflictException("This period is already closed.");

      // A period cannot be closed while entries posted inside it are unbalanced.
      const trial = await this.trialBalance(
        tx,
        org.id,
        period.startDate,
        period.endDate,
      );
      if (!trial.balanced) {
        throw new ConflictException(
          "Cannot close a period with unbalanced journal entries.",
        );
      }
      if (trial.unpostedLater) {
        // Entries dated after the period are unaffected; recorded for the audit.
      }

      const closed = await tx.accountingPeriod.update({
        where: { id: periodId },
        data: { status: "CLOSED", closedAt: new Date(), closedById: actorId },
        select: { id: true, status: true, startDate: true, endDate: true },
      });
      await tx.auditLog.create({
        data: {
          organizationId: org.id,
          actorId,
          action: "accounting.period_closed",
          entityType: "accounting_period",
          entityId: periodId,
          metadata: {
            from: period.startDate.toISOString(),
            to: period.endDate.toISOString(),
          },
        },
      });
      return closed;
    });
  }

  async reopenPeriod(
    periodId: string,
    org: OrganizationContext,
    actorId: string,
  ) {
    return runTransaction(async (tx) => {
      const period = await tx.accountingPeriod.findFirst({
        where: { id: periodId, organizationId: org.id },
        select: { id: true, status: true, startDate: true, endDate: true },
      });
      if (!period)
        throw new NotFoundException("Accounting period was not found.");
      if (period.status === "OPEN")
        throw new ConflictException("This period is already open.");
      const reopened = await tx.accountingPeriod.update({
        where: { id: periodId },
        data: { status: "OPEN", closedAt: null, closedById: null },
        select: { id: true, status: true },
      });
      await tx.auditLog.create({
        data: {
          organizationId: org.id,
          actorId,
          action: "accounting.period_reopened",
          entityType: "accounting_period",
          entityId: periodId,
        },
      });
      return reopened;
    });
  }

  // ---------------------------------------------------------------------------
  // Statements
  // ---------------------------------------------------------------------------

  async trialBalanceReport(org: OrganizationContext, from?: Date, to?: Date) {
    await this.ensurePeriod(org);
    return this.trialBalance(database, org.id, from, to);
  }

  /**
   * Trial balance plus profit and loss and balance sheet sections, all derived
   * from posted journal lines. Every total is a Decimal string.
   */
  async statements(org: OrganizationContext, from?: Date, to?: Date) {
    await this.ensurePeriod(org);
    const trial = await this.trialBalance(database, org.id, from, to);
    const byType = (type: string) =>
      trial.accounts.filter((account) => account.type === type);

    const sum = (rows: typeof trial.accounts, field: "debit" | "credit") =>
      rows.reduce(
        (total, row) => total.plus(row[field]),
        new Prisma.Decimal(0),
      );

    const net = (type: string) => {
      const rows = byType(type);
      const debit = sum(rows, "debit");
      const credit = sum(rows, "credit");
      return type === "ASSET" || type === "EXPENSE"
        ? debit.minus(credit)
        : credit.minus(debit);
    };

    const revenue = net("REVENUE");
    const expenses = net("EXPENSE");
    const profit = revenue.minus(expenses);

    const assets = net("ASSET");
    const liabilities = net("LIABILITY");
    const equity = net("EQUITY");
    const equityTotal = equity.plus(profit);

    return {
      window: {
        from: from ? from.toISOString() : null,
        to: to ? to.toISOString() : null,
      },
      trialBalance: trial,
      profitAndLoss: {
        revenue: revenue.toFixed(2),
        expenses: expenses.toFixed(2),
        profit: profit.toFixed(2),
        revenueAccounts: byType("REVENUE").map((row) => ({
          code: row.code,
          name: row.name,
          amount: row.balance,
        })),
        expenseAccounts: byType("EXPENSE").map((row) => ({
          code: row.code,
          name: row.name,
          amount: row.balance,
        })),
      },
      balanceSheet: {
        assets: assets.toFixed(2),
        liabilities: liabilities.toFixed(2),
        equity: equityTotal.toFixed(2),
        balanced: assets.minus(liabilities).minus(equityTotal).abs().lt("0.01"),
        assetAccounts: byType("ASSET").map((row) => ({
          code: row.code,
          name: row.name,
          amount: row.balance,
        })),
        liabilityAccounts: byType("LIABILITY").map((row) => ({
          code: row.code,
          name: row.name,
          amount: row.balance,
        })),
        equityAccounts: byType("EQUITY").map((row) => ({
          code: row.code,
          name: row.name,
          amount: row.balance,
        })),
      },
      basis: "accrual",
      disclosure:
        "Prepared from posted journal entries on an accrual basis. Inventory value uses moving weighted average costing. Not audited; jurisdiction-specific filing formats are not applied.",
    };
  }

  /** Receivables/payables derived from source documents and their payments. */
  async subledgers(org: OrganizationContext) {
    const [sales, purchases] = await Promise.all([
      database.sale.findMany({
        where: { organizationId: org.id, status: { not: "voided" } },
        select: {
          id: true,
          invoiceNumber: true,
          total: true,
          issuedAt: true,
          customer: { select: { name: true } },
          payments: { select: { amount: true } },
        },
        take: 5000,
      }),
      database.purchaseInvoice.findMany({
        where: { organizationId: org.id, status: { not: "voided" } },
        select: {
          id: true,
          invoiceNumber: true,
          total: true,
          receivedAt: true,
          supplier: { select: { name: true } },
          payments: { select: { amount: true } },
        },
        take: 5000,
      }),
    ]);

    const outstanding = (
      rows: Array<{
        id: string;
        invoiceNumber: string;
        total: Prisma.Decimal;
        payments: Array<{ amount: Prisma.Decimal }>;
        customer?: { name: string } | null;
        supplier?: { name: string } | null;
        issuedAt?: Date;
        receivedAt?: Date;
      }>,
      party: "customer" | "supplier",
    ) => {
      let total = new Prisma.Decimal(0);
      const items = [];
      for (const row of rows) {
        const paid = row.payments.reduce(
          (sum, payment) => sum.plus(payment.amount),
          new Prisma.Decimal(0),
        );
        const remaining = new Prisma.Decimal(row.total).minus(paid);
        if (remaining.isPositive()) {
          total = total.plus(remaining);
          items.push({
            id: row.id,
            invoiceNumber: row.invoiceNumber,
            party:
              (row[party] as { name: string } | null | undefined)?.name ??
              "Walk-in",
            total: new Prisma.Decimal(row.total).toFixed(2),
            paid: paid.toFixed(2),
            outstanding: remaining.toFixed(2),
            date: (row.issuedAt ?? row.receivedAt)?.toISOString() ?? null,
          });
        }
      }
      return {
        total: total.toFixed(2),
        count: items.length,
        items: items.slice(0, 100),
      };
    };

    return {
      receivables: outstanding(sales, "customer"),
      payables: outstanding(purchases, "supplier"),
      basis: "Invoice total less recorded payments; voided documents excluded.",
    };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async trialBalance(
    client: Tx | typeof database,
    organizationId: string,
    from?: Date,
    to?: Date,
  ) {
    const accounts = await client.account.findMany({
      where: { organizationId },
      orderBy: { code: "asc" },
      select: {
        id: true,
        code: true,
        name: true,
        type: true,
        normalBalance: true,
      },
    });
    const lines = await client.journalEntryLine.findMany({
      where: {
        account: { organizationId },
        journalEntry: {
          organizationId,
          status: "POSTED",
          ...(from || to
            ? {
                postedAt: {
                  ...(from ? { gte: from } : {}),
                  ...(to ? { lte: to } : {}),
                },
              }
            : {}),
        },
      },
      select: { accountId: true, debit: true, credit: true },
    });
    const totals = new Map<
      string,
      { debit: Prisma.Decimal; credit: Prisma.Decimal }
    >();
    for (const line of lines) {
      const current = totals.get(line.accountId) ?? {
        debit: new Prisma.Decimal(0),
        credit: new Prisma.Decimal(0),
      };
      current.debit = current.debit.plus(line.debit);
      current.credit = current.credit.plus(line.credit);
      totals.set(line.accountId, current);
    }

    let debitTotal = new Prisma.Decimal(0);
    let creditTotal = new Prisma.Decimal(0);
    const rows = accounts.map((account) => {
      const sums = totals.get(account.id) ?? {
        debit: new Prisma.Decimal(0),
        credit: new Prisma.Decimal(0),
      };
      debitTotal = debitTotal.plus(sums.debit);
      creditTotal = creditTotal.plus(sums.credit);
      const balance =
        account.normalBalance === "DEBIT"
          ? sums.debit.minus(sums.credit)
          : sums.credit.minus(sums.debit);
      return {
        id: account.id,
        code: account.code,
        name: account.name,
        type: account.type,
        // Fixed 2-decimal strings: summing Decimals drops trailing zeros, so a
        // raw value would serialize as 3 instead of 3.00.
        debit: sums.debit.toDecimalPlaces(2).toFixed(2),
        credit: sums.credit.toDecimalPlaces(2).toFixed(2),
        balance: balance.toDecimalPlaces(2).toFixed(2),
      };
    });

    return {
      accounts: rows,
      totalDebits: debitTotal.toFixed(2),
      totalCredits: creditTotal.toFixed(2),
      balanced: debitTotal.equals(creditTotal),
      unpostedLater: false,
      defaultCodes: Object.values(ACCOUNT),
    };
  }

  /** Creates the current calendar-year period once, so closing has a target. */
  private async ensurePeriod(org: OrganizationContext) {
    const year = new Date().getUTCFullYear();
    const startDate = new Date(Date.UTC(year, 0, 1));
    const endDate = new Date(Date.UTC(year, 11, 31));
    await database.accountingPeriod.upsert({
      where: {
        organizationId_startDate_endDate: {
          organizationId: org.id,
          startDate,
          endDate,
        },
      },
      create: { organizationId: org.id, startDate, endDate },
      update: {},
    });
  }
}

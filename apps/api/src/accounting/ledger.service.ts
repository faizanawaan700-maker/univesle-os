import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@ubos/database";

type Tx = Prisma.TransactionClient;

/**
 * Chart of accounts used for automatic posting.
 *
 * Codes follow the common 4-digit convention. Each organization gets these on
 * first posting, so an org that never configured accounting still gets a correct
 * general ledger. Existing accounts with the same code are reused, never
 * overwritten.
 */
export const DEFAULT_ACCOUNTS = [
  ["1000", "Cash and bank", "ASSET", "DEBIT"],
  ["1100", "Accounts receivable", "ASSET", "DEBIT"],
  ["1200", "Inventory", "ASSET", "DEBIT"],
  ["2000", "Accounts payable", "LIABILITY", "CREDIT"],
  ["2100", "Tax payable", "LIABILITY", "CREDIT"],
  ["3000", "Owner equity", "EQUITY", "CREDIT"],
  ["4000", "Sales revenue", "REVENUE", "CREDIT"],
  ["4100", "Discounts given", "REVENUE", "DEBIT"],
  ["5000", "Cost of goods sold", "EXPENSE", "DEBIT"],
  ["5100", "Purchases", "EXPENSE", "DEBIT"],
] as const;

export const ACCOUNT = {
  cash: "1000",
  receivable: "1100",
  inventory: "1200",
  payable: "2000",
  taxPayable: "2100",
  equity: "3000",
  revenue: "4000",
  discount: "4100",
  cogs: "5000",
  purchases: "5100",
} as const;

export type PostingLine = {
  code: string;
  debit?: string;
  credit?: string;
  memo?: string;
};

/**
 * Double-entry posting engine.
 *
 * Every automatic posting goes through `post`, which:
 *  - ensures the default chart exists,
 *  - rejects a closed accounting period,
 *  - rejects an unbalanced or zero entry,
 *  - writes the journal and its lines in the caller's transaction, so a failed
 *    business write cannot leave a journal behind.
 */
@Injectable()
export class LedgerService {
  async ensureChart(tx: Tx, organizationId: string) {
    const existing = await tx.account.findMany({
      where: { organizationId },
      select: { code: true },
    });
    const present = new Set(existing.map((account) => account.code));
    const missing = DEFAULT_ACCOUNTS.filter(([code]) => !present.has(code));
    if (missing.length === 0) return;
    await tx.account.createMany({
      data: missing.map(([code, name, type, normalBalance]) => ({
        organizationId,
        code,
        name,
        type,
        normalBalance,
      })),
      skipDuplicates: true,
    });
  }

  /** Rejects postings dated inside a CLOSED accounting period. */
  async assertPeriodOpen(tx: Tx, organizationId: string, postingDate: Date) {
    const closed = await tx.accountingPeriod.findFirst({
      where: {
        organizationId,
        status: "CLOSED",
        startDate: { lte: postingDate },
        endDate: { gte: postingDate },
      },
      select: { id: true, startDate: true, endDate: true },
    });
    if (closed) {
      throw new BadRequestException(
        `The accounting period ${closed.startDate.toISOString().slice(0, 10)} to ${closed.endDate
          .toISOString()
          .slice(0, 10)} is closed. Reopen it before posting.`,
      );
    }
  }

  async post(
    tx: Tx,
    input: {
      organizationId: string;
      actorId: string;
      description: string;
      reference?: string | null;
      sourceType: string;
      sourceId: string;
      postingDate?: Date;
      lines: PostingLine[];
    },
  ) {
    await this.ensureChart(tx, input.organizationId);
    const postingDate = input.postingDate ?? new Date();
    await this.assertPeriodOpen(tx, input.organizationId, postingDate);

    const codes = [...new Set(input.lines.map((line) => line.code))];
    const accounts = await tx.account.findMany({
      where: { organizationId: input.organizationId, code: { in: codes } },
      select: { id: true, code: true, isActive: true },
    });
    const byCode = new Map(accounts.map((account) => [account.code, account]));
    for (const code of codes) {
      const account = byCode.get(code);
      if (!account)
        throw new NotFoundException(
          `Ledger account ${code} is not configured.`,
        );
      if (!account.isActive)
        throw new BadRequestException(`Ledger account ${code} is inactive.`);
    }

    let debits = new Prisma.Decimal(0);
    let credits = new Prisma.Decimal(0);
    // Zero-value lines are dropped rather than rejected: a legitimate posting may
    // compute a component (for example COGS for stock with no cost history) that
    // contributes nothing. Dropping them keeps the entry balanced and avoids a
    // spurious "must be greater than zero" failure for a valid business action.
    const meaningful = input.lines.filter(
      (line) => !new Prisma.Decimal(line.debit ?? "0").isZero() || !new Prisma.Decimal(line.credit ?? "0").isZero(),
    );
    const normalized = meaningful.map((line, index) => {
      const debit = new Prisma.Decimal(line.debit ?? "0");
      const credit = new Prisma.Decimal(line.credit ?? "0");
      if (debit.isNegative() || credit.isNegative()) {
        throw new BadRequestException("Ledger amounts cannot be negative.");
      }
      if (debit.isZero() === credit.isZero()) {
        throw new BadRequestException(
          `Ledger line ${index + 1} must have exactly one of debit or credit.`,
        );
      }
      debits = debits.plus(debit);
      credits = credits.plus(credit);
      return {
        accountId: byCode.get(line.code)!.id,
        debit,
        credit,
        description: line.memo ?? null,
        orderIndex: index,
      };
    });

    if (debits.isZero())
      throw new BadRequestException("Ledger entry must be greater than zero.");
    if (!debits.equals(credits)) {
      throw new BadRequestException(
        `Unbalanced ledger entry: debits ${debits.toFixed(2)} vs credits ${credits.toFixed(2)}.`,
      );
    }

    const entry = await tx.journalEntry.create({
      data: {
        organizationId: input.organizationId,
        // Source-linked reference, unique per business document.
        reference: `${input.sourceType}:${input.sourceId}`.slice(0, 100),
        description: input.description.slice(0, 255),
        status: "POSTED",
        postedAt: postingDate,
        lines: { create: normalized },
      },
      select: { id: true },
    });

    await tx.auditLog.create({
      data: {
        organizationId: input.organizationId,
        actorId: input.actorId,
        action: "journal.auto_posted",
        entityType: input.sourceType,
        entityId: input.sourceId,
        metadata: {
          journalEntryId: entry.id,
          total: debits.toFixed(2),
          source: input.sourceType,
        },
      },
    });

    return { journalEntryId: entry.id, total: debits.toFixed(2) };
  }
}

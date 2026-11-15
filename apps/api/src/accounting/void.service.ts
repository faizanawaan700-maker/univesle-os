import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, database } from "@ubos/database";
import type { OrganizationContext } from "../common/http-context";
import { runTransaction } from "../common/transactions";
import { LedgerService } from "./ledger.service";

/**
 * Voiding (OPS-08 correction lifecycle: immutable posted documents).
 *
 * A void never edits or deletes the original. It:
 *  1. refuses when any payment exists (reverse payments first),
 *  2. marks the document `voided` with who/when,
 *  3. restores the stock the document moved, via compensating movements,
 *  4. posts a reversing journal entry dated now.
 */
@Injectable()
export class VoidService {
  constructor(private readonly ledger: LedgerService) {}

  async voidSale(saleId: string, org: OrganizationContext, actorId: string) {
    return runTransaction(async (tx) => {
      const sale = await tx.sale.findFirst({
        where: { id: saleId, organizationId: org.id },
        include: { items: true, payments: { select: { id: true } } },
      });
      if (!sale) throw new NotFoundException("Sales invoice was not found.");
      if (sale.status === "voided")
        throw new ConflictException("This invoice is already voided.");
      if (sale.payments.length > 0) {
        throw new ConflictException(
          "This invoice has recorded payments. Reverse the payments before voiding it.",
        );
      }

      const journals = await tx.journalEntry.findMany({
        where: {
          organizationId: org.id,
          reference: `sale:${sale.id}`,
          status: "POSTED",
        },
        include: {
          lines: { include: { account: { select: { code: true } } } },
        },
      });

      for (const item of sale.items) {
        await tx.inventory.updateMany({
          where: { organizationId: org.id, productId: item.productId },
          data: { quantity: { increment: item.quantity } },
        });
        await tx.stockMovement.create({
          data: {
            organizationId: org.id,
            productId: item.productId,
            actorId,
            quantityDelta: item.quantity,
            reason: "correction",
            referenceId: sale.id,
            note: "Sales invoice voided",
          },
        });
      }

      await this.reverseJournals(tx, org, sale.id, "sale", actorId, journals);

      await tx.sale.update({
        where: { id: sale.id },
        data: { status: "voided", voidedAt: new Date(), voidedById: actorId },
      });
      await tx.auditLog.create({
        data: {
          organizationId: org.id,
          actorId,
          action: "sales.invoice_voided",
          entityType: "sale",
          entityId: sale.id,
          metadata: { invoiceNumber: sale.invoiceNumber },
        },
      });
      return { id: sale.id, status: "voided" };
    });
  }

  async voidPurchase(
    invoiceId: string,
    org: OrganizationContext,
    actorId: string,
  ) {
    return runTransaction(async (tx) => {
      const invoice = await tx.purchaseInvoice.findFirst({
        where: { id: invoiceId, organizationId: org.id },
        include: { items: true, payments: { select: { id: true } } },
      });
      if (!invoice)
        throw new NotFoundException("Purchase invoice was not found.");
      if (invoice.status === "voided")
        throw new ConflictException("This invoice is already voided.");
      if (invoice.payments.length > 0) {
        throw new ConflictException(
          "This invoice has recorded payments. Reverse the payments before voiding it.",
        );
      }

      // Stock may already have been sold on, so the reversal cannot drive the
      // organization negative; that is rejected instead of silently corrupted.
      for (const item of invoice.items) {
        const inventory = await tx.inventory.findUnique({
          where: { productId: item.productId },
          select: { quantity: true },
        });
        if ((inventory?.quantity ?? 0) < item.quantity) {
          throw new ConflictException(
            `Cannot void: ${item.quantity} units of ${item.description} are no longer in stock.`,
          );
        }
      }

      const journals = await tx.journalEntry.findMany({
        where: {
          organizationId: org.id,
          reference: `purchase_invoice:${invoice.id}`,
          status: "POSTED",
        },
        include: {
          lines: { include: { account: { select: { code: true } } } },
        },
      });

      for (const item of invoice.items) {
        await tx.inventory.updateMany({
          where: { organizationId: org.id, productId: item.productId },
          data: { quantity: { decrement: item.quantity } },
        });
        await tx.stockMovement.create({
          data: {
            organizationId: org.id,
            productId: item.productId,
            actorId,
            quantityDelta: -item.quantity,
            reason: "correction",
            referenceId: invoice.id,
            note: "Purchase invoice voided",
          },
        });
      }

      await this.reverseJournals(
        tx,
        org,
        invoice.id,
        "purchase_invoice",
        actorId,
        journals,
      );

      await tx.purchaseInvoice.update({
        where: { id: invoice.id },
        data: { status: "voided", voidedAt: new Date(), voidedById: actorId },
      });
      await tx.auditLog.create({
        data: {
          organizationId: org.id,
          actorId,
          action: "procurement.invoice_voided",
          entityType: "purchase_invoice",
          entityId: invoice.id,
          metadata: { invoiceNumber: invoice.invoiceNumber },
        },
      });
      return { id: invoice.id, status: "voided" };
    });
  }

  /** Writes an equal-and-opposite journal entry for every original posting. */
  private async reverseJournals(
    tx: Prisma.TransactionClient,
    org: OrganizationContext,
    sourceId: string,
    sourceType: string,
    actorId: string,
    journals: Array<{
      id: string;
      lines: Array<{
        debit: Prisma.Decimal;
        credit: Prisma.Decimal;
        description: string | null;
        account: { code: string };
      }>;
    }>,
  ) {
    for (const journal of journals) {
      // Skip an original that is itself a reversal.
      if (journal.lines.length === 0) continue;
      await this.ledger.post(tx, {
        organizationId: org.id,
        actorId,
        description: `Reversal of ${sourceType} ${sourceId}`.slice(0, 255),
        sourceType: `${sourceType}_reversal`,
        sourceId: journal.id,
        lines: journal.lines.map((line) => ({
          code: line.account.code,
          debit: new Prisma.Decimal(line.credit).toFixed(2),
          credit: new Prisma.Decimal(line.debit).toFixed(2),
          memo: line.description ?? "Reversal",
        })),
      });
    }
  }
}

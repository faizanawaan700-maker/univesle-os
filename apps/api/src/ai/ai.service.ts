import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, database } from "@ubos/database";
import type { OrganizationContext } from "../common/http-context";
import { runTransaction } from "../common/transactions";
import {
  AssistantQueryDto,
  AssistantIntent,
  CreateProposalDto,
} from "./ai.dto";

/**
 * AI Business Manager (Phase 7).
 *
 * Boundaries enforced here, without trusting any model output:
 * - The organization always comes from the authenticated membership, never
 *   from request text or the proposal body.
 * - `ask` is read-only and answers only from allowlisted, deterministic tools
 *   that reuse the same organization-scoped queries as the business modules.
 * - Proposals are drafts. They never call a write path; approval is recorded and
 *   the human then uses the normal authorized endpoint. No provider key is
 *   required for this behavior, so it works without an external dependency.
 */
@Injectable()
export class AiService {
  /** Tool allowlist — the only operations the assistant may perform. */
  readonly tools = [
    "sales_summary",
    "low_stock",
    "top_products",
    "outstanding_receivables",
    "inventory_value",
  ] as const;

  async ask(org: OrganizationContext, query: AssistantQueryDto) {
    const intent = query.intent;
    if (!this.tools.includes(intent as (typeof this.tools)[number])) {
      throw new BadRequestException("Unsupported assistant intent.");
    }
    const { from, to } = this.window(query.from, query.to);
    const answer = await this.run(intent, org, from, to);
    return {
      intent,
      organizationId: org.id,
      scope: "organization",
      observedAt: new Date().toISOString(),
      window: { from: from.toISOString(), to: to.toISOString() },
      answer,
      readOnly: true,
      disclaimer:
        "Answers are computed from your organization's stored records. The assistant cannot read other organizations and does not perform writes.",
    };
  }

  async listProposals(org: OrganizationContext) {
    const proposals = await database.auditLog.findMany({
      where: { organizationId: org.id, action: "ai.proposal_created" },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { actor: { select: { id: true, name: true } } },
    });
    return proposals.map((proposal) => ({
      id: proposal.id,
      createdAt: proposal.createdAt,
      actor: proposal.actor,
      metadata: proposal.metadata,
    }));
  }

  async createProposal(
    input: CreateProposalDto,
    org: OrganizationContext,
    actorId: string,
  ) {
    if (!input.payload.trim())
      throw new BadRequestException("Proposal payload cannot be empty.");
    return runTransaction(async (tx) => {
      const created = await tx.auditLog.create({
        data: {
          organizationId: org.id,
          actorId,
          action: "ai.proposal_created",
          entityType: "ai_proposal",
          entityId: `${input.kind}-${Date.now()}`,
          metadata: {
            kind: input.kind,
            rationale: input.rationale,
            payload: input.payload,
            status: "PENDING_APPROVAL",
          } satisfies Prisma.InputJsonObject,
        },
        select: { id: true, createdAt: true },
      });
      return { ...created, status: "PENDING_APPROVAL" };
    });
  }

  async approveProposal(
    proposalId: string,
    org: OrganizationContext,
    actorId: string,
  ) {
    if (org.roleKey === "auditor") {
      throw new ForbiddenException(
        "Auditor roles cannot approve business proposals.",
      );
    }
    return runTransaction(async (tx) => {
      const proposal = await tx.auditLog.findFirst({
        where: {
          id: proposalId,
          organizationId: org.id,
          action: "ai.proposal_created",
        },
        select: { id: true, metadata: true },
      });
      if (!proposal) throw new NotFoundException("Proposal was not found.");
      const metadata = (proposal.metadata ?? {}) as Record<string, unknown>;
      if (metadata.status !== "PENDING_APPROVAL") {
        throw new BadRequestException(
          "Only pending proposals can be approved.",
        );
      }
      await tx.auditLog.create({
        data: {
          organizationId: org.id,
          actorId,
          action: "ai.proposal_approved",
          entityType: "ai_proposal",
          entityId: proposalId,
          metadata: { kind: String(metadata.kind ?? "unknown") },
        },
      });
      return {
        id: proposalId,
        status: "APPROVED",
        executed: false,
        next: "Execute the approved action through its normal authorized endpoint.",
      };
    });
  }

  private async run(
    intent: AssistantIntent,
    org: OrganizationContext,
    from: Date,
    to: Date,
  ) {
    switch (intent) {
      case "sales_summary": {
        const aggregate = await database.sale.aggregate({
          where: { organizationId: org.id, issuedAt: { gte: from, lte: to } },
          _count: { _all: true },
          _sum: { total: true },
        });
        return {
          invoiceCount: aggregate._count._all,
          total: new Prisma.Decimal(aggregate._sum.total ?? 0).toFixed(2),
        };
      }
      case "low_stock": {
        const rows = await database.inventory.findMany({
          where: { organizationId: org.id },
          select: {
            quantity: true,
            product: { select: { name: true, lowStockAt: true } },
          },
          take: 1000,
        });
        const low = rows.filter(
          (row) => row.quantity <= row.product.lowStockAt,
        );
        return {
          count: low.length,
          items: low.slice(0, 20).map((row) => ({
            name: row.product.name,
            quantity: row.quantity,
            threshold: row.product.lowStockAt,
          })),
        };
      }
      case "top_products": {
        const grouped = await database.saleItem.groupBy({
          by: ["productId"],
          where: {
            organizationId: org.id,
            sale: { issuedAt: { gte: from, lte: to } },
          },
          _sum: { quantity: true, lineTotal: true },
          orderBy: { _sum: { lineTotal: "desc" } },
          take: 5,
        });
        const products = await database.product.findMany({
          where: {
            organizationId: org.id,
            id: { in: grouped.map((row) => row.productId) },
          },
          select: { id: true, name: true },
        });
        const names = new Map(
          products.map((product) => [product.id, product.name]),
        );
        return grouped.map((row) => ({
          name: names.get(row.productId) ?? "(deleted product)",
          quantity: row._sum.quantity ?? 0,
          revenue: new Prisma.Decimal(row._sum.lineTotal ?? 0).toFixed(2),
        }));
      }
      case "outstanding_receivables": {
        const sales = await database.sale.findMany({
          where: { organizationId: org.id },
          select: { total: true, payments: { select: { amount: true } } },
          take: 5000,
        });
        let outstanding = new Prisma.Decimal(0);
        let count = 0;
        for (const sale of sales) {
          const paid = sale.payments.reduce(
            (sum, payment) => sum.plus(payment.amount),
            new Prisma.Decimal(0),
          );
          const remaining = new Prisma.Decimal(sale.total).minus(paid);
          if (remaining.isPositive()) {
            outstanding = outstanding.plus(remaining);
            count += 1;
          }
        }
        return { invoiceCount: count, outstanding: outstanding.toFixed(2) };
      }
      case "inventory_value": {
        const rows = await database.inventory.findMany({
          where: { organizationId: org.id },
          select: { quantity: true, product: { select: { costPrice: true } } },
        });
        const value = rows.reduce(
          (total, row) =>
            total.plus(
              new Prisma.Decimal(row.product.costPrice).mul(row.quantity),
            ),
          new Prisma.Decimal(0),
        );
        return {
          units: rows.reduce((total, row) => total + row.quantity, 0),
          estimatedValue: value.toDecimalPlaces(2).toFixed(2),
          basis: "latest_purchase_cost_estimate",
          limitation:
            "Operational estimate only; costing policy is not yet approved.",
        };
      }
      default:
        throw new BadRequestException("Unsupported assistant intent.");
    }
  }

  private window(from?: string, to?: string) {
    const end = to ? new Date(`${to}T23:59:59.999Z`) : new Date();
    const start = from
      ? new Date(`${from}T00:00:00.000Z`)
      : new Date(
          Date.UTC(
            end.getUTCFullYear(),
            end.getUTCMonth(),
            end.getUTCDate() - 29,
          ),
        );
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new BadRequestException("Dates must be YYYY-MM-DD.");
    }
    if (start > end)
      throw new BadRequestException("`from` must be before `to`.");
    return { from: start, to: end };
  }
}

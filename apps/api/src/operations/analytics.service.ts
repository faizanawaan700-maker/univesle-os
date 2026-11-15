import { BadRequestException, Injectable } from "@nestjs/common";
import { Prisma, database } from "@ubos/database";
import type { OrganizationContext } from "../common/http-context";
import { AnalyticsQueryDto } from "./analytics.dto";

const MAX_SERIES_POINTS = 366;
const TOP_ROWS = 10;

/**
 * Business intelligence for Phase 6.
 *
 * Design rules:
 * - Every figure is derived from stored sales, purchases and stock movements,
 *   scoped to the organization; nothing is estimated or synthesized.
 * - Observed facts and forecasts are returned in separate objects so a forecast
 *   can never be confused with a booked value.
 * - Inventory valuation is a *cost-at-latest-purchase* estimate, which is NOT an
 *   accounting-grade valuation; the response says so explicitly because the
 *   costing policy is still undecided (OPS-08).
 */
@Injectable()
export class AnalyticsService {
  async getDashboard(org: OrganizationContext, query: AnalyticsQueryDto = {}) {
    const { from, to } = this.resolveWindow(query);
    const window = { organizationId: org.id, issuedAt: { gte: from, lte: to } };

    const [
      sales,
      purchases,
      saleLines,
      trends,
      topProducts,
      topCustomers,
      stock,
    ] = await Promise.all([
      database.sale.aggregate({
        where: window,
        _count: { _all: true },
        _sum: { total: true, subtotal: true, discount: true, tax: true },
      }),
      database.purchaseInvoice.aggregate({
        where: { organizationId: org.id, receivedAt: { gte: from, lte: to } },
        _count: { _all: true },
        _sum: { total: true },
      }),
      database.saleItem.count({
        where: {
          organizationId: org.id,
          sale: { issuedAt: { gte: from, lte: to } },
        },
      }),
      this.getDailySeries(org.id, from, to),
      this.getTopProducts(org.id, from, to),
      this.getTopCustomers(org.id, from, to),
      this.getInventoryPosition(org.id),
    ]);

    const salesTotal = new Prisma.Decimal(sales._sum.total ?? 0);
    const purchasesTotal = new Prisma.Decimal(purchases._sum.total ?? 0);
    const days = Math.max(
      1,
      Math.ceil((to.getTime() - from.getTime()) / 86_400_000) + 1,
    );

    return {
      window: { from: from.toISOString(), to: to.toISOString(), days },
      facts: {
        sales: {
          invoiceCount: sales._count._all,
          lineCount: saleLines,
          subtotal: this.money(sales._sum.subtotal),
          discount: this.money(sales._sum.discount),
          tax: this.money(sales._sum.tax),
          total: this.money(sales._sum.total),
        },
        purchases: {
          invoiceCount: purchases._count._all,
          total: this.money(purchases._sum.total),
        },
        grossMarginBeforeCosting: this.money(salesTotal.minus(purchasesTotal)),
        averageInvoiceValue: sales._count._all
          ? salesTotal.div(sales._count._all).toDecimalPlaces(2).toFixed(2)
          : "0.00",
        inventory: stock,
      },
      trends,
      topProducts,
      topCustomers,
      forecast: this.forecast(trends.series, query.forecastDays ?? 0),
      limitations: [
        "Inventory value uses the current product cost (latest purchase cost). It is an operational estimate, not an accounting-grade valuation; the costing policy is not yet approved.",
        "Tax and discount totals are the amounts recorded on invoices; no tax jurisdiction policy is applied or inferred.",
        "Gross margin before costing compares sales totals with purchase invoices in the same window; it is not a profit-and-loss statement.",
        "Forecasts use a linear trend over the selected window and are labelled predictions, not observed facts.",
      ],
    };
  }

  private resolveWindow(query: AnalyticsQueryDto) {
    const now = new Date();
    const defaultFrom = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 29),
    );
    const to = query.to
      ? this.parseDate(query.to, "to", true)
      : new Date(
          Date.UTC(
            now.getUTCFullYear(),
            now.getUTCMonth(),
            now.getUTCDate(),
            23,
            59,
            59,
            999,
          ),
        );
    const from = query.from
      ? this.parseDate(query.from, "from", false)
      : defaultFrom;
    if (from > to)
      throw new BadRequestException("`from` must be on or before `to`.");
    const days = Math.ceil((to.getTime() - from.getTime()) / 86_400_000) + 1;
    if (days > MAX_SERIES_POINTS) {
      throw new BadRequestException(
        `The analytics window cannot exceed ${MAX_SERIES_POINTS} days.`,
      );
    }
    return { from, to };
  }

  private parseDate(value: string, field: string, endOfDay: boolean) {
    const parsed = new Date(
      `${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`,
    );
    if (Number.isNaN(parsed.getTime()))
      throw new BadRequestException(`\`${field}\` must be a valid date.`);
    return parsed;
  }

  /** Daily totals grouped in UTC so the series is deterministic across hosts. */
  private async getDailySeries(organizationId: string, from: Date, to: Date) {
    const rows = await database.$queryRaw<
      Array<{ day: Date; total: Prisma.Decimal; invoices: bigint }>
    >`
      SELECT date_trunc('day', "issuedAt") AS day,
             COALESCE(SUM("total"), 0) AS total,
             COUNT(*) AS invoices
      FROM "Sale"
      WHERE "organizationId" = ${organizationId}
        AND "issuedAt" >= ${from}
        AND "issuedAt" <= ${to}
      GROUP BY 1
      ORDER BY 1
    `;
    const byDay = new Map(
      rows.map((row) => [
        row.day.toISOString().slice(0, 10),
        {
          total: new Prisma.Decimal(row.total),
          invoices: Number(row.invoices),
        },
      ]),
    );
    const series: Array<{ date: string; total: string; invoices: number }> = [];
    for (
      let cursor = new Date(from);
      cursor <= to;
      cursor = new Date(cursor.getTime() + 86_400_000)
    ) {
      const key = cursor.toISOString().slice(0, 10);
      const row = byDay.get(key);
      series.push({
        date: key,
        total: (row?.total ?? new Prisma.Decimal(0)).toFixed(2),
        invoices: row?.invoices ?? 0,
      });
    }
    const sum = series.reduce(
      (total, point) => total.plus(point.total),
      new Prisma.Decimal(0),
    );
    return { series, total: sum.toFixed(2) };
  }

  private async getTopProducts(organizationId: string, from: Date, to: Date) {
    const grouped = await database.saleItem.groupBy({
      by: ["productId"],
      where: { organizationId, sale: { issuedAt: { gte: from, lte: to } } },
      _sum: { quantity: true, lineTotal: true },
      orderBy: { _sum: { lineTotal: "desc" } },
      take: TOP_ROWS,
    });
    const products = await database.product.findMany({
      where: {
        organizationId,
        id: { in: grouped.map((row) => row.productId) },
      },
      select: { id: true, name: true },
    });
    const names = new Map(
      products.map((product) => [product.id, product.name]),
    );
    return grouped.map((row) => ({
      productId: row.productId,
      name: names.get(row.productId) ?? "(deleted product)",
      quantity: row._sum.quantity ?? 0,
      revenue: this.money(row._sum.lineTotal),
    }));
  }

  private async getTopCustomers(organizationId: string, from: Date, to: Date) {
    const grouped = await database.sale.groupBy({
      by: ["customerId"],
      where: {
        organizationId,
        issuedAt: { gte: from, lte: to },
        customerId: { not: null },
      },
      _sum: { total: true },
      _count: { _all: true },
      orderBy: { _sum: { total: "desc" } },
      take: TOP_ROWS,
    });
    const customers = await database.customer.findMany({
      where: {
        organizationId,
        id: { in: grouped.map((row) => row.customerId!).filter(Boolean) },
      },
      select: { id: true, name: true },
    });
    const names = new Map(
      customers.map((customer) => [customer.id, customer.name]),
    );
    return grouped.map((row) => ({
      customerId: row.customerId,
      name: row.customerId
        ? (names.get(row.customerId) ?? "(deleted customer)")
        : "Walk-in",
      invoices: row._count._all,
      revenue: this.money(row._sum.total),
    }));
  }

  private async getInventoryPosition(organizationId: string) {
    const rows = await database.inventory.findMany({
      where: { organizationId },
      select: {
        quantity: true,
        product: { select: { costPrice: true, lowStockAt: true, name: true } },
      },
    });
    let units = 0;
    let value = new Prisma.Decimal(0);
    const lowStock: Array<{
      name: string;
      quantity: number;
      threshold: number;
    }> = [];
    for (const row of rows) {
      units += row.quantity;
      value = value.plus(
        new Prisma.Decimal(row.product.costPrice).mul(row.quantity),
      );
      if (row.quantity <= row.product.lowStockAt) {
        lowStock.push({
          name: row.product.name,
          quantity: row.quantity,
          threshold: row.product.lowStockAt,
        });
      }
    }
    return {
      units,
      estimatedValueAtLatestCost: value.toDecimalPlaces(2).toFixed(2),
      valuationBasis: "latest_purchase_cost_estimate" as const,
      lowStockCount: lowStock.length,
      lowStock: lowStock.slice(0, TOP_ROWS),
    };
  }

  /**
   * Least-squares linear trend over the observed series. Returned separately from
   * facts, with the method disclosed; no forecast is produced without history.
   */
  private forecast(
    series: Array<{ date: string; total: string }>,
    days: number,
  ) {
    if (days <= 0)
      return { generated: false as const, method: "none" as const, points: [] };
    const observed = series.map((point, index) => ({
      x: index,
      y: Number(point.total),
    }));
    if (observed.length < 2) {
      return {
        generated: false as const,
        method: "none" as const,
        points: [],
        reason: "Not enough history.",
      };
    }
    const n = observed.length;
    const meanX = observed.reduce((sum, point) => sum + point.x, 0) / n;
    const meanY = observed.reduce((sum, point) => sum + point.y, 0) / n;
    const numerator = observed.reduce(
      (sum, point) => sum + (point.x - meanX) * (point.y - meanY),
      0,
    );
    const denominator = observed.reduce(
      (sum, point) => sum + (point.x - meanX) ** 2,
      0,
    );
    const slope = denominator === 0 ? 0 : numerator / denominator;
    const intercept = meanY - slope * meanX;
    const lastDate = new Date(
      `${series[series.length - 1].date}T00:00:00.000Z`,
    );
    const points = Array.from(
      { length: Math.min(days, MAX_SERIES_POINTS) },
      (_, offset) => {
        const x = n + offset;
        const value = Math.max(0, intercept + slope * x);
        return {
          date: new Date(lastDate.getTime() + (offset + 1) * 86_400_000)
            .toISOString()
            .slice(0, 10),
          total: value.toFixed(2),
        };
      },
    );
    return {
      generated: true as const,
      method: "linear_trend_least_squares" as const,
      disclosure:
        "Prediction only. Linear trend over the observed window; not a booked value.",
      points,
    };
  }

  private money(value: Prisma.Decimal | null | undefined) {
    return new Prisma.Decimal(value ?? 0).toFixed(2);
  }
}

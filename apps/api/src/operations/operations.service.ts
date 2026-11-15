import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, database } from "@ubos/database";
import { randomUUID } from "node:crypto";
import type { OrganizationContext } from "../common/http-context";
import {
  MAX_LIST_ROWS,
  MAX_REPORT_LOW_STOCK_ROWS,
  REPORT_INVENTORY_BATCH_SIZE,
} from "../common/query-limits";
import {
  isRecordNotFoundError,
  isUniqueConstraintError,
} from "../common/prisma-errors";
import { runTransaction } from "../common/transactions";
import { runIdempotentTransaction } from "../common/idempotency";
import {
  cursorWhere,
  cursorWhereOn,
  decodeCursor,
  resolvePageSize,
  toPage,
  toTextPage,
  decodeTextCursor,
  textCursorWhere,
} from "../common/pagination";
import {
  AdjustInventoryDto,
  CreateCategoryDto,
  CreateCustomerDto,
  CreatePaymentDto,
  CreateProductDto,
  UpdateProductDto,
  UpdateCustomerDto,
  UpdateSupplierDto,
  CreatePurchaseInvoiceDto,
  CreateSaleDto,
  CreateSupplierDto,
  CreateAccountDto,
  UpdateAccountDto,
  CreateJournalEntryDto,
  ListQueryDto,
  AuditQueryDto,
  MovementQueryDto,
  AccountQueryDto,
  JournalQueryDto,
} from "./operations.dto";
import { calculateInvoiceAmounts, outstandingBalance } from "./money";
import { OutboundService } from "../integrations/outbound.service";
import { ACCOUNT, LedgerService } from "../accounting/ledger.service";

type Tx = Prisma.TransactionClient;

const RECENT_MOVEMENT_ROWS = 50;

/**
 * Formats every listed money field to a fixed 2-decimal string. Prisma's Decimal
 * JSON form omits trailing zeros, so a client could receive `200` instead of
 * `200.00` and treat it as a float.
 */
function withMoney<T extends Record<string, unknown>>(row: T, fields: readonly string[]): T {
  const output: Record<string, unknown> = { ...row };
  for (const field of fields) {
    const value = output[field];
    if (value === null || value === undefined) continue;
    output[field] = new Prisma.Decimal(value as Prisma.Decimal).toFixed(2);
  }
  return output as T;
}

const PRODUCT_SELECT = {
  id: true,
  name: true,
  sku: true,
  barcode: true,
  unitPrice: true,
  costPrice: true,
  lowStockAt: true,
  isActive: true,
  category: { select: { id: true, name: true } },
  inventory: { select: { quantity: true } },
} as const;

@Injectable()
export class OperationsService {
  constructor(
    private readonly outbound: OutboundService,
    private readonly ledger: LedgerService,
  ) {}

  /**
   * Moving weighted average unit cost (OPS-08 costing policy).
   *
   * The average is derived from what the organization actually paid on receipts
   * (`PurchaseInvoiceItem.unitCost`) weighted by quantity. With no receipts the
   * product's recorded cost price is used.
   */
  private async averageUnitCost(tx: Tx, organizationId: string, productId: string) {
    const purchases = await tx.purchaseInvoiceItem.findMany({
      where: { organizationId, productId, purchaseInvoice: { status: { not: "voided" } } },
      select: { quantity: true, unitCost: true },
      orderBy: { id: "desc" },
      take: 500,
    });
    let totalQuantity = 0;
    let totalValue = new Prisma.Decimal(0);
    for (const purchase of purchases) {
      totalQuantity += purchase.quantity;
      totalValue = totalValue.plus(new Prisma.Decimal(purchase.unitCost).mul(purchase.quantity));
    }
    if (totalQuantity === 0) {
      const product = await tx.product.findFirst({
        where: { id: productId, organizationId },
        select: { costPrice: true },
      });
      return new Prisma.Decimal(product?.costPrice ?? 0);
    }
    return totalValue.div(totalQuantity).toDecimalPlaces(4);
  }
  async listCategories(org: OrganizationContext) {
    return database.productCategory.findMany({
      where: { organizationId: org.id },
      orderBy: { name: "asc" },
      take: MAX_LIST_ROWS,
    });
  }

  async createCategory(input: CreateCategoryDto, org: OrganizationContext, actorId: string) {
    const name = input.name.trim();
    if (!name) throw new BadRequestException("Category name cannot be blank.");
    try {
      return await runTransaction(async (tx) => {
        const category = await tx.productCategory.create({
          data: { organizationId: org.id, name },
        });
        await this.audit(tx, org.id, actorId, "catalog.category_created", "product_category", category.id);
        return category;
      });
    } catch (error) {
      this.throwUniqueConflict(error, "A category with this name already exists.");
    }
  }

  async listProducts(org: OrganizationContext, query: ListQueryDto = {}) {
    const pageSize = resolvePageSize(query.limit);
    const cursor = decodeCursor(query.cursor);
    const search = query.search?.trim();
    // Soft-deleted products stay in the table for history but leave the catalog.
    const includeInactive = query.includeInactive === true;
    const rows = await database.product.findMany({
      where: {
        organizationId: org.id,
        ...(includeInactive ? {} : { isActive: true }),
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: "insensitive" as const } },
                { sku: { contains: search, mode: "insensitive" as const } },
                { barcode: { contains: search, mode: "insensitive" as const } },
              ],
            }
          : {}),
        ...cursorWhere(cursor),
      },
      select: { ...PRODUCT_SELECT, createdAt: true },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: pageSize + 1,
    });
    return toPage(rows, pageSize);
  }

  async createProduct(input: CreateProductDto, org: OrganizationContext, actorId: string) {
    const name = input.name.trim();
    if (!name) throw new BadRequestException("Product name cannot be blank.");
    try {
      return await runTransaction(async (tx) => {
        const categoryId = input.categoryId?.trim() || undefined;
        if (categoryId) {
          const category = await tx.productCategory.findFirst({
            where: { id: categoryId, organizationId: org.id },
            select: { id: true },
          });
          if (!category) throw new NotFoundException("Product category was not found.");
        }

        const product = await tx.product.create({
          data: {
            organizationId: org.id,
            categoryId,
            name,
            sku: input.sku?.trim() || null,
            barcode: input.barcode?.trim() || null,
            unitPrice: new Prisma.Decimal(input.unitPrice),
            costPrice: new Prisma.Decimal(input.costPrice),
            lowStockAt: input.lowStockAt ?? 5,
            isActive: input.isActive ?? true,
            inventory: { create: { organizationId: org.id, quantity: 0 } },
          },
          select: PRODUCT_SELECT,
        });
        await this.audit(tx, org.id, actorId, "catalog.product_created", "product", product.id);
        return product;
      });
    } catch (error) {
      this.throwUniqueConflict(error, "The product SKU or barcode is already in use.");
    }
  }

  /** Single product by id, always constrained to the caller's organization. */
  async getProduct(id: string, org: OrganizationContext) {
    const product = await database.product.findFirst({
      where: { id, organizationId: org.id },
      select: { ...PRODUCT_SELECT, createdAt: true },
    });
    if (!product) throw new NotFoundException("Product was not found.");
    return product;
  }

  /** Soft delete / restore. The row is retained for history either way. */
  async setProductActive(
    id: string,
    isActive: boolean,
    org: OrganizationContext,
    actorId: string,
  ) {
    return runTransaction(async (tx) => {
      const existing = await tx.product.findFirst({
        where: { id, organizationId: org.id },
        select: { id: true, isActive: true },
      });
      if (!existing) throw new NotFoundException("Product was not found.");
      if (existing.isActive === isActive)
        return tx.product.findFirstOrThrow({
          where: { id, organizationId: org.id },
          select: { ...PRODUCT_SELECT, createdAt: true },
        });
      const product = await tx.product.update({
        where: { id },
        data: { isActive },
        select: { ...PRODUCT_SELECT, createdAt: true },
      });
      await this.audit(
        tx,
        org.id,
        actorId,
        isActive ? "catalog.product_restored" : "catalog.product_archived",
        "product",
        id,
      );
      return product;
    });
  }

  async updateProduct(id: string, input: UpdateProductDto, org: OrganizationContext, actorId: string) {
    return runTransaction(async (tx) => {
      const existing = await tx.product.findFirst({
        where: { id, organizationId: org.id },
        select: { id: true },
      });
      if (!existing) throw new NotFoundException("Product was not found.");

      const data: Record<string, unknown> = {};
      if (input.name !== undefined) data.name = input.name.trim();
      if (input.sku !== undefined) data.sku = input.sku?.trim() || null;
      if (input.barcode !== undefined) data.barcode = input.barcode?.trim() || null;
      if (input.categoryId !== undefined) {
        const categoryId = input.categoryId?.trim() || null;
        data.categoryId = categoryId;
        if (categoryId) {
          const category = await tx.productCategory.findFirst({
            where: { id: categoryId, organizationId: org.id },
            select: { id: true },
          });
          if (!category) throw new NotFoundException("Product category was not found.");
        }
      }
      if (input.unitPrice !== undefined) data.unitPrice = new Prisma.Decimal(input.unitPrice);
      if (input.costPrice !== undefined) data.costPrice = new Prisma.Decimal(input.costPrice);
      if (input.lowStockAt !== undefined) data.lowStockAt = input.lowStockAt;
      if (input.isActive !== undefined) data.isActive = input.isActive;

      const product = await tx.product.update({
        where: { id },
        data,
        select: PRODUCT_SELECT,
      });
      await this.audit(tx, org.id, actorId, "catalog.product_updated", "product", id);
      return product;
    });
  }

  /**
   * Stock on hand plus a recent-movement preview. The full, paginated movement
   * history lives at `listStockMovements` so this endpoint stays small and its
   * preview can never be mistaken for the complete ledger.
   */
  async listInventory(org: OrganizationContext) {
    const [items, itemsPage, movements] = await Promise.all([
      database.inventory.findMany({
        where: { organizationId: org.id },
        include: { product: { select: PRODUCT_SELECT } },
        orderBy: { product: { name: "asc" } },
        take: MAX_LIST_ROWS,
      }),
      database.inventory.aggregate({ where: { organizationId: org.id }, _count: { _all: true } }),
      database.stockMovement.findMany({
        where: { organizationId: org.id },
        include: { product: { select: { id: true, name: true, sku: true } } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: RECENT_MOVEMENT_ROWS,
      }),
    ]);
    return {
      items,
      total: itemsPage._count._all,
      truncated: itemsPage._count._all > items.length,
      recentMovements: movements,
      recentMovementsTruncated: movements.length === RECENT_MOVEMENT_ROWS,
    };
  }

  /** Organization-scoped, cursor-paginated stock movement ledger with filters. */
  async listStockMovements(org: OrganizationContext, query: MovementQueryDto = {}) {
    const pageSize = resolvePageSize(query.limit);
    const cursor = decodeCursor(query.cursor);
    const search = query.search?.trim();
    const rows = await database.stockMovement.findMany({
      where: {
        organizationId: org.id,
        ...(query.productId ? { productId: query.productId } : {}),
        ...(query.reason ? { reason: query.reason } : {}),
        ...(search
          ? {
              OR: [
                { note: { contains: search, mode: "insensitive" as const } },
                { referenceId: { contains: search, mode: "insensitive" as const } },
                { product: { name: { contains: search, mode: "insensitive" as const } } },
              ],
            }
          : {}),
        ...cursorWhereOn("createdAt", cursor),
      },
      include: {
        product: { select: { id: true, name: true, sku: true } },
        actor: { select: { id: true, name: true } },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: pageSize + 1,
    });
    return toPage(rows, pageSize);
  }

  async adjustInventory(
    input: AdjustInventoryDto,
    org: OrganizationContext,
    actorId: string,
    idempotencyKey?: string,
  ) {
    if (input.quantityDelta === 0) throw new BadRequestException("Stock adjustment cannot be zero.");
    return runIdempotentTransaction({ key: idempotencyKey, organizationId: org.id, actorId, operation: "inventory.adjustment.create", payload: input }, async (tx) => {
      const product = await tx.product.findFirst({
        where: { id: input.productId, organizationId: org.id, isActive: true },
        select: { id: true },
      });
      if (!product) throw new NotFoundException("Product was not found.");

      await tx.inventory.upsert({
        where: { productId: product.id },
        create: { organizationId: org.id, productId: product.id, quantity: 0 },
        update: {},
      });
      const where = {
        organizationId: org.id,
        productId: product.id,
        ...(input.quantityDelta < 0 ? { quantity: { gte: -input.quantityDelta } } : {}),
      };
      const updated = await tx.inventory.updateMany({
        where,
        data: { quantity: { increment: input.quantityDelta } },
      });
      if (updated.count !== 1) {
        throw new ConflictException("Stock cannot be adjusted below zero.");
      }

      const movement = await tx.stockMovement.create({
        data: {
          organizationId: org.id,
          productId: product.id,
          actorId,
          quantityDelta: input.quantityDelta,
          reason: input.reason,
          note: input.note?.trim() || null,
        },
      });
      await this.audit(
        tx,
        org.id,
        actorId,
        "inventory.adjusted",
        "stock_movement",
        movement.id,
        { quantityDelta: input.quantityDelta, reason: input.reason },
      );
      return movement;
    });
  }

  async listCustomers(org: OrganizationContext, query: ListQueryDto = {}) {
    const pageSize = resolvePageSize(query.limit);
    const cursor = decodeCursor(query.cursor);
    const search = query.search?.trim();
    const rows = await database.customer.findMany({
      where: {
        organizationId: org.id,
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: "insensitive" as const } },
                { email: { contains: search, mode: "insensitive" as const } },
                { phone: { contains: search, mode: "insensitive" as const } },
              ],
            }
          : {}),
        ...cursorWhere(cursor),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: pageSize + 1,
    });
    return toPage(rows, pageSize);
  }

  async createCustomer(input: CreateCustomerDto, org: OrganizationContext, actorId: string) {
    const name = input.name.trim();
    if (!name) throw new BadRequestException("Customer name cannot be blank.");
    return runTransaction(async (tx) => {
      const customer = await tx.customer.create({
        data: {
          organizationId: org.id,
          name,
          email: input.email?.trim().toLowerCase() || null,
          phone: input.phone?.trim() || null,
          notes: input.notes?.trim() || null,
          marketingConsent: input.marketingConsent ?? false,
        },
      });
      await this.audit(tx, org.id, actorId, "customer.created", "customer", customer.id);
      return customer;
    });
  }

  async updateCustomer(id: string, input: UpdateCustomerDto, org: OrganizationContext, actorId: string) {
    return runTransaction(async (tx) => {
      const existing = await tx.customer.findFirst({
        where: { id, organizationId: org.id },
        select: { id: true },
      });
      if (!existing) throw new NotFoundException("Customer was not found.");

      const data: Record<string, unknown> = {};
      if (input.name !== undefined) data.name = input.name.trim();
      if (input.email !== undefined) data.email = input.email === null ? null : input.email.trim().toLowerCase() || null;
      if (input.phone !== undefined) data.phone = input.phone === null ? null : input.phone.trim() || null;
      if (input.notes !== undefined) data.notes = input.notes === null ? null : input.notes.trim() || null;
      if (input.marketingConsent !== undefined) data.marketingConsent = input.marketingConsent;

      const customer = await tx.customer.update({
        where: { id },
        data,
      });
      await this.audit(tx, org.id, actorId, "customer.updated", "customer", id);
      return customer;
    });
  }

  async listSuppliers(org: OrganizationContext, query: ListQueryDto = {}) {
    const pageSize = resolvePageSize(query.limit);
    const cursor = decodeCursor(query.cursor);
    const search = query.search?.trim();
    const rows = await database.supplier.findMany({
      where: {
        organizationId: org.id,
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: "insensitive" as const } },
                { email: { contains: search, mode: "insensitive" as const } },
                { phone: { contains: search, mode: "insensitive" as const } },
              ],
            }
          : {}),
        ...cursorWhere(cursor),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: pageSize + 1,
    });
    return toPage(rows, pageSize);
  }

  async createSupplier(input: CreateSupplierDto, org: OrganizationContext, actorId: string) {
    const name = input.name.trim();
    if (!name) throw new BadRequestException("Supplier name cannot be blank.");
    return runTransaction(async (tx) => {
      const supplier = await tx.supplier.create({
        data: {
          organizationId: org.id,
          name,
          email: input.email?.trim().toLowerCase() || null,
          phone: input.phone?.trim() || null,
          notes: input.notes?.trim() || null,
        },
      });
      await this.audit(tx, org.id, actorId, "supplier.created", "supplier", supplier.id);
      return supplier;
    });
  }

  async updateSupplier(id: string, input: UpdateSupplierDto, org: OrganizationContext, actorId: string) {
    return runTransaction(async (tx) => {
      const existing = await tx.supplier.findFirst({
        where: { id, organizationId: org.id },
        select: { id: true },
      });
      if (!existing) throw new NotFoundException("Supplier was not found.");

      const data: Record<string, unknown> = {};
      if (input.name !== undefined) data.name = input.name.trim();
      if (input.email !== undefined) data.email = input.email === null ? null : input.email.trim().toLowerCase() || null;
      if (input.phone !== undefined) data.phone = input.phone === null ? null : input.phone.trim() || null;
      if (input.notes !== undefined) data.notes = input.notes === null ? null : input.notes.trim() || null;

      const supplier = await tx.supplier.update({
        where: { id },
        data,
      });
      await this.audit(tx, org.id, actorId, "supplier.updated", "supplier", id);
      return supplier;
    });
  }

  async listSales(org: OrganizationContext, query: ListQueryDto = {}) {
    const pageSize = resolvePageSize(query.limit);
    const cursor = decodeCursor(query.cursor);
    const search = query.search?.trim();
    const sales = await database.sale.findMany({
      where: {
        organizationId: org.id,
        ...(search
          ? { invoiceNumber: { contains: search, mode: "insensitive" as const } }
          : {}),
        ...(cursor
          ? {
              OR: [
                { issuedAt: { lt: cursor.createdAt } },
                { issuedAt: cursor.createdAt, id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      include: { customer: true, items: true, payments: true },
      orderBy: [{ issuedAt: "desc" }, { id: "desc" }],
      take: pageSize + 1,
    });
    const page = toPage(sales, pageSize, "issuedAt");
    return {
      ...page,
      items: page.items.map((sale) => ({
        ...sale,
        outstanding: outstandingBalance(sale.total, sale.payments),
      })),
    };
  }

  async createSale(input: CreateSaleDto, org: OrganizationContext, actorId: string, idempotencyKey?: string) {
    return runIdempotentTransaction({ key: idempotencyKey, organizationId: org.id, actorId, operation: "sales.invoice.create", payload: input }, async (tx) => {
      if (input.customerId) {
        const customer = await tx.customer.findFirst({
          where: { id: input.customerId, organizationId: org.id },
          select: { id: true },
        });
        if (!customer) throw new NotFoundException("Customer was not found.");
      }

      const products = await this.findInvoiceProducts(tx, org.id, input.items.map((item) => item.productId));
      const lines = input.items.map((item) => {
        const product = products.get(item.productId);
        if (!product || !product.isActive) throw new NotFoundException("An invoice product was not found.");
        return {
          product,
          quantity: item.quantity,
          lineTotal: new Prisma.Decimal(product.unitPrice).mul(item.quantity).toDecimalPlaces(2),
        };
      });
      const totals = calculateInvoiceAmounts(
        lines.map(({ quantity, product }) => ({ quantity, unitPrice: product.unitPrice })),
        input.tax ?? "0",
        input.discount ?? "0",
      );

      // Cost of goods sold is valued BEFORE stock is issued: the moving average
      // and the on-hand quantity in force at sale time are what the issue is
      // worth. Reading them after the decrement would value the sale at zero.
      let cogs = new Prisma.Decimal(0);
      for (const line of lines) {
        const unitCost = await this.averageUnitCost(tx, org.id, line.product.id);
        cogs = cogs.plus(unitCost.mul(line.quantity));
      }
      cogs = cogs.toDecimalPlaces(2);

      for (const line of lines) {
        const updated = await tx.inventory.updateMany({
          where: {
            organizationId: org.id,
            productId: line.product.id,
            quantity: { gte: line.quantity },
          },
          data: { quantity: { decrement: line.quantity } },
        });
        if (updated.count !== 1) {
          throw new ConflictException(`Insufficient stock for ${line.product.name}.`);
        }
      }

      const sale = await tx.sale.create({
        data: {
          organizationId: org.id,
          customerId: input.customerId || null,
          invoiceNumber: `INV-${randomUUID().replace(/-/g, "").slice(0, 16).toUpperCase()}`,
          subtotal: totals.subtotal,
          discount: totals.discount,
          tax: totals.tax,
          total: totals.total,
          items: {
            create: lines.map(({ product, quantity, lineTotal }) => ({
              organizationId: org.id,
              productId: product.id,
              description: product.name,
              quantity,
              unitPrice: product.unitPrice,
              lineTotal,
            })),
          },
        },
        include: { items: true },
      });

      await Promise.all(lines.map((line) => tx.stockMovement.create({
        data: {
          organizationId: org.id,
          productId: line.product.id,
          actorId,
          quantityDelta: -line.quantity,
          reason: "sale",
          referenceId: sale.id,
        },
      })));
      await this.audit(tx, org.id, actorId, "sales.invoice_created", "sale", sale.id, {
        invoiceNumber: sale.invoiceNumber,
        total: totals.total.toFixed(2),
      });
      // Accrual posting (OPS-08 policy): revenue at issue, receivable for the
      // unpaid total, tax payable and discounts as separate contra accounts,
      // plus cost of goods sold at the moving average cost.
      await this.ledger.post(tx, {
        organizationId: org.id,
        actorId,
        description: `Sales invoice ${sale.invoiceNumber}`,
        sourceType: "sale",
        sourceId: sale.id,
        postingDate: sale.issuedAt,
        lines: [
          { code: ACCOUNT.receivable, debit: totals.total.toFixed(2), memo: "Receivable" },
          ...(totals.discount.isPositive()
            ? [{ code: ACCOUNT.discount, debit: totals.discount.toFixed(2), memo: "Discount" }]
            : []),
          { code: ACCOUNT.revenue, credit: totals.subtotal.toFixed(2), memo: "Revenue" },
          ...(totals.tax.isPositive()
            ? [{ code: ACCOUNT.taxPayable, credit: totals.tax.toFixed(2), memo: "Output tax" }]
            : []),
          ...(cogs.isPositive()
            ? [
                { code: ACCOUNT.cogs, debit: cogs.toFixed(2), memo: "Cost of goods sold" },
                { code: ACCOUNT.inventory, credit: cogs.toFixed(2), memo: "Inventory issued" },
              ]
            : []),
        ],
      });
      // Transactional outbox: the event commits with the invoice or not at all.
      // No provider adapter means it stays PENDING until one is configured.
      await this.outbound.enqueue(tx, {
        organizationId: org.id,
        provider: "default",
        eventType: "sale.created",
        idempotencyKey: `sale.created:${sale.id}`,
        payload: {
          saleId: sale.id,
          invoiceNumber: sale.invoiceNumber,
          total: totals.total.toFixed(2),
          customerId: sale.customerId,
        },
      });
      // Every money field is serialized as a fixed 2-decimal string: Prisma's
      // Decimal JSON form drops trailing zeros, which left `subtotal` as "200".
      return {
        ...withMoney(sale, ["subtotal", "discount", "tax", "total"]),
        total: totals.total.toFixed(2),
        outstanding: totals.total.toFixed(2),
      };
    });
  }

  async listPurchases(org: OrganizationContext, query: ListQueryDto = {}) {
    const pageSize = resolvePageSize(query.limit);
    const cursor = decodeCursor(query.cursor);
    const search = query.search?.trim();
    const purchases = await database.purchaseInvoice.findMany({
      where: {
        organizationId: org.id,
        ...(search
          ? { invoiceNumber: { contains: search, mode: "insensitive" as const } }
          : {}),
        ...(cursor
          ? {
              OR: [
                { receivedAt: { lt: cursor.createdAt } },
                { receivedAt: cursor.createdAt, id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      include: { supplier: true, items: true, payments: true },
      orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
      take: pageSize + 1,
    });
    const page = toPage(purchases, pageSize, "receivedAt");
    return {
      ...page,
      items: page.items.map((invoice) => ({
        ...invoice,
        outstanding: outstandingBalance(invoice.total, invoice.payments),
      })),
    };
  }

  async listPayments(org: OrganizationContext, query: ListQueryDto = {}) {
    const pageSize = resolvePageSize(query.limit);
    const cursor = decodeCursor(query.cursor);
    const rows = await database.payment.findMany({
      where: {
        organizationId: org.id,
        ...(cursor
          ? {
              OR: [
                { paidAt: { lt: cursor.createdAt } },
                { paidAt: cursor.createdAt, id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ paidAt: "desc" }, { id: "desc" }],
      take: pageSize + 1,
      include: {
        sale: { select: { id: true, invoiceNumber: true, total: true } },
        purchaseInvoice: {
          select: { id: true, invoiceNumber: true, total: true },
        },
      },
    });
    return toPage(rows, pageSize, "paidAt");
  }

  /** Organization-scoped audit history with allowlisted filters (Phase 3). */
  async listAuditLogs(org: OrganizationContext, query: AuditQueryDto = {}) {
    const pageSize = resolvePageSize(query.limit);
    const cursor = decodeCursor(query.cursor);
    const search = query.search?.trim();
    const rows = await database.auditLog.findMany({
      where: {
        organizationId: org.id,
        ...(query.action ? { action: query.action } : {}),
        ...(query.entityType ? { entityType: query.entityType } : {}),
        ...(query.entityId ? { entityId: query.entityId } : {}),
        ...(query.actorId ? { actorId: query.actorId } : {}),
        ...(search
          ? {
              OR: [
                { action: { contains: search, mode: "insensitive" as const } },
                { entityType: { contains: search, mode: "insensitive" as const } },
              ],
            }
          : {}),
        ...cursorWhere(cursor),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: pageSize + 1,
      include: { actor: { select: { id: true, name: true, email: true } } },
    });
    return toPage(rows, pageSize);
  }

  async createPurchase(
    input: CreatePurchaseInvoiceDto,
    org: OrganizationContext,
    actorId: string,
    idempotencyKey?: string,
  ) {
    const invoiceNumber = input.invoiceNumber.trim();
    if (!invoiceNumber) throw new BadRequestException("Invoice number cannot be blank.");
    try {
      return await runIdempotentTransaction({ key: idempotencyKey, organizationId: org.id, actorId, operation: "procurement.invoice.create", payload: input }, async (tx) => {
        const supplier = await tx.supplier.findFirst({
          where: { id: input.supplierId, organizationId: org.id },
          select: { id: true },
        });
        if (!supplier) throw new NotFoundException("Supplier was not found.");

        const products = await this.findInvoiceProducts(tx, org.id, input.items.map((item) => item.productId));
        const lines = input.items.map((item) => {
          const product = products.get(item.productId);
          if (!product) throw new NotFoundException("A purchase product was not found.");
          return {
            product,
            quantity: item.quantity,
            unitCost: new Prisma.Decimal(item.unitCost),
            lineTotal: new Prisma.Decimal(item.unitCost).mul(item.quantity).toDecimalPlaces(2),
          };
        });
        const totals = calculateInvoiceAmounts(
          lines.map(({ quantity, unitCost }) => ({ quantity, unitPrice: unitCost })),
          input.tax ?? "0",
        );

        const invoice = await tx.purchaseInvoice.create({
          data: {
            organizationId: org.id,
            supplierId: supplier.id,
            invoiceNumber,
            subtotal: totals.subtotal,
            tax: totals.tax,
            total: totals.total,
            items: {
              create: lines.map(({ product, quantity, unitCost, lineTotal }) => ({
                organizationId: org.id,
                productId: product.id,
                description: product.name,
                quantity,
                unitCost,
                lineTotal,
              })),
            },
          },
          include: { items: true },
        });

        for (const line of lines) {
          await tx.inventory.upsert({
            where: { productId: line.product.id },
            create: {
              organizationId: org.id,
              productId: line.product.id,
              quantity: line.quantity,
            },
            update: { quantity: { increment: line.quantity } },
          });
          await tx.product.update({
            where: { id: line.product.id },
            data: { costPrice: line.unitCost },
          });
          await tx.stockMovement.create({
            data: {
              organizationId: org.id,
              productId: line.product.id,
              actorId,
              quantityDelta: line.quantity,
              reason: "purchase",
              referenceId: invoice.id,
            },
          });
        }

        await this.audit(tx, org.id, actorId, "procurement.invoice_received", "purchase_invoice", invoice.id, {
          invoiceNumber: invoice.invoiceNumber,
          total: totals.total.toFixed(2),
        });
        // Accrual posting: inventory and payable at receipt, input tax separate.
        // Purchase discounts are not part of the approved discount policy, so no
        // contra account is written here.
        await this.ledger.post(tx, {
          organizationId: org.id,
          actorId,
          description: `Purchase invoice ${invoice.invoiceNumber}`,
          sourceType: "purchase_invoice",
          sourceId: invoice.id,
          postingDate: invoice.receivedAt,
          lines: [
            { code: ACCOUNT.inventory, debit: totals.subtotal.toFixed(2), memo: "Inventory received" },
            ...(totals.tax.isPositive()
              ? [{ code: ACCOUNT.taxPayable, debit: totals.tax.toFixed(2), memo: "Input tax" }]
              : []),
            { code: ACCOUNT.payable, credit: totals.total.toFixed(2), memo: "Payable" },
          ],
        });
        return {
          ...withMoney(invoice, ["subtotal", "tax", "total"]),
          total: totals.total.toFixed(2),
          outstanding: totals.total.toFixed(2),
        };
      });
    } catch (error) {
      if (isRecordNotFoundError(error)) {
        throw new NotFoundException("A purchase product is no longer available.");
      }
      this.throwUniqueConflict(
        error,
        "A purchase invoice with this number already exists.",
        ["invoiceNumber"],
      );
    }
  }

  async createPayment(input: CreatePaymentDto, org: OrganizationContext, actorId: string, idempotencyKey?: string) {
    if (Boolean(input.saleId) === Boolean(input.purchaseInvoiceId)) {
      throw new BadRequestException("Provide exactly one saleId or purchaseInvoiceId.");
    }
    const amount = new Prisma.Decimal(input.amount);
    if (!amount.isPositive()) throw new BadRequestException("Payment amount must be positive.");

    return runIdempotentTransaction({ key: idempotencyKey, organizationId: org.id, actorId, operation: "payments.create", payload: input }, async (tx) => {
      let total: Prisma.Decimal;
      let paid: Prisma.Decimal;
      let entityId: string;
      let action: string;
      if (input.saleId) {
        const lockedSale = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id"
          FROM "Sale"
          WHERE "id" = ${input.saleId}
            AND "organizationId" = ${org.id}
          FOR UPDATE
        `;
        if (lockedSale.length === 0) throw new NotFoundException("Sales invoice was not found.");
        const sale = await tx.sale.findFirst({
          where: { id: input.saleId, organizationId: org.id },
          include: { payments: { select: { amount: true } } },
        });
        if (!sale) throw new NotFoundException("Sales invoice was not found.");
        total = sale.total;
        paid = sale.payments.reduce((sum, payment) => sum.plus(payment.amount), new Prisma.Decimal(0));
        entityId = sale.id;
        action = "sales.payment_recorded";
      } else {
        const lockedInvoice = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id"
          FROM "PurchaseInvoice"
          WHERE "id" = ${input.purchaseInvoiceId}
            AND "organizationId" = ${org.id}
          FOR UPDATE
        `;
        if (lockedInvoice.length === 0) throw new NotFoundException("Purchase invoice was not found.");
        const invoice = await tx.purchaseInvoice.findFirst({
          where: { id: input.purchaseInvoiceId, organizationId: org.id },
          include: { payments: { select: { amount: true } } },
        });
        if (!invoice) throw new NotFoundException("Purchase invoice was not found.");
        total = invoice.total;
        paid = invoice.payments.reduce((sum, payment) => sum.plus(payment.amount), new Prisma.Decimal(0));
        entityId = invoice.id;
        action = "procurement.payment_recorded";
      }
      const remaining = total.minus(paid);
      if (amount.gt(remaining)) throw new BadRequestException("Payment exceeds the outstanding balance.");

      const payment = await tx.payment.create({
        data: {
          organizationId: org.id,
          saleId: input.saleId || null,
          purchaseInvoiceId: input.purchaseInvoiceId || null,
          amount,
          method: input.method,
          reference: input.reference?.trim() || null,
        },
      });
      await this.audit(tx, org.id, actorId, action, "payment", payment.id, {
        documentId: entityId,
        amount: amount.toFixed(2),
      });
      // Cash movement: receipt reduces receivable, disbursement reduces payable.
      await this.ledger.post(tx, {
        organizationId: org.id,
        actorId,
        description: input.saleId ? "Customer payment" : "Supplier payment",
        sourceType: "payment",
        sourceId: payment.id,
        postingDate: payment.paidAt,
        lines: input.saleId
          ? [
              { code: ACCOUNT.cash, debit: amount.toFixed(2), memo: "Cash received" },
              { code: ACCOUNT.receivable, credit: amount.toFixed(2), memo: "Receivable settled" },
            ]
          : [
              { code: ACCOUNT.payable, debit: amount.toFixed(2), memo: "Payable settled" },
              { code: ACCOUNT.cash, credit: amount.toFixed(2), memo: "Cash paid" },
            ],
      });
      return payment;
    });
  }

  async getReport(org: OrganizationContext) {
    const [salesTotal, salesPaid, purchasesTotal, purchasesPaid, inventory] =
      await Promise.all([
        database.sale.aggregate({
          where: { organizationId: org.id },
          _sum: { total: true },
        }),
        database.payment.aggregate({
          where: { organizationId: org.id, saleId: { not: null } },
          _sum: { amount: true },
        }),
        database.purchaseInvoice.aggregate({
          where: { organizationId: org.id },
          _sum: { total: true },
        }),
        database.payment.aggregate({
          where: { organizationId: org.id, purchaseInvoiceId: { not: null } },
          _sum: { amount: true },
        }),
        this.getInventoryReportStats(org.id),
      ]);

    const sales = new Prisma.Decimal(salesTotal._sum.total ?? 0);
    const paidSales = new Prisma.Decimal(salesPaid._sum.amount ?? 0);
    const purchases = new Prisma.Decimal(purchasesTotal._sum.total ?? 0);
    const paidPurchases = new Prisma.Decimal(purchasesPaid._sum.amount ?? 0);

    return {
      salesTotal: sales.toFixed(2),
      customerOutstanding: sales.minus(paidSales).toFixed(2),
      purchasesTotal: purchases.toFixed(2),
      supplierOutstanding: purchases.minus(paidPurchases).toFixed(2),
      inventoryUnits: inventory.units,
      inventoryCostValue: inventory.costValue.toFixed(2),
      lowStockProducts: inventory.lowStockProducts,
      lowStockCount: inventory.lowStockCount,
    };
  }

  private async getInventoryReportStats(organizationId: string) {
    const lowStockProducts: Array<{ name: string; quantity: number }> = [];
    let lowStockCount = 0;
    let units = 0;
    let costValue = new Prisma.Decimal(0);
    let skip = 0;

    while (true) {
      const batch = await database.inventory.findMany({
        where: { organizationId },
        select: {
          id: true,
          quantity: true,
          product: { select: { costPrice: true, lowStockAt: true, name: true } },
        },
        orderBy: { id: "asc" },
        skip,
        take: REPORT_INVENTORY_BATCH_SIZE,
      });
      if (batch.length === 0) break;

      for (const item of batch) {
        units += item.quantity;
        costValue = costValue.plus(
          new Prisma.Decimal(item.product.costPrice).mul(item.quantity),
        );
        if (item.quantity <= item.product.lowStockAt) {
          lowStockCount += 1;
          if (lowStockProducts.length < MAX_REPORT_LOW_STOCK_ROWS) {
            lowStockProducts.push({ name: item.product.name, quantity: item.quantity });
          }
        }
      }

      if (batch.length < REPORT_INVENTORY_BATCH_SIZE) break;
      skip += batch.length;
    }

    return {
      units,
      costValue: costValue.toDecimalPlaces(2),
      lowStockProducts,
      lowStockCount,
    };
  }

  private async findInvoiceProducts(tx: Tx, organizationId: string, ids: string[]) {
    const uniqueIds = [...new Set(ids)];
    const found = await tx.product.findMany({
      where: { organizationId, id: { in: uniqueIds } },
      select: { id: true, name: true, unitPrice: true, isActive: true },
    });
    return new Map(found.map((product) => [product.id, product]));
  }

  private async audit(
    tx: Tx,
    organizationId: string,
    actorId: string,
    action: string,
    entityType: string,
    entityId: string,
    metadata?: Prisma.InputJsonValue,
  ) {
    await tx.auditLog.create({
      data: { organizationId, actorId, action, entityType, entityId, metadata },
    });
  }

  private throwUniqueConflict(
    error: unknown,
    message: string,
    fields: readonly string[] = [],
  ): never {
    if (isUniqueConstraintError(error, fields)) {
      throw new ConflictException(message);
    }
    throw error;
  }

  /*
   * ==========================================================================
   * BRANCH MANAGEMENT METHODS
   * ==========================================================================
   */

  /** List branches for organization */
  async listBranches(org: OrganizationContext) {
    return database.branch.findMany({
      where: { organizationId: org.id },
      orderBy: { name: "asc" },
      take: MAX_LIST_ROWS,
    });
  }

  /** Create a new branch */
  async createBranch(input: { name: string }, org: OrganizationContext, actorId: string) {
    const name = input.name.trim();
    if (!name) throw new BadRequestException("Branch name cannot be blank.");
    return runTransaction(async (tx) => {
      const existing = await tx.branch.findFirst({
        where: { organizationId: org.id, name },
      });
      if (existing) {
        throw new ConflictException(`Branch ${name} already exists.`);
      }
      const branch = await tx.branch.create({
        data: { organizationId: org.id, name },
      });
      await this.audit(tx, org.id, actorId, "branch.created", "branch", branch.id);
      return branch;
    });
  }

  /** Get a single branch by ID */
  async getBranch(id: string, org: OrganizationContext) {
    const branch = await database.branch.findFirst({
      where: { id, organizationId: org.id },
    });
    if (!branch) {
      throw new NotFoundException(`Branch "${id}" not found.`);
    }
    return branch;
  }

  /** Update a branch */
  async updateBranch(id: string, input: { name: string }, org: OrganizationContext, actorId: string) {
    const name = input.name.trim();
    if (!name) throw new BadRequestException("Branch name cannot be blank.");
    return runTransaction(async (tx) => {
      const existing = await tx.branch.findFirst({
        where: { id, organizationId: org.id },
      });
      if (!existing) {
        throw new NotFoundException(`Branch "${id}" not found.`);
      }
      const duplicate = await tx.branch.findFirst({
        where: { organizationId: org.id, name, id: { not: id } },
      });
      if (duplicate) {
        throw new ConflictException("Branch name already in use.");
      }
      const updated = await tx.branch.update({
        where: { id },
        data: { name },
      });
      await this.audit(tx, org.id, actorId, "branch.updated", "branch", updated.id);
      return updated;
    });
  }

  /** Delete a branch */
  async deleteBranch(id: string, org: OrganizationContext, actorId: string) {
    return runTransaction(async (tx) => {
      const branch = await tx.branch.findFirst({
        where: { id, organizationId: org.id },
      });
      if (!branch) {
        throw new NotFoundException(`Branch "${id}" not found.`);
      }
      await tx.branch.delete({ where: { id } });
      await this.audit(tx, org.id, actorId, "branch.deleted", "branch", branch.id);
      return { deleted: true };
    });
  }

  /**
   * Chart of accounts, ordered by code and cursor-paginated on `(code, id)` so
   * no account is silently dropped however many exist.
   */
  async listAccounts(org: OrganizationContext, query: AccountQueryDto = {}) {
    const pageSize = resolvePageSize(query.limit);
    const cursor = decodeTextCursor(query.cursor);
    const search = query.search?.trim();
    const onlyActive = query.activeOnly === undefined ? true : query.activeOnly === "true";
    const rows = await database.account.findMany({
      where: {
        organizationId: org.id,
        ...(query.type ? { type: query.type } : {}),
        ...(onlyActive ? { isActive: true } : {}),
        ...(search
          ? {
              OR: [
                { code: { contains: search, mode: "insensitive" as const } },
                { name: { contains: search, mode: "insensitive" as const } },
              ],
            }
          : {}),
        ...textCursorWhere("code", cursor),
      },
      orderBy: [{ code: "asc" }, { id: "asc" }],
      take: pageSize + 1,
    });
    return toTextPage(rows, pageSize, (row) => row.code);
  }

  /** Create a new account (Chart of Accounts entry) */
  async createAccount(input: CreateAccountDto, org: OrganizationContext, actorId: string) {
    const { code, name, type, normalBalance } = input;

    // Validate that the code is unique within the organization
    const existing = await database.account.findFirst({
      where: { organizationId: org.id, code },
    });
    if (existing) {
      throw new ConflictException(`Account with code "${code}" already exists.`);
    }

    return runTransaction(async (tx) => {
      const account = await tx.account.create({
        data: {
          organizationId: org.id,
          code,
          name,
          type,
          normalBalance,
          description: input.description,
          isActive: input.isActive ?? true,
        },
      });
      await this.audit(tx, org.id, actorId, "account.created", "account", account.id);
      return account;
    });
  }

  /** Update an existing account */
  async updateAccount(id: string, input: UpdateAccountDto, org: OrganizationContext, actorId: string) {
    const existing = await database.account.findFirst({
      where: { id, organizationId: org.id },
    });
    if (!existing) {
      throw new NotFoundException(`Account "${id}" not found.`);
    }

    // Validate code uniqueness if being changed
    if (input.code && input.code !== existing.code) {
      const duplicate = await database.account.findFirst({
        where: { organizationId: org.id, code: input.code },
      });
      if (duplicate) {
        throw new ConflictException(`Account with code "${input.code}" already exists.`);
      }
    }

    return runTransaction(async (tx) => {
      const updated = await tx.account.update({
        where: { id },
        data: {
          code: input.code || undefined,
          name: input.name || undefined,
          type: input.type || undefined,
          normalBalance: input.normalBalance || undefined,
          description: input.description === undefined ? undefined : input.description,
          isActive: input.isActive !== undefined ? input.isActive : existing.isActive,
        },
      });
      await this.audit(tx, org.id, actorId, "account.updated", "account", updated.id);
      return updated;
    });
  }

  /** Get a single account by ID */
  async getAccount(id: string, org: OrganizationContext) {
    const account = await database.account.findFirst({
      where: { id, organizationId: org.id },
    });
    if (!account) {
      throw new NotFoundException(`Account "${id}" not found.`);
    }
    return account;
  }

  /**
   * Posts a balanced journal entry. Rules enforced here are policy-independent:
   * exact decimal strings, each line strictly one-sided, a non-zero posting,
   * active accounts from this organization only, and debits equal credits.
   * Which source events post, the accounting basis and tax/discount treatment
   * remain unresolved policy (OPS-08) and are deliberately not assumed.
   */
  async createJournalEntry(input: CreateJournalEntryDto, org: OrganizationContext, actorId: string) {
    for (const [index, line] of input.lines.entries()) {
      const debit = new Prisma.Decimal(line.debit);
      const credit = new Prisma.Decimal(line.credit);
      if (debit.isNegative() || credit.isNegative()) {
        throw new BadRequestException(`Line ${index + 1} amounts cannot be negative.`);
      }
      if (debit.isZero() === credit.isZero()) {
        throw new BadRequestException(
          `Line ${index + 1} must contain exactly one of a debit or a credit amount.`,
        );
      }
    }

    const totalDebits = input.lines.reduce(
      (sum, line) => sum.plus(new Prisma.Decimal(line.debit)),
      new Prisma.Decimal(0),
    );
    const totalCredits = input.lines.reduce(
      (sum, line) => sum.plus(new Prisma.Decimal(line.credit)),
      new Prisma.Decimal(0),
    );

    if (totalDebits.isZero()) {
      throw new BadRequestException("Journal entry amount must be greater than zero.");
    }

    if (!totalDebits.equals(totalCredits)) {
      throw new BadRequestException(
        `Journal entry must have balanced debits and credits. Debits: ${totalDebits}, Credits: ${totalCredits}`,
      );
    }

    // Every referenced account must belong to the same organization and be open.
    const accountIds = [...new Set(input.lines.map((line) => line.accountId))];
    const accounts = await database.account.findMany({
      where: { organizationId: org.id, id: { in: accountIds } },
      select: { id: true, isActive: true, code: true },
    });
    if (accounts.length !== accountIds.length) {
      throw new BadRequestException("One or more accounts do not belong to this organization.");
    }
    const inactive = accounts.filter((account) => !account.isActive);
    if (inactive.length > 0) {
      throw new BadRequestException(
        `Cannot post to inactive accounts: ${inactive.map((account) => account.code).join(", ")}.`,
      );
    }

    return runTransaction(async (tx) => {
      const journalEntry = await tx.journalEntry.create({
        data: {
          organizationId: org.id,
          reference: input.reference,
          description: input.description,
          status: "POSTED",
          postedAt: new Date(),
        },
      });

      await tx.journalEntryLine.createMany({
        data: input.lines.map((line, index) => ({
          journalEntryId: journalEntry.id,
          accountId: line.accountId,
          debit: new Prisma.Decimal(line.debit),
          credit: new Prisma.Decimal(line.credit),
          description: line.description,
          orderIndex: line.orderIndex ?? index,
        })),
      });

      // Immutable posting trail: the balanced total is captured with the entry
      // so later readers can prove the invariant without recomputing floats.
      await this.audit(tx, org.id, actorId, "journal.posted", "journalEntry", journalEntry.id, {
        total: totalDebits.toFixed(2),
        lineCount: input.lines.length,
      });
      return { ...journalEntry, total: totalDebits.toFixed(2) };
    });
  }

  /** Organization-scoped, cursor-paginated journal entries with their lines. */
  async listJournalEntries(org: OrganizationContext, query: JournalQueryDto = {}) {
    const pageSize = resolvePageSize(query.limit);
    const cursor = decodeCursor(query.cursor);
    const search = query.search?.trim();
    const rows = await database.journalEntry.findMany({
      where: {
        organizationId: org.id,
        ...(query.status ? { status: query.status } : {}),
        ...(search
          ? {
              OR: [
                { description: { contains: search, mode: "insensitive" as const } },
                { reference: { contains: search, mode: "insensitive" as const } },
              ],
            }
          : {}),
        ...cursorWhereOn("createdAt", cursor),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      include: {
        lines: {
          orderBy: { orderIndex: "asc" },
          include: {
            account: {
              select: { id: true, code: true, name: true, type: true },
            },
          },
        },
      },
      take: pageSize + 1,
    });
    return toPage(rows, pageSize);
  }

  /** Get account balance */
  async getAccountBalance(accountId: string, org: OrganizationContext) {
    const account = await database.account.findFirst({
      where: { id: accountId, organizationId: org.id },
    });
    if (!account) {
      throw new NotFoundException(`Account "${accountId}" not found.`);
    }

    // Only posted lines from this organization's journal entries count.
    const lines = await database.journalEntryLine.findMany({
      where: {
        accountId,
        journalEntry: { organizationId: org.id, status: "POSTED" },
      },
      select: { debit: true, credit: true },
    });

    let debitTotal = new Prisma.Decimal(0);
    let creditTotal = new Prisma.Decimal(0);
    for (const line of lines) {
      debitTotal = debitTotal.plus(new Prisma.Decimal(line.debit));
      creditTotal = creditTotal.plus(new Prisma.Decimal(line.credit));
    }

    const balance =
      account.normalBalance === "DEBIT"
        ? debitTotal.minus(creditTotal)
        : creditTotal.minus(debitTotal);

    return {
      account: { id: account.id, code: account.code, name: account.name },
      normalBalance: account.normalBalance,
      balance: balance.toFixed(2),
      debitTotal: debitTotal.toFixed(2),
      creditTotal: creditTotal.toFixed(2),
    };
  }
}

/**
 * Product Service.
 *
 * Organization-scoped product business logic:
 * - create with SKU/barcode uniqueness validation and an opening inventory row
 * - cursor-paginated list with name/SKU/barcode search
 * - partial update that never lets a caller move a product across tenants
 * - soft delete through the `isActive` flag (records are retained for history)
 *
 * Money is converted at the boundary: request DTOs carry fixed-precision
 * decimal strings, the database stores `Prisma.Decimal`.
 */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, database } from "@ubos/database";
import type { OrganizationContext } from "../common/http-context";
import {
  cursorWhere,
  decodeCursor,
  resolvePageSize,
  toPage,
} from "../common/pagination";
import { isUniqueConstraintError } from "../common/prisma-errors";
import { runTransaction } from "../common/transactions";
import {
  CreateProductDto,
  ListQueryDto,
  UpdateProductDto,
} from "../operations/operations.dto";

const PRODUCT_SELECT = {
  id: true,
  name: true,
  sku: true,
  barcode: true,
  unitPrice: true,
  costPrice: true,
  lowStockAt: true,
  isActive: true,
  categoryId: true,
  createdAt: true,
  updatedAt: true,
  category: { select: { id: true, name: true } },
  inventory: { select: { quantity: true } },
} as const;

@Injectable()
export class ProductsService {
  async create(
    input: CreateProductDto,
    org: OrganizationContext,
    actorId: string,
  ) {
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
          if (!category)
            throw new NotFoundException("Product category was not found.");
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
        await tx.auditLog.create({
          data: {
            organizationId: org.id,
            actorId,
            action: "catalog.product_created",
            entityType: "product",
            entityId: product.id,
          },
        });
        return product;
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new ConflictException(
          "The product SKU or barcode is already in use.",
        );
      }
      throw error;
    }
  }

  async list(query: ListQueryDto = {}, org: OrganizationContext) {
    const pageSize = resolvePageSize(query.limit);
    const cursor = decodeCursor(query.cursor);
    const search = query.search?.trim();
    // Soft-deleted rows are retained for history but are excluded from the
    // default catalog view; `includeInactive=true` is how the UI asks for them.
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
      select: PRODUCT_SELECT,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: pageSize + 1,
    });
    return toPage(rows, pageSize);
  }

  async findOne(productId: string, org: OrganizationContext) {
    const product = await database.product.findFirst({
      where: { id: productId, organizationId: org.id },
      select: PRODUCT_SELECT,
    });
    if (!product) throw new NotFoundException("Product was not found.");
    return product;
  }

  async update(
    productId: string,
    input: UpdateProductDto,
    org: OrganizationContext,
    actorId: string,
  ) {
    try {
      return await runTransaction(async (tx) => {
        const existing = await tx.product.findFirst({
          where: { id: productId, organizationId: org.id },
          select: { id: true },
        });
        if (!existing) throw new NotFoundException("Product was not found.");

        const data: Prisma.ProductUpdateInput = {};
        if (input.name !== undefined) {
          const name = input.name.trim();
          if (!name)
            throw new BadRequestException("Product name cannot be blank.");
          data.name = name;
        }
        if (input.sku !== undefined) data.sku = input.sku?.trim() || null;
        if (input.barcode !== undefined)
          data.barcode = input.barcode?.trim() || null;
        if (input.categoryId !== undefined) {
          const categoryId = input.categoryId?.trim() || null;
          if (categoryId) {
            const category = await tx.productCategory.findFirst({
              where: { id: categoryId, organizationId: org.id },
              select: { id: true },
            });
            if (!category)
              throw new NotFoundException("Product category was not found.");
            data.category = { connect: { id: categoryId } };
          } else {
            data.category = { disconnect: true };
          }
        }
        if (input.unitPrice !== undefined)
          data.unitPrice = new Prisma.Decimal(input.unitPrice);
        if (input.costPrice !== undefined)
          data.costPrice = new Prisma.Decimal(input.costPrice);
        if (input.lowStockAt !== undefined) data.lowStockAt = input.lowStockAt;
        if (input.isActive !== undefined) data.isActive = input.isActive;

        const product = await tx.product.update({
          where: { id: productId },
          data,
          select: PRODUCT_SELECT,
        });
        await tx.auditLog.create({
          data: {
            organizationId: org.id,
            actorId,
            action: "catalog.product_updated",
            entityType: "product",
            entityId: product.id,
          },
        });
        return product;
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new ConflictException(
          "The product SKU or barcode is already in use.",
        );
      }
      throw error;
    }
  }

  /** Soft delete: the row is retained (and still referenced by history) but inactive. */
  async softDelete(
    productId: string,
    org: OrganizationContext,
    actorId: string,
  ) {
    return this.update(productId, { isActive: false }, org, actorId);
  }

  /** Undo a soft delete. Products are the only catalog entity that can be reactivated. */
  async restore(productId: string, org: OrganizationContext, actorId: string) {
    return this.update(productId, { isActive: true }, org, actorId);
  }
}

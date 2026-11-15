/**
 * Product response projections.
 *
 * Request validation for products lives in `operations.dto.ts` so a product has
 * exactly one input contract shared by `/business/products` and `/products`.
 * This file only describes the shape returned to clients: money is serialized as
 * a fixed two-decimal string (never a float) and the tenant id is echoed back so
 * the client can assert which organization answered.
 */
export class ProductOutput {
  id: string;
  organizationId: string;
  name: string;
  sku?: string | null;
  barcode?: string | null;
  unitPrice: string; // Decimal serialized as a fixed 2-decimal string
  costPrice: string; // Decimal serialized as a fixed 2-decimal string
  lowStockAt: number;
  isActive: boolean;
  categoryId?: string | null;
  category?: { id: string; name: string } | null;
  inventory?: { quantity: number } | null;
  createdAt: string;
  updatedAt?: string;

  constructor(partial: Partial<ProductOutput>) {
    Object.assign(this, partial);
  }
}

/** Cursor page of products: `nextCursor === null` means the end of the list. */
export class ProductListPage {
  items: ProductOutput[];
  nextCursor: string | null;
  hasMore: boolean;

  constructor(items: ProductOutput[], nextCursor: string | null = null, hasMore = false) {
    this.items = items;
    this.nextCursor = nextCursor;
    this.hasMore = hasMore;
  }
}

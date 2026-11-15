import { Transform, Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  Matches,
  Max,
  Min,
  ValidateNested,
  ValidateIf,
} from "class-validator";

const MONEY_PATTERN = /^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/;

export const ACCOUNT_TYPES = ["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"] as const;
export const NORMAL_BALANCES = ["DEBIT", "CREDIT"] as const;

export class CreateCategoryDto {
  @IsString()
  @Length(1, 120)
  name!: string;
}

export class CreateProductDto {
  @IsString()
  @Length(1, 160)
  name!: string;

  @IsOptional()
  @IsString()
  @Length(1, 80)
  sku?: string;

  @IsOptional()
  @IsString()
  @Length(1, 80)
  barcode?: string;

  @IsOptional()
  @IsString()
  @Length(1, 64)
  categoryId?: string;

  @IsString()
  @Matches(MONEY_PATTERN)
  unitPrice!: string;

  @IsString()
  @Matches(MONEY_PATTERN)
  costPrice!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  lowStockAt?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateProductDto {
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @Length(1, 160)
  name?: string;

  @IsOptional()
  @IsString()
  @Length(1, 80)
  sku?: string | null;

  @IsOptional()
  @IsString()
  @Length(1, 80)
  barcode?: string | null;

  @IsOptional()
  @IsString()
  @Length(1, 64)
  categoryId?: string | null;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @Matches(MONEY_PATTERN)
  unitPrice?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @Matches(MONEY_PATTERN)
  costPrice?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  lowStockAt?: number;

  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateCustomerDto {
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @Length(1, 160)
  name?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(320)
  email?: string | null;

  @IsOptional()
  @IsString()
  @Length(1, 40)
  phone?: string | null;

  @IsOptional()
  @IsString()
  @Length(1, 1000)
  notes?: string | null;

  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean()
  marketingConsent?: boolean;
}

export class UpdateSupplierDto {
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @Length(1, 160)
  name?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(320)
  email?: string | null;

  @IsOptional()
  @IsString()
  @Length(1, 40)
  phone?: string | null;

  @IsOptional()
  @IsString()
  @Length(1, 1000)
  notes?: string | null;
}

export class AdjustInventoryDto {
  @IsString()
  @Length(1, 64)
  productId!: string;

  @IsInt()
  @Min(-1_000_000)
  @Max(1_000_000)
  quantityDelta!: number;

  @IsString()
  @Matches(/^(count|damage|correction)$/)
  reason!: string;

  @IsOptional()
  @IsString()
  @Length(1, 500)
  note?: string;
}

export class CreateCustomerDto {
  @IsString()
  @Length(1, 160)
  name!: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @Length(1, 40)
  phone?: string;

  @IsOptional()
  @IsString()
  @Length(1, 1000)
  notes?: string;

  @IsOptional()
  @IsBoolean()
  marketingConsent?: boolean;
}

export class CreateSupplierDto {
  @IsString()
  @Length(1, 160)
  name!: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @Length(1, 40)
  phone?: string;

  @IsOptional()
  @IsString()
  @Length(1, 1000)
  notes?: string;
}

export class InvoiceLineDto {
  @IsString()
  @Length(1, 64)
  productId!: string;

  @IsInt()
  @Min(1)
  @Max(1_000_000)
  quantity!: number;
}

export class CreateSaleDto {
  @IsOptional()
  @IsString()
  @Length(1, 64)
  customerId?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => InvoiceLineDto)
  items!: InvoiceLineDto[];

  @IsOptional()
  @IsString()
  @Matches(MONEY_PATTERN)
  discount?: string;

  @IsOptional()
  @IsString()
  @Matches(MONEY_PATTERN)
  tax?: string;
}

export class PurchaseLineDto extends InvoiceLineDto {
  @IsString()
  @Matches(MONEY_PATTERN)
  unitCost!: string;
}

export class CreatePurchaseInvoiceDto {
  @IsString()
  @Length(1, 64)
  supplierId!: string;

  @IsString()
  @Length(1, 80)
  invoiceNumber!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => PurchaseLineDto)
  items!: PurchaseLineDto[];

  @IsOptional()
  @IsString()
  @Matches(MONEY_PATTERN)
  tax?: string;
}

export class CreateAccountDto {
  @IsString()
  @Length(1, 20)
  code!: string;

  @IsString()
  @Length(1, 120)
  name!: string;

  @IsIn(ACCOUNT_TYPES)
  type!: (typeof ACCOUNT_TYPES)[number];

  @IsIn(NORMAL_BALANCES)
  normalBalance!: (typeof NORMAL_BALANCES)[number];

  @IsOptional()
  @IsString()
  @Length(255)
  description?: string;

  @IsBoolean()
  isActive?: boolean = true;
}

export class UpdateAccountDto {
  @IsOptional()
  @IsString()
  @Length(1, 120)
  name?: string;

  @IsOptional()
  @IsString()
  @Length(1, 20)
  code?: string;

  @IsOptional()
  @IsIn(ACCOUNT_TYPES)
  type?: (typeof ACCOUNT_TYPES)[number];

  @IsOptional()
  @IsIn(NORMAL_BALANCES)
  normalBalance?: (typeof NORMAL_BALANCES)[number];

  @IsOptional()
  @IsString()
  @Length(255)
  description?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CreateJournalEntryDto {
  @IsOptional()
  @IsString()
  @Length(1, 100)
  reference?: string;

  @IsString()
  @Length(1, 255)
  description!: string;

  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => JournalEntryLineDto)
  lines!: JournalEntryLineDto[];
}

// Money crosses the API boundary as exact decimal strings, never floats.
const JOURNAL_AMOUNT_PATTERN = /^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/;

export class JournalEntryLineDto {
  @IsString()
  @Length(1, 191)
  accountId!: string;

  @IsString()
  @Matches(JOURNAL_AMOUNT_PATTERN)
  debit!: string;

  @IsString()
  @Matches(JOURNAL_AMOUNT_PATTERN)
  credit!: string;

  @IsOptional()
  @IsString()
  @Length(1, 255)
  description?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  orderIndex?: number;
}

export class UpdateJournalEntryDto {
  @IsOptional()
  @IsString()
  @Length(100)
  reference?: string;

  @IsOptional()
  @IsString()
  @Length(255)
  description?: string;

  @IsOptional()
  @IsString()
  @Length(20)
  status?: 'DRAFT' | 'POSTED';
}

export class CreatePaymentDto {
  @IsOptional()
  @IsString()
  @Length(1, 64)
  saleId?: string;

  @IsOptional()
  @IsString()
  @Length(1, 64)
  purchaseInvoiceId?: string;

  @IsString()
  @Matches(/^(?:0|[1-9]\d{0,11})\.\d{2}$/)
  amount!: string;

  @IsString()
  @Matches(/^(cash|card|bank_transfer|other)$/)
  method!: string;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  reference?: string;
}

/**
 * Shared list query contract for Phase 3 pagination/search.
 *
 * `cursor` is an opaque, base64-encoded `{ createdAt, id }` pair so ordering is
 * stable even when many rows share a timestamp. `limit` is bounded server-side.
 */
export class ListQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(512)
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  /**
   * Catalog lists hide soft-deleted rows by default. Clients that need the
   * archive view (e.g. to restore a product) pass `includeInactive=true`.
   */
  @IsOptional()
  @Transform(({ value }) =>
    value === true || value === "true" || value === "1" ? true : value === false || value === "false" || value === "0" ? false : value,
  )
  @IsBoolean()
  includeInactive?: boolean;
}

export class AuditQueryDto extends ListQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Matches(/^[a-zA-Z0-9_.:-]*$/)
  action?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Matches(/^[a-zA-Z0-9_.:-]*$/)
  entityType?: string;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  entityId?: string;

  @IsOptional()
  @IsString()
  @Length(1, 64)
  actorId?: string;
}

export class MovementQueryDto extends ListQueryDto {
  @IsOptional()
  @IsString()
  @Length(1, 64)
  productId?: string;

  @IsOptional()
  @IsString()
  @Matches(/^(count|damage|correction|sale|purchase)$/)
  reason?: string;
}

export class AccountQueryDto extends ListQueryDto {
  @IsOptional()
  @IsIn(ACCOUNT_TYPES)
  type?: (typeof ACCOUNT_TYPES)[number];

  @IsOptional()
  @IsIn(["true", "false"])
  activeOnly?: string;
}

export class JournalQueryDto extends ListQueryDto {
  @IsOptional()
  @IsIn(["DRAFT", "POSTED"])
  status?: "DRAFT" | "POSTED";
}

export class CreateBranchDto {
  @IsString()
  @Length(1, 120)
  name!: string;
}

export class UpdateBranchDto {
  @IsString()
  @Length(1, 120)
  name!: string;
}

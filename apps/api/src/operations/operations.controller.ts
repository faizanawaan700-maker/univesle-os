import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { ApiRequest } from "../common/http-context";
import { OrganizationScopeGuard } from "../organizations/organization-scope.guard";
import { PermissionsGuard } from "../organizations/permissions.guard";
import { RequirePermissions } from "../organizations/require-permissions.decorator";
import {
  AccountQueryDto,
  AdjustInventoryDto,
  AuditQueryDto,
  CreateAccountDto,
  CreateBranchDto,
  CreateCategoryDto,
  CreateCustomerDto,
  CreateJournalEntryDto,
  CreatePaymentDto,
  CreateProductDto,
  CreatePurchaseInvoiceDto,
  CreateSaleDto,
  CreateSupplierDto,
  JournalQueryDto,
  ListQueryDto,
  MovementQueryDto,
  UpdateAccountDto,
  UpdateBranchDto,
  UpdateCustomerDto,
  UpdateProductDto,
  UpdateSupplierDto,
} from "./operations.dto";
import { OperationsService } from "./operations.service";
import { AnalyticsService } from "./analytics.service";
import { AnalyticsQueryDto } from "./analytics.dto";

@Controller("business")
@UseGuards(OrganizationScopeGuard, PermissionsGuard)
export class OperationsController {
  constructor(
    private readonly operations: OperationsService,
    private readonly analytics: AnalyticsService,
  ) {}

  @Get("categories")
  @RequirePermissions("catalog.read")
  categories(@Req() request: ApiRequest) {
    return this.operations.listCategories(request.organization!);
  }

  @Post("categories")
  @RequirePermissions("catalog.manage")
  createCategory(@Body() input: CreateCategoryDto, @Req() request: ApiRequest) {
    return this.operations.createCategory(input, request.organization!, request.user!.id);
  }

  @Get("products")
  @RequirePermissions("catalog.read")
  products(@Query() query: ListQueryDto, @Req() request: ApiRequest) {
    return this.operations.listProducts(request.organization!, query);
  }

  @Post("products")
  @RequirePermissions("catalog.manage")
  createProduct(@Body() input: CreateProductDto, @Req() request: ApiRequest) {
    return this.operations.createProduct(input, request.organization!, request.user!.id);
  }

  @Get("products/:id")
  @RequirePermissions("catalog.read")
  product(@Param("id") id: string, @Req() request: ApiRequest) {
    return this.operations.getProduct(id, request.organization!);
  }

  @Patch("products/:id")
  @RequirePermissions("catalog.manage")
  updateProduct(@Param("id") id: string, @Body() input: UpdateProductDto, @Req() request: ApiRequest) {
    return this.operations.updateProduct(id, input, request.organization!, request.user!.id);
  }

  @Post("products/:id/archive")
  @RequirePermissions("catalog.manage")
  archiveProduct(@Param("id") id: string, @Req() request: ApiRequest) {
    return this.operations.setProductActive(id, false, request.organization!, request.user!.id);
  }

  @Post("products/:id/restore")
  @RequirePermissions("catalog.manage")
  restoreProduct(@Param("id") id: string, @Req() request: ApiRequest) {
    return this.operations.setProductActive(id, true, request.organization!, request.user!.id);
  }

  @Get("inventory")
  @RequirePermissions("inventory.read")
  inventory(@Req() request: ApiRequest) {
    return this.operations.listInventory(request.organization!);
  }

  @Post("inventory/adjustments")
  @RequirePermissions("inventory.manage")
  adjustInventory(@Body() input: AdjustInventoryDto, @Headers("idempotency-key") key: string | undefined, @Req() request: ApiRequest) {
    return this.operations.adjustInventory(input, request.organization!, request.user!.id, key);
  }

  @Get("customers")
  @RequirePermissions("customers.read")
  customers(@Query() query: ListQueryDto, @Req() request: ApiRequest) {
    return this.operations.listCustomers(request.organization!, query);
  }

  @Post("customers")
  @RequirePermissions("customers.manage")
  createCustomer(@Body() input: CreateCustomerDto, @Req() request: ApiRequest) {
    return this.operations.createCustomer(input, request.organization!, request.user!.id);
  }

  @Patch("customers/:id")
  @RequirePermissions("customers.manage")
  updateCustomer(@Param("id") id: string, @Body() input: UpdateCustomerDto, @Req() request: ApiRequest) {
    return this.operations.updateCustomer(id, input, request.organization!, request.user!.id);
  }

  @Get("suppliers")
  @RequirePermissions("procurement.read")
  suppliers(@Query() query: ListQueryDto, @Req() request: ApiRequest) {
    return this.operations.listSuppliers(request.organization!, query);
  }

  @Post("suppliers")
  @RequirePermissions("procurement.manage")
  createSupplier(@Body() input: CreateSupplierDto, @Req() request: ApiRequest) {
    return this.operations.createSupplier(input, request.organization!, request.user!.id);
  }

  @Patch("suppliers/:id")
  @RequirePermissions("procurement.manage")
  updateSupplier(@Param("id") id: string, @Body() input: UpdateSupplierDto, @Req() request: ApiRequest) {
    return this.operations.updateSupplier(id, input, request.organization!, request.user!.id);
  }

  @Get("sales")
  @RequirePermissions("sales.read")
  sales(@Query() query: ListQueryDto, @Req() request: ApiRequest) {
    return this.operations.listSales(request.organization!, query);
  }

  @Post("sales")
  @RequirePermissions("sales.manage")
  createSale(@Body() input: CreateSaleDto, @Headers("idempotency-key") key: string | undefined, @Req() request: ApiRequest) {
    return this.operations.createSale(input, request.organization!, request.user!.id, key);
  }

  @Get("purchases")
  @RequirePermissions("procurement.read")
  purchases(@Query() query: ListQueryDto, @Req() request: ApiRequest) {
    return this.operations.listPurchases(request.organization!, query);
  }

  @Post("purchases")
  @RequirePermissions("procurement.manage", "inventory.manage")
  createPurchase(@Body() input: CreatePurchaseInvoiceDto, @Headers("idempotency-key") key: string | undefined, @Req() request: ApiRequest) {
    return this.operations.createPurchase(input, request.organization!, request.user!.id, key);
  }

  @Get("payments")
  @RequirePermissions("payments.manage")
  payments(@Query() query: ListQueryDto, @Req() request: ApiRequest) {
    return this.operations.listPayments(request.organization!, query);
  }

  @Post("payments")
  @RequirePermissions("payments.manage")
  createPayment(@Body() input: CreatePaymentDto, @Headers("idempotency-key") key: string | undefined, @Req() request: ApiRequest) {
    return this.operations.createPayment(input, request.organization!, request.user!.id, key);
  }

  @Get("reports/summary")
  @RequirePermissions("reports.read")
  summary(@Req() request: ApiRequest) {
    return this.operations.getReport(request.organization!);
  }

  /**
   * Phase 6 analytics: reconciled facts, trends, top products/customers and a
   * separately-labelled forecast. Read-only and organization-scoped.
   */
  @Get("analytics")
  @RequirePermissions("reports.read")
  analyticsDashboard(@Query() query: AnalyticsQueryDto, @Req() request: ApiRequest) {
    return this.analytics.getDashboard(request.organization!, query);
  }

  @Get("audit")
  @RequirePermissions("audit.read")
  audit(@Query() query: AuditQueryDto, @Req() request: ApiRequest) {
    return this.operations.listAuditLogs(request.organization!, query);
  }

  /** Complete stock-movement ledger, cursor-paginated and filterable by product/reason. */
  @Get("inventory/movements")
  @RequirePermissions("inventory.read")
  movements(@Query() query: MovementQueryDto, @Req() request: ApiRequest) {
    return this.operations.listStockMovements(request.organization!, query);
  }

  // ---------------------------------------------------------------------------
  // Branches
  // ---------------------------------------------------------------------------

  @Get("branches")
  @RequirePermissions("organization.read")
  branches(@Req() request: ApiRequest) {
    return this.operations.listBranches(request.organization!);
  }

  @Post("branches")
  @RequirePermissions("organization.manage")
  createBranch(@Body() input: CreateBranchDto, @Req() request: ApiRequest) {
    return this.operations.createBranch(input, request.organization!, request.user!.id);
  }

  @Patch("branches/:id")
  @RequirePermissions("organization.manage")
  updateBranch(@Param("id") id: string, @Body() input: UpdateBranchDto, @Req() request: ApiRequest) {
    return this.operations.updateBranch(id, input, request.organization!, request.user!.id);
  }

  @Delete("branches/:id")
  @RequirePermissions("organization.manage")
  deleteBranch(@Param("id") id: string, @Req() request: ApiRequest) {
    return this.operations.deleteBranch(id, request.organization!, request.user!.id);
  }

  // ---------------------------------------------------------------------------
  // Accounting (Chart of Accounts + Journal Entries)
  // ---------------------------------------------------------------------------

  @Get("accounts")
  @RequirePermissions("accounting.read")
  accounts(@Query() query: AccountQueryDto, @Req() request: ApiRequest) {
    return this.operations.listAccounts(request.organization!, query);
  }

  @Post("accounts")
  @RequirePermissions("accounting.manage")
  createAccount(@Body() input: CreateAccountDto, @Req() request: ApiRequest) {
    return this.operations.createAccount(input, request.organization!, request.user!.id);
  }

  @Get("accounts/:id")
  @RequirePermissions("accounting.read")
  account(@Param("id") id: string, @Req() request: ApiRequest) {
    return this.operations.getAccount(id, request.organization!);
  }

  @Patch("accounts/:id")
  @RequirePermissions("accounting.manage")
  updateAccount(@Param("id") id: string, @Body() input: UpdateAccountDto, @Req() request: ApiRequest) {
    return this.operations.updateAccount(id, input, request.organization!, request.user!.id);
  }

  @Get("accounts/:id/balance")
  @RequirePermissions("accounting.read")
  accountBalance(@Param("id") id: string, @Req() request: ApiRequest) {
    return this.operations.getAccountBalance(id, request.organization!);
  }

  @Get("journal-entries")
  @RequirePermissions("accounting.read")
  journalEntries(@Query() query: JournalQueryDto, @Req() request: ApiRequest) {
    return this.operations.listJournalEntries(request.organization!, query);
  }

  @Post("journal-entries")
  @RequirePermissions("accounting.manage")
  createJournalEntry(@Body() input: CreateJournalEntryDto, @Req() request: ApiRequest) {
    return this.operations.createJournalEntry(input, request.organization!, request.user!.id);
  }
}

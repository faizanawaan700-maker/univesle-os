import {
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { ApiRequest } from "../common/http-context";
import { OrganizationScopeGuard } from "../organizations/organization-scope.guard";
import { PermissionsGuard } from "../organizations/permissions.guard";
import { RequirePermissions } from "../organizations/require-permissions.decorator";
import { AccountingService } from "./accounting.service";
import { VoidService } from "./void.service";

function parseDate(
  value: string | undefined,
  endOfDay: boolean,
): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(
    `${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`,
  );
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

@Controller("business/accounting")
@UseGuards(OrganizationScopeGuard, PermissionsGuard)
export class AccountingController {
  constructor(
    private readonly accounting: AccountingService,
    private readonly voids: VoidService,
  ) {}

  @Get("periods")
  @RequirePermissions("accounting.read")
  async periods(@Req() request: ApiRequest) {
    return this.accounting.listPeriods(request.organization!);
  }

  @Post("periods/:id/close")
  @RequirePermissions("accounting.manage")
  async close(@Param("id") id: string, @Req() request: ApiRequest) {
    return this.accounting.closePeriod(
      id,
      request.organization!,
      request.user!.id,
    );
  }

  @Post("periods/:id/reopen")
  @RequirePermissions("accounting.manage")
  async reopen(@Param("id") id: string, @Req() request: ApiRequest) {
    return this.accounting.reopenPeriod(
      id,
      request.organization!,
      request.user!.id,
    );
  }

  @Get("trial-balance")
  @RequirePermissions("accounting.read")
  async trialBalance(
    @Query("from") from: string | undefined,
    @Query("to") to: string | undefined,
    @Req() request: ApiRequest,
  ) {
    return this.accounting.trialBalanceReport(
      request.organization!,
      parseDate(from, false),
      parseDate(to, true),
    );
  }

  @Get("statements")
  @RequirePermissions("accounting.read")
  async statements(
    @Query("from") from: string | undefined,
    @Query("to") to: string | undefined,
    @Req() request: ApiRequest,
  ) {
    return this.accounting.statements(
      request.organization!,
      parseDate(from, false),
      parseDate(to, true),
    );
  }

  @Get("subledgers")
  @RequirePermissions("accounting.read")
  async subledgers(@Req() request: ApiRequest) {
    return this.accounting.subledgers(request.organization!);
  }

  /**
   * Voiding is a correction of a posted document. It requires both the document
   * permission and accounting authority, and is recorded as an audit event.
   */
  @Post("void/sales/:id")
  @RequirePermissions("sales.manage", "accounting.manage")
  async voidSale(@Param("id") id: string, @Req() request: ApiRequest) {
    return this.voids.voidSale(id, request.organization!, request.user!.id);
  }

  @Post("void/purchases/:id")
  @RequirePermissions(
    "procurement.manage",
    "inventory.manage",
    "accounting.manage",
  )
  async voidPurchase(@Param("id") id: string, @Req() request: ApiRequest) {
    return this.voids.voidPurchase(id, request.organization!, request.user!.id);
  }
}

/**
 * Product routes.
 *
 * Every route requires an authenticated session plus an organization selected
 * through `X-Organization-Id`; `OrganizationScopeGuard` resolves the membership
 * and `PermissionsGuard` enforces the catalog permissions. The organization is
 * always taken from that guarded context, never from the request body or URL.
 */
import {
  Body,
  Controller,
  Get,
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
  CreateProductDto,
  ListQueryDto,
  UpdateProductDto,
} from "../operations/operations.dto";
import { ProductsService } from "./products.service";

@Controller("products")
@UseGuards(OrganizationScopeGuard, PermissionsGuard)
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  @RequirePermissions("catalog.read")
  list(@Query() query: ListQueryDto, @Req() request: ApiRequest) {
    return this.productsService.list(query, request.organization!);
  }

  @Get("search")
  @RequirePermissions("catalog.read")
  search(@Query("q") query: string, @Req() request: ApiRequest) {
    return this.productsService.list({ search: query }, request.organization!);
  }

  @Post()
  @RequirePermissions("catalog.manage")
  create(@Body() dto: CreateProductDto, @Req() request: ApiRequest) {
    return this.productsService.create(
      dto,
      request.organization!,
      request.user!.id,
    );
  }

  @Get(":id")
  @RequirePermissions("catalog.read")
  findOne(@Param("id") productId: string, @Req() request: ApiRequest) {
    return this.productsService.findOne(productId, request.organization!);
  }

  @Patch(":id")
  @RequirePermissions("catalog.manage")
  update(
    @Param("id") productId: string,
    @Body() dto: UpdateProductDto,
    @Req() request: ApiRequest,
  ) {
    return this.productsService.update(
      productId,
      dto,
      request.organization!,
      request.user!.id,
    );
  }

  @Post(":id/soft-delete")
  @RequirePermissions("catalog.manage")
  softDelete(@Param("id") productId: string, @Req() request: ApiRequest) {
    return this.productsService.softDelete(
      productId,
      request.organization!,
      request.user!.id,
    );
  }

  @Post(":id/restore")
  @RequirePermissions("catalog.manage")
  restore(@Param("id") productId: string, @Req() request: ApiRequest) {
    return this.productsService.restore(
      productId,
      request.organization!,
      request.user!.id,
    );
  }
}

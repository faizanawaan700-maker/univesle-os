import {
  BadRequestException,
  Body,
  Controller,
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
import { IngestEventDto, UpdateSettingsDto } from "./integrations.dto";
import { IntegrationsService } from "./integrations.service";
import { OutboundService } from "./outbound.service";

/**
 * Inbound provider events. The organization, provider and webhook secret are
 * resolved server-side; the request body can never choose the tenant.
 *
 * The per-provider secret lives in `INTEGRATION_WEBHOOK_SECRET_<PROVIDER>`
 * (upper-case, non-alphanumerics replaced with `_`), e.g.
 * `INTEGRATION_WEBHOOK_SECRET_STRIPE`. With no secret configured, ingestion is
 * refused rather than silently trusted.
 */
@Controller("business/integrations")
@UseGuards(OrganizationScopeGuard, PermissionsGuard)
export class IntegrationsController {
  constructor(
    private readonly integrations: IntegrationsService,
    private readonly outbound: OutboundService,
  ) {}

  @Post(":provider/events")
  @RequirePermissions("integration.manage")
  async ingest(
    @Param("provider") provider: string,
    @Body() input: IngestEventDto,
    @Headers("x-ubos-signature") signature: string | undefined,
    @Headers("x-ubos-timestamp") timestamp: string | undefined,
    @Req() request: ApiRequest,
  ) {
    const normalizedProvider = this.normalizeProvider(provider);
    const rawBody = input.payload;
    const secret = await this.integrations.getVerifiedSecret(normalizedProvider, request.organization!);
    this.integrations.verifySignature({ secret, signature, timestamp, rawBody });
    return this.integrations.ingest(
      normalizedProvider,
      input,
      request.organization!,
      rawBody,
      signature ?? "",
    );
  }

  @Post(":provider/secret")
  @RequirePermissions("integration.manage")
  createSecret(@Param("provider") provider: string, @Req() request: ApiRequest) {
    return this.integrations.setWebhookSecret(this.normalizeProvider(provider), request.organization!, request.user!.id);
  }

  @Get("outbound")
  @RequirePermissions("integration.read")
  outboundEvents(@Query("status") status: string | undefined, @Req() request: ApiRequest) {
    return this.outbound.list(request.organization!, status);
  }

  /** Runs one delivery pass; safe to call repeatedly and from a scheduler. */
  @Post("outbound/dispatch")
  @RequirePermissions("integration.manage")
  dispatch() {
    return this.outbound.dispatchDue();
  }

  @Post("outbound/:id/requeue")
  @RequirePermissions("integration.manage")
  requeue(@Param("id") id: string, @Req() request: ApiRequest) {
    return this.outbound.requeue(id, request.organization!);
  }

  @Get("events")
  @RequirePermissions("integration.read")
  events(
    @Query("provider") provider: string | undefined,
    @Req() request: ApiRequest,
  ) {
    return this.integrations.listEvents(request.organization!, provider);
  }

  @Post("events/:id/processed")
  @RequirePermissions("integration.manage")
  processed(@Param("id") id: string, @Req() request: ApiRequest) {
    return this.integrations.markProcessed(
      id,
      request.organization!,
      request.user!.id,
    );
  }

  @Get("settings")
  @RequirePermissions("organization.read")
  settings(@Req() request: ApiRequest) {
    return this.integrations.getSettings(request.organization!);
  }

  @Patch("settings")
  @RequirePermissions("organization.manage")
  updateSettings(@Body() input: UpdateSettingsDto, @Req() request: ApiRequest) {
    return this.integrations.updateSettings(
      input,
      request.organization!,
      request.user!.id,
    );
  }

  private normalizeProvider(provider: string): string {
    const normalized = provider.toLowerCase().replace(/[^a-z0-9_-]/g, "");
    if (!normalized || normalized.length > 60) {
      throw new BadRequestException("Unsupported provider.");
    }
    return normalized;
  }
}

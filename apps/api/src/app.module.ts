import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { AuthController } from "./auth/auth.controller";
import { AuthGuard } from "./auth/auth.guard";
import { AuthService } from "./auth/auth.service";
import { OriginGuard } from "./common/origin.guard";
import { OrganizationsController } from "./organizations/organizations.controller";
import { OrganizationScopeGuard } from "./organizations/organization-scope.guard";
import { PermissionsGuard } from "./organizations/permissions.guard";
import { OrganizationsService } from "./organizations/organizations.service";
import { OperationsController } from "./operations/operations.controller";
import { OperationsService } from "./operations/operations.service";
import { InvitationController, TeamController } from "./organizations/team.controller";
import { TeamService } from "./organizations/team.service";
import { AnalyticsService } from "./operations/analytics.service";
import { AiController } from "./ai/ai.controller";
import { AiService } from "./ai/ai.service";
import { HealthController } from "./health/health.controller";
import { IntegrationsController } from "./integrations/integrations.controller";
import { IntegrationsService } from "./integrations/integrations.service";
import { AccountingController } from "./accounting/accounting.controller";
import { AccountingService } from "./accounting/accounting.service";
import { LedgerService } from "./accounting/ledger.service";
import { VoidService } from "./accounting/void.service";
import { HttpWebhookAdapter, OutboundService } from "./integrations/outbound.service";
import { ProductsController } from "./products/products.controller";
import { ProductsService } from "./products/products.service";

@Module({
  imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }])],
  controllers: [
    AuthController,
    OrganizationsController,
    OperationsController,
    TeamController,
    InvitationController,
    AiController,
    HealthController,
    IntegrationsController,
    AccountingController,
    ProductsController,
  ],
  providers: [
    AuthService,
    OrganizationsService,
    OperationsService,
    TeamService,
    AnalyticsService,
    AiService,
    IntegrationsService,
    LedgerService,
    AccountingService,
    VoidService,
    HttpWebhookAdapter,
    OutboundService,
    ProductsService,
    OrganizationScopeGuard,
    PermissionsGuard,
    { provide: APP_GUARD, useClass: OriginGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule {}

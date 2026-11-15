import { Body, Controller, Get, Param, Post, Req, UseGuards } from "@nestjs/common";
import type { ApiRequest } from "../common/http-context";
import { OrganizationScopeGuard } from "../organizations/organization-scope.guard";
import { PermissionsGuard } from "../organizations/permissions.guard";
import { RequirePermissions } from "../organizations/require-permissions.decorator";
import { AssistantQueryDto, CreateProposalDto } from "./ai.dto";
import { AiService } from "./ai.service";

/**
 * AI Business Manager API.
 *
 * Read answers require `reports.read`. Creating a proposal is a write, so it
 * requires `reports.manage`-equivalent authority: `accounting.manage` is used
 * because proposals concern financial/stock actions and that permission is
 * already granted only to trusted roles. Approval never executes anything.
 */
@Controller("business/assistant")
@UseGuards(OrganizationScopeGuard, PermissionsGuard)
export class AiController {
  constructor(private readonly ai: AiService) {}

  @Get("tools")
  @RequirePermissions("reports.read")
  tools() {
    return { tools: this.ai.tools, writes: false };
  }

  @Post("ask")
  @RequirePermissions("reports.read")
  ask(@Body() input: AssistantQueryDto, @Req() request: ApiRequest) {
    return this.ai.ask(request.organization!, input);
  }

  @Get("proposals")
  @RequirePermissions("reports.read")
  proposals(@Req() request: ApiRequest) {
    return this.ai.listProposals(request.organization!);
  }

  @Post("proposals")
  @RequirePermissions("accounting.manage")
  createProposal(@Body() input: CreateProposalDto, @Req() request: ApiRequest) {
    return this.ai.createProposal(input, request.organization!, request.user!.id);
  }

  @Post("proposals/:id/approve")
  @RequirePermissions("accounting.manage")
  approve(@Param("id") id: string, @Req() request: ApiRequest) {
    return this.ai.approveProposal(id, request.organization!, request.user!.id);
  }
}

import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  UseGuards,
  UnauthorizedException,
} from "@nestjs/common";
import type { ApiRequest } from "../common/http-context";
import { OrganizationScopeGuard } from "./organization-scope.guard";
import { PermissionsGuard } from "./permissions.guard";
import { RequirePermissions } from "./require-permissions.decorator";
import { CreateOrganizationDto } from "./organizations.dto";
import { OrganizationsService } from "./organizations.service";

@Controller("organizations")
export class OrganizationsController {
  constructor(private readonly organizations: OrganizationsService) {}

  @Get()
  list(@Req() request: ApiRequest) {
    if (!request.user) throw new UnauthorizedException("Authentication is required.");
    return this.organizations.listForUser(request.user.id);
  }

  @Post()
  create(@Body() input: CreateOrganizationDto, @Req() request: ApiRequest) {
    if (!request.user) throw new UnauthorizedException("Authentication is required.");
    return this.organizations.create(input, request.user);
  }

  @Get("current")
  @RequirePermissions("organization.read")
  @UseGuards(OrganizationScopeGuard, PermissionsGuard)
  current(@Req() request: ApiRequest) {
    return this.organizations.getCurrentOrganization(request.organization!);
  }
}

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { ApiRequest } from "../common/http-context";
import { Public } from "../auth/public.decorator";
import { OrganizationScopeGuard } from "./organization-scope.guard";
import { PermissionsGuard } from "./permissions.guard";
import { RequirePermissions } from "./require-permissions.decorator";
import {
  AcceptInvitationDto,
  CreateInvitationDto,
  CreateRoleDto,
  UpdateMemberBranchesDto,
  UpdateMemberRoleDto,
  UpdateRoleDto,
  UpsertEmployeeProfileDto,
} from "./team.dto";
import { TeamService } from "./team.service";

@Controller("business/team")
@UseGuards(OrganizationScopeGuard, PermissionsGuard)
export class TeamController {
  constructor(private readonly team: TeamService) {}

  // Members ---------------------------------------------------------------

  @Get("members")
  @RequirePermissions("organization.read")
  members(@Req() request: ApiRequest) {
    return this.team.listMembers(request.organization!);
  }

  @Patch("members/:id/role")
  @RequirePermissions("organization.manage")
  changeMemberRole(
    @Param("id") id: string,
    @Body() input: UpdateMemberRoleDto,
    @Req() request: ApiRequest,
  ) {
    return this.team.updateMemberRole(
      id,
      input,
      request.organization!,
      request.user!.id,
    );
  }

  @Patch("members/:id/branches")
  @RequirePermissions("organization.manage")
  updateBranches(
    @Param("id") id: string,
    @Body() input: UpdateMemberBranchesDto,
    @Req() request: ApiRequest,
  ) {
    return this.team.setMemberBranches(
      id,
      input,
      request.organization!,
      request.user!.id,
    );
  }

  @Patch("members/:id/employee")
  @RequirePermissions("organization.manage")
  updateEmployee(
    @Param("id") id: string,
    @Body() input: UpsertEmployeeProfileDto,
    @Req() request: ApiRequest,
  ) {
    return this.team.upsertEmployee(
      id,
      input,
      request.organization!,
      request.user!.id,
    );
  }

  @Delete("members/:id")
  @RequirePermissions("organization.manage")
  removeMember(@Param("id") id: string, @Req() request: ApiRequest) {
    return this.team.removeMember(id, request.organization!, request.user!.id);
  }

  // Invitations -----------------------------------------------------------

  @Get("invitations")
  @RequirePermissions("organization.manage")
  invitations(@Req() request: ApiRequest) {
    return this.team.listInvitations(request.organization!);
  }

  @Post("invitations")
  @RequirePermissions("organization.manage")
  createInvitation(
    @Body() input: CreateInvitationDto,
    @Req() request: ApiRequest,
  ) {
    return this.team.createInvitation(
      input,
      request.organization!,
      request.user!.id,
    );
  }

  @Delete("invitations/:id")
  @RequirePermissions("organization.manage")
  revokeInvitation(@Param("id") id: string, @Req() request: ApiRequest) {
    return this.team.revokeInvitation(
      id,
      request.organization!,
      request.user!.id,
    );
  }

  // Roles -----------------------------------------------------------------

  @Get("roles")
  @RequirePermissions("organization.read")
  roles(@Req() request: ApiRequest) {
    return this.team.listRoles(request.organization!);
  }

  @Get("permissions")
  @RequirePermissions("organization.read")
  permissions() {
    return this.team.listPermissions();
  }

  @Post("roles")
  @RequirePermissions("organization.manage")
  createRole(@Body() input: CreateRoleDto, @Req() request: ApiRequest) {
    return this.team.createRole(input, request.organization!, request.user!.id);
  }

  @Patch("roles/:id")
  @RequirePermissions("organization.manage")
  editRole(
    @Param("id") id: string,
    @Body() input: UpdateRoleDto,
    @Req() request: ApiRequest,
  ) {
    return this.team.updateRole(
      id,
      input,
      request.organization!,
      request.user!.id,
    );
  }

  // Current member scope --------------------------------------------------

  @Get("me/branches")
  @RequirePermissions("organization.read")
  myBranches(@Req() request: ApiRequest) {
    return this.team.listMyBranches(request.organization!);
  }
}

/**
 * Invitation acceptance is deliberately separate from `/business/team`: the
 * caller is not a member yet, so no organization header or role permission can
 * apply. Authorization comes from the invitation token plus the session email.
 */
@Controller("invitations")
export class InvitationController {
  constructor(private readonly team: TeamService) {}

  @Post(":token/accept")
  @HttpCode(200)
  accept(@Param("token") token: string, @Req() request: ApiRequest) {
    if (!request.user)
      throw new UnauthorizedException("Authentication is required.");
    return this.team.acceptInvitation({ token }, request.user);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post("accept")
  @HttpCode(201)
  acceptByRegistration(@Body() input: AcceptInvitationDto) {
    return this.team.acceptInvitationByRegistration(input);
  }
}

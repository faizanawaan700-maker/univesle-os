import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { database } from "@ubos/database";
import type { ApiRequest } from "../common/http-context";

@Injectable()
export class OrganizationScopeGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<ApiRequest>();
    if (!request.user) throw new UnauthorizedException("Authentication is required.");

    const organizationId = request.header("x-organization-id");
    if (!organizationId || organizationId.length > 64) {
      throw new ForbiddenException("Select an organization for this request.");
    }

    const membership = await database.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId,
          userId: request.user.id,
        },
      },
      select: {
        id: true,
        organization: { select: { id: true, name: true } },
        role: {
          select: {
            key: true,
            permissions: {
              select: { permission: { select: { key: true } } },
            },
          },
        },
      },
    });

    if (!membership) throw new ForbiddenException("Organization access is denied.");

    request.organization = {
      id: membership.organization.id,
      name: membership.organization.name,
      memberId: membership.id,
      roleKey: membership.role.key,
      permissions: membership.role.permissions.map(({ permission }) => permission.key),
    };
    return true;
  }
}

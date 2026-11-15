import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { ApiRequest } from "../common/http-context";
import { REQUIRED_PERMISSIONS } from "./require-permissions.decorator";

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(
      REQUIRED_PERMISSIONS,
      [context.getHandler(), context.getClass()],
    );
    if (!requiredPermissions?.length) return true;

    const request = context.switchToHttp().getRequest<ApiRequest>();
    if (!request.user) throw new UnauthorizedException("Authentication is required.");
    if (!request.organization) {
      throw new ForbiddenException("Select an organization for this request.");
    }

    const grantedPermissions = new Set(request.organization.permissions);
    if (!requiredPermissions.every((permission) => grantedPermissions.has(permission))) {
      throw new ForbiddenException("The organization role lacks required permissions.");
    }
    return true;
  }
}

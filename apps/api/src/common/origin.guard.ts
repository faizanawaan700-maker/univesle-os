import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import type { ApiRequest } from "./http-context";
import { normalizeOrigin } from "./origin";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

@Injectable()
export class OriginGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<ApiRequest>();
    if (SAFE_METHODS.has(request.method)) return true;

    const origin = request.get("origin");
    const allowedOrigin = normalizeOrigin(process.env.FRONTEND_ORIGIN);

    if (origin !== allowedOrigin) {
      throw new ForbiddenException("Request origin is not allowed.");
    }

    return true;
  }
}

import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { database } from "@ubos/database";
import { createHash } from "node:crypto";
import type { ApiRequest } from "../common/http-context";
import { readCookie } from "./read-cookie";

const PUBLIC_ROUTE = "isPublic";
const SESSION_COOKIE = "ubos_session";

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<ApiRequest>();
    const token = readCookie(request.headers.cookie, SESSION_COOKIE);
    if (!token || token.length > 128) {
      throw new UnauthorizedException("Authentication is required.");
    }

    const tokenHash = createHash("sha256").update(token).digest("hex");
    const session = await database.session.findUnique({
      where: { tokenHash },
      include: { user: { select: { id: true, email: true, name: true } } },
    });

    const now = new Date();
    if (!session || session.expiresAt <= now) {
      if (session) {
        await database.session.deleteMany({
          where: { id: session.id, expiresAt: { lte: now } },
        });
      }
      throw new UnauthorizedException("Authentication is required.");
    }

    request.user = session.user;
    return true;
  }
}



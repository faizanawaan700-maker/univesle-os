import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Request, Response } from "express";
import type { ApiRequest } from "../common/http-context";
import { AuthService, CreatedSession } from "./auth.service";
import { LoginDto, RegisterDto } from "./auth.dto";
import { Public } from "./public.decorator";
import { readCookie } from "./read-cookie";

const SESSION_COOKIE = "ubos_session";

@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Throttle({ default: { limit: 8, ttl: 60_000 } })
  @Post("register")
  async register(
    @Body() input: RegisterDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const session = await this.authService.register(input);
    setSessionCookie(response, session);
    return { user: session.user };
  }

  @Public()
  @Throttle({ default: { limit: 8, ttl: 60_000 } })
  @HttpCode(200)
  @Post("login")
  async login(
    @Body() input: LoginDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const session = await this.authService.login(input);
    setSessionCookie(response, session);
    return { user: session.user };
  }

  @Get("me")
  me(@Req() request: ApiRequest) {
    return this.authService.getProfile(request.user!.id);
  }

  @HttpCode(204)
  @Post("logout")
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const token = readCookie(request.headers.cookie, SESSION_COOKIE);
    if (token) await this.authService.logout(token);
    response.clearCookie(SESSION_COOKIE, cookieOptions());
  }
}

function setSessionCookie(response: Response, session: CreatedSession): void {
  response.cookie(SESSION_COOKIE, session.token, {
    ...cookieOptions(),
    expires: session.expiresAt,
  });
}

function cookieOptions() {
  const secure = process.env.NODE_ENV === "production";
  const domain = process.env.COOKIE_DOMAIN?.trim() || undefined;
  // The web client and API are separate origins on different ports. Browsers
  // treat those as the same site, so `lax` is enough and keeps CSRF protection.
  // `none` is only for an API on a different SITE, and must be `secure`.
  const crossSite = process.env.COOKIE_SAME_SITE?.trim().toLowerCase() === "none";
  if (crossSite && !secure) {
    throw new Error("COOKIE_SAME_SITE=none requires production HTTPS (secure cookie).");
  }
  return {
    httpOnly: true,
    secure,
    domain,
    // The web client and API are separate origins (e.g. :3000 and :4000), which
    // browsers treat as cross-site. `strict` would drop the session cookie on
    // every API call. `lax` keeps CSRF protection for cross-site POSTs while
    // allowing the credentialed same-site-by-scheme requests this app makes.
    // Production must be HTTPS, where `secure` is enforced.
    sameSite: crossSite ? ("none" as const) : ("lax" as const),
    path: "/",
  };
}



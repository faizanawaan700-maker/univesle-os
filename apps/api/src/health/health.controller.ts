import { Controller, Get, HttpCode, Res } from "@nestjs/common";
import type { Response } from "express";
import { database } from "@ubos/database";
import { Public } from "../auth/public.decorator";

/**
 * Operational probes (Phase 9). Both are public and expose no business data:
 * liveness proves the process is up, readiness proves the database is reachable.
 */
@Controller("health")
export class HealthController {
  @Public()
  @Get("live")
  live() {
    return { status: "ok", uptimeSeconds: Math.round(process.uptime()) };
  }

  @Public()
  @Get("ready")
  @HttpCode(200)
  async ready(@Res({ passthrough: true }) response: Response) {
    try {
      await database.$queryRaw`SELECT 1`;
      return { status: "ready", database: "up" };
    } catch {
      response.status(503);
      return { status: "not_ready", database: "down" };
    }
  }
}

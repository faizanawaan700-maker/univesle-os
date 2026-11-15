import type { NextFunction, Request, Response } from "express";
import { randomUUID } from "node:crypto";

const REQUEST_ID_HEADER = "x-request-id";
const SAFE_ID = /^[A-Za-z0-9._:-]{8,128}$/;

/**
 * Structured request log with a correlation ID (Phase 9).
 *
 * One JSON line per request: method, path, status, duration and request id.
 * Deliberately omitted: query strings, request bodies, cookies, session tokens,
 * headers and any financial values. Paths are logged without their query string
 * because filters can contain customer contact data.
 */
export function requestLogger(
  log: (line: string) => void = (line) => process.stdout.write(line + "\n"),
) {
  return function middleware(
    request: Request,
    response: Response,
    next: NextFunction,
  ): void {
    const incoming = request.header(REQUEST_ID_HEADER);
    const requestId =
      incoming && SAFE_ID.test(incoming) ? incoming : randomUUID();
    const startedAt = process.hrtime.bigint();
    response.setHeader(REQUEST_ID_HEADER, requestId);

    response.on("finish", () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      log(
        JSON.stringify({
          level:
            response.statusCode >= 500
              ? "error"
              : response.statusCode >= 400
                ? "warn"
                : "info",
          type: "http_request",
          requestId,
          method: request.method,
          path: request.path,
          status: response.statusCode,
          durationMs: Math.round(durationMs * 100) / 100,
          timestamp: new Date().toISOString(),
        }),
      );
    });

    next();
  };
}

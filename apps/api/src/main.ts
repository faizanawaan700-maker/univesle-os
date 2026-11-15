import "./load-local-env";
import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import helmet from "helmet";

import { database } from "@ubos/database";
import { AppModule } from "./app.module";
import { normalizeOrigin } from "./common/origin";
import { requestLogger } from "./common/request-log";
import { parseTrustProxyHops } from "./common/trust-proxy";

async function bootstrap(): Promise<void> {
  const port = Number(process.env.API_PORT ?? 4000);
  const host = process.env.API_HOST ?? "127.0.0.1";
  const frontendOrigin = normalizeOrigin(process.env.FRONTEND_ORIGIN);
  const cookieDomain = process.env.COOKIE_DOMAIN?.trim();
  const trustProxyHops = parseTrustProxyHops(process.env.TRUST_PROXY_HOPS);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("API_PORT must be a valid TCP port.");
  }

  if (cookieDomain && (cookieDomain.includes("/") || cookieDomain.includes(":") || cookieDomain.includes(" "))) {
    throw new Error("COOKIE_DOMAIN must be a hostname without a scheme or port.");
  }

  await database.$connect();
  const app = await NestFactory.create(AppModule);
  app.getHttpAdapter().getInstance().set("trust proxy", trustProxyHops);
  // Correlation ids plus one sanitized JSON line per request. Nothing sensitive
  // is logged: no query strings, bodies, cookies, tokens or financial values.
  app.use(requestLogger());
  app.use(helmet());
  app.enableCors({
    origin: frontendOrigin,
    credentials: true,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "X-Organization-Id", "Idempotency-Key"],
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Liveness and readiness endpoints for orchestrators and load balancers.
  // Readiness reports the database connection; neither endpoint exposes data.


  // Bounded shutdown: stop accepting connections, then close the pool.
  app.enableShutdownHooks();
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
  let closing = false;
  async function shutdown(signal: string): Promise<void> {
    if (closing) return;
    closing = true;
    process.stderr.write(`Received ${signal}; shutting down.\n`);
    const timer = setTimeout(() => process.exit(1), 15_000);
    try {
      await app.close();
      await database.$disconnect();
      clearTimeout(timer);
      process.exit(0);
    } catch {
      clearTimeout(timer);
      process.exit(1);
    }
  }

  await app.listen(port, host);
}

void bootstrap();

import { Injectable, Logger } from "@nestjs/common";
import { Prisma, database } from "@ubos/database";
import { createHmac } from "node:crypto";
import type { OrganizationContext } from "../common/http-context";
import { runTransaction } from "../common/transactions";

/** A delivery attempt outcome; adapters never throw, they report. */
export type DeliveryResult = { ok: true } | { ok: false; error: string };

/**
 * Provider adapter boundary. Implementations are registered per provider name;
 * with no adapter (or no endpoint URL) configured, deliveries are retained as
 * PENDING rather than silently discarded, so nothing is lost while a provider
 * decision is outstanding.
 */
export interface OutboundAdapter {
  readonly provider: string;
  deliver(event: {
    eventType: string;
    payload: Prisma.JsonValue;
    idempotencyKey: string;
    organizationId: string;
  }): Promise<DeliveryResult>;
}

/** Delivers to any HTTP endpoint that accepts a signed JSON POST. */
export class HttpWebhookAdapter implements OutboundAdapter {
  constructor(
    readonly provider: string,
    private readonly targetUrl: string,
    private readonly secret: string,
  ) {}

  async deliver(event: {
    eventType: string;
    payload: Prisma.JsonValue;
    idempotencyKey: string;
    organizationId: string;
  }): Promise<DeliveryResult> {
    const body = JSON.stringify({
      type: event.eventType,
      organizationId: event.organizationId,
      idempotencyKey: event.idempotencyKey,
      data: event.payload,
    });
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = createHmac("sha256", this.secret)
      .update(`${timestamp}.${body}`)
      .digest("hex");
    try {
      const response = await fetch(this.targetUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-ubos-event": event.eventType,
          "x-ubos-idempotency-key": event.idempotencyKey,
          "x-ubos-timestamp": timestamp,
          "x-ubos-signature": `sha256=${signature}`,
        },
        body,
        signal: AbortSignal.timeout(10_000),
      });
      if (response.status >= 200 && response.status < 300) return { ok: true };
      return { ok: false, error: `HTTP ${response.status}` };
    } catch (error) {
      return { ok: false, error: (error as Error).message.slice(0, 500) };
    }
  }
}

const MAX_ATTEMPTS = 8;

@Injectable()
export class OutboundService {
  private readonly logger = new Logger(OutboundService.name);
  private adapters: OutboundAdapter[] = [];

  /**
   * Outbound delivery is configuration-driven, so there are no constructor
   * dependencies. Declaring the empty constructor also keeps this class from
   * emitting orphaned decorator metadata, which previously left Nest unable to
   * resolve OperationsService's dependencies at startup.
   */
  constructor() {}

  /** Adapters are registered by configuration, not by the DI container. */
  configure(adapters: OutboundAdapter[]): void {
    this.adapters = adapters;
  }

  /**
   * Enqueues an outbound event. Must be called inside the business transaction so
   * the outbox row commits or rolls back with the change that produced it.
   */
  async enqueue(
    tx: Prisma.TransactionClient,
    input: {
      organizationId: string;
      provider: string;
      eventType: string;
      idempotencyKey: string;
      payload: Prisma.InputJsonValue;
    },
  ) {
    return tx.outboundEvent.upsert({
      where: {
        organizationId_provider_idempotencyKey: {
          organizationId: input.organizationId,
          provider: input.provider,
          idempotencyKey: input.idempotencyKey,
        },
      },
      create: input,
      update: {},
      select: { id: true, status: true },
    });
  }

  async list(org: OrganizationContext, status?: string) {
    return database.outboundEvent.findMany({
      where: { organizationId: org.id, ...(status ? { status } : {}) },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        provider: true,
        eventType: true,
        idempotencyKey: true,
        status: true,
        attempts: true,
        lastError: true,
        nextAttemptAt: true,
        deliveredAt: true,
        createdAt: true,
      },
    });
  }

  /**
   * Delivers due events with exponential backoff. Safe to run repeatedly and from
   * more than one instance because each row is claimed by a status transition.
   */
  async dispatchDue(now = new Date()) {
    const due = await database.outboundEvent.findMany({
      where: { status: "PENDING", nextAttemptAt: { lte: now } },
      orderBy: { nextAttemptAt: "asc" },
      take: 50,
    });
    const summary = {
      attempted: 0,
      delivered: 0,
      failed: 0,
      dead: 0,
      skipped: 0,
    };
    for (const event of due) {
      const adapter = this.adapters.find(
        (candidate) => candidate.provider === event.provider,
      );
      if (!adapter) {
        summary.skipped += 1;
        continue;
      }
      const claimed = await database.outboundEvent.updateMany({
        where: { id: event.id, status: "PENDING" },
        data: { attempts: { increment: 1 } },
      });
      if (claimed.count === 0) continue;
      summary.attempted += 1;

      const result = await adapter.deliver({
        eventType: event.eventType,
        payload: event.payload,
        idempotencyKey: event.idempotencyKey,
        organizationId: event.organizationId,
      });
      if (result.ok) {
        await database.outboundEvent.update({
          where: { id: event.id },
          data: {
            status: "DELIVERED",
            deliveredAt: new Date(),
            lastError: null,
          },
        });
        summary.delivered += 1;
        continue;
      }

      const attempts = event.attempts + 1;
      const dead = attempts >= MAX_ATTEMPTS;
      // 30s, 1m, 2m, 4m, ... capped at one hour.
      const delayMs = Math.min(30_000 * 2 ** (attempts - 1), 3_600_000);
      await database.outboundEvent.update({
        where: { id: event.id },
        data: {
          status: dead ? "DEAD" : "PENDING",
          lastError: result.error.slice(0, 500),
          nextAttemptAt: new Date(Date.now() + delayMs),
        },
      });
      if (dead) summary.dead += 1;
      else summary.failed += 1;
    }
    if (summary.attempted > 0) {
      this.logger.log(
        JSON.stringify({ type: "outbound_dispatch", ...summary }),
      );
    }
    return summary;
  }

  /** Requeues a DEAD event for another delivery attempt. */
  async requeue(eventId: string, org: OrganizationContext) {
    return runTransaction(async (tx) => {
      const updated = await tx.outboundEvent.updateMany({
        where: {
          id: eventId,
          organizationId: org.id,
          status: { in: ["DEAD", "FAILED"] },
        },
        data: {
          status: "PENDING",
          attempts: 0,
          lastError: null,
          nextAttemptAt: new Date(),
        },
      });
      return { requeued: updated.count === 1 };
    });
  }
}

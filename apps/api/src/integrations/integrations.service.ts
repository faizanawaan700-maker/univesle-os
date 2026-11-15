import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Prisma, database } from "@ubos/database";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { OrganizationContext } from "../common/http-context";
import { runTransaction } from "../common/transactions";
import { IngestEventDto, UpdateSettingsDto } from "./integrations.dto";

const MAX_SKEW_SECONDS = 300;

/**
 * Integrations (Phase 8).
 *
 * The provider is intentionally not hardcoded: each organization registers a
 * webhook secret per provider, and inbound events are verified before storage.
 * Replay defense is the durable `(organization, provider, eventId)` unique key,
 * so a provider retrying a delivery produces one stored event.
 *
 * Outbound delivery is not implemented because no provider, gateway or
 * messaging target has been approved; see `.planning/PHASE8_DECISIONS.md`.
 */
@Injectable()
export class IntegrationsService {
  /**
   * Verifies an HMAC-SHA256 signature over `${timestamp}.${rawBody}` and rejects
   * stale timestamps. Comparison is constant-time.
   */
  verifySignature(input: {
    secret: string | undefined;
    signature: string | undefined;
    timestamp: string | undefined;
    rawBody: string;
  }): void {
    if (!input.secret) {
      throw new ForbiddenException(
        "No webhook secret is configured for this provider.",
      );
    }
    if (!input.signature || !input.timestamp) {
      throw new UnauthorizedException("Missing webhook signature headers.");
    }
    const timestampSeconds = Number(input.timestamp);
    if (!Number.isInteger(timestampSeconds)) {
      throw new UnauthorizedException("Invalid webhook timestamp.");
    }
    const skew = Math.abs(Math.floor(Date.now() / 1000) - timestampSeconds);
    if (skew > MAX_SKEW_SECONDS) {
      throw new UnauthorizedException(
        "Webhook timestamp is outside the allowed window.",
      );
    }
    const expected = createHmac("sha256", input.secret)
      .update(`${input.timestamp}.${input.rawBody}`)
      .digest("hex");
    const provided = input.signature.replace(/^sha256=/, "");
    const expectedBuffer = Buffer.from(expected, "utf8");
    const providedBuffer = Buffer.from(provided, "utf8");
    if (
      expectedBuffer.length !== providedBuffer.length ||
      !timingSafeEqual(expectedBuffer, providedBuffer)
    ) {
      throw new UnauthorizedException("Webhook signature is invalid.");
    }
  }

  /**
   * Creates or rotates the organization's webhook secret for a provider. The
   * secret is returned once; only its digest is persisted.
   */
  async setWebhookSecret(provider: string, org: OrganizationContext, actorId: string) {
    const secret = randomBytes(24).toString("base64url");
    return runTransaction(async (tx) => {
      await tx.webhookEndpoint.upsert({
        where: { organizationId_provider: { organizationId: org.id, provider } },
        create: { organizationId: org.id, provider, secret },
        update: { secret, isActive: true, rotatedAt: new Date() },
      });
      await tx.auditLog.create({
        data: {
          organizationId: org.id,
          actorId,
          action: "integration.webhook_secret_set",
          entityType: "webhook_endpoint",
          entityId: provider,
        },
      });
      return { provider, secret };
    });
  }

  /**
   * Public wrapper used by the controller. If neither a per-organization secret
   * nor a process-level secret exists, verification fails closed.
   */
  async getVerifiedSecret(provider: string, org: OrganizationContext): Promise<string | undefined> {
    const stored = await this.resolveSecret(provider, org);
    if (stored) return stored;
    return process.env[`INTEGRATION_WEBHOOK_SECRET_${provider.toUpperCase().replace(/-/g, "_")}`];
  }

  private async resolveSecret(provider: string, org: OrganizationContext): Promise<string | undefined> {
    // NOTE: HMAC verification needs the original secret, so the stored value is
    // the secret itself (already high-entropy and generated server-side), not a
    // digest. It is never returned by any read endpoint.
    const endpoint = await database.webhookEndpoint.findUnique({
      where: { organizationId_provider: { organizationId: org.id, provider } },
      select: { secret: true, isActive: true },
    });
    return endpoint?.isActive ? endpoint.secret : undefined;
  }

  /** Stores a verified event exactly once; a duplicate delivery is acknowledged. */
  async ingest(
    provider: string,
    input: IngestEventDto,
    org: OrganizationContext,
    rawBody: string,
    signature: string,
  ) {
    let payload: Prisma.InputJsonValue;
    try {
      payload = JSON.parse(input.payload) as Prisma.InputJsonValue;
    } catch {
      throw new BadRequestException("Webhook payload must be valid JSON.");
    }
    const signatureHash = createHmac("sha256", org.id).update(signature).digest("hex");
    try {
      return await runTransaction(async (tx) => {
        const existing = await tx.integrationEvent.findUnique({
          where: {
            organizationId_provider_eventId: {
              organizationId: org.id,
              provider,
              eventId: input.eventId,
            },
          },
          select: { id: true, status: true },
        });
        if (existing)
          return { id: existing.id, status: existing.status, duplicate: true };

        const event = await tx.integrationEvent.create({
          data: {
            organizationId: org.id,
            provider,
            eventId: input.eventId,
            eventType: input.eventType,
            payload,
            signatureHash,
          },
          select: { id: true, status: true },
        });
        await tx.auditLog.create({
          data: {
            organizationId: org.id,
            action: "integration.event_received",
            entityType: "integration_event",
            entityId: event.id,
            metadata: {
              provider,
              eventType: input.eventType,
              eventId: input.eventId,
            },
          },
        });
        return { id: event.id, status: event.status, duplicate: false };
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new ConflictException("This event was already received.");
      }
      throw error;
    }
  }

  async listEvents(org: OrganizationContext, provider?: string) {
    const events = await database.integrationEvent.findMany({
      where: { organizationId: org.id, ...(provider ? { provider } : {}) },
      orderBy: { receivedAt: "desc" },
      take: 100,
      select: {
        id: true,
        provider: true,
        eventId: true,
        eventType: true,
        status: true,
        attempts: true,
        lastError: true,
        receivedAt: true,
        processedAt: true,
      },
    });
    return { items: events, total: events.length };
  }

  /**
   * Marks a stored event processed. Processing is deliberately manual: no
   * business write is inferred from a provider payload until a provider contract
   * is approved, so an unknown event cannot silently mutate invoices.
   */
  async markProcessed(
    eventId: string,
    org: OrganizationContext,
    actorId: string,
  ) {
    return runTransaction(async (tx) => {
      const event = await tx.integrationEvent.findFirst({
        where: { id: eventId, organizationId: org.id },
        select: { id: true, status: true },
      });
      if (!event) throw new BadRequestException("Event was not found.");
      const updated = await tx.integrationEvent.update({
        where: { id: eventId },
        data: {
          status: "PROCESSED",
          processedAt: new Date(),
          attempts: { increment: 1 },
        },
        select: { id: true, status: true },
      });
      await tx.auditLog.create({
        data: {
          organizationId: org.id,
          actorId,
          action: "integration.event_processed",
          entityType: "integration_event",
          entityId: eventId,
        },
      });
      return updated;
    });
  }

  // ---------------------------------------------------------------------------
  // Localization settings
  // ---------------------------------------------------------------------------

  async getSettings(org: OrganizationContext) {
    const settings = await database.organizationSettings.findUnique({
      where: { organizationId: org.id },
      select: {
        locale: true,
        timeZone: true,
        currencyCode: true,
        currencyDisplay: true,
        updatedAt: true,
      },
    });
    return (
      settings ?? {
        locale: "en-US",
        timeZone: "UTC",
        currencyCode: "USD",
        currencyDisplay: "symbol",
        updatedAt: null,
      }
    );
  }

  async updateSettings(
    input: UpdateSettingsDto,
    org: OrganizationContext,
    actorId: string,
  ) {
    if (input.timeZone && !this.isValidTimeZone(input.timeZone)) {
      throw new BadRequestException("Unknown time zone.");
    }
    if (input.locale && !this.isValidLocale(input.locale)) {
      throw new BadRequestException("Unknown locale.");
    }
    return runTransaction(async (tx) => {
      const settings = await tx.organizationSettings.upsert({
        where: { organizationId: org.id },
        create: {
          organizationId: org.id,
          locale: input.locale ?? "en-US",
          timeZone: input.timeZone ?? "UTC",
          currencyCode: input.currencyCode ?? "USD",
          currencyDisplay: input.currencyDisplay ?? "symbol",
        },
        update: {
          ...(input.locale !== undefined ? { locale: input.locale } : {}),
          ...(input.timeZone !== undefined ? { timeZone: input.timeZone } : {}),
          ...(input.currencyCode !== undefined
            ? { currencyCode: input.currencyCode }
            : {}),
          ...(input.currencyDisplay !== undefined
            ? { currencyDisplay: input.currencyDisplay }
            : {}),
        },
      });
      await tx.auditLog.create({
        data: {
          organizationId: org.id,
          actorId,
          action: "organization.settings_updated",
          entityType: "organization_settings",
          entityId: org.id,
          metadata: {
            locale: settings.locale,
            timeZone: settings.timeZone,
            currencyCode: settings.currencyCode,
          },
        },
      });
      return settings;
    });
  }

  private isValidTimeZone(value: string): boolean {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }

  private isValidLocale(value: string): boolean {
    try {
      return Intl.DateTimeFormat.supportedLocalesOf([value]).length > 0;
    } catch {
      return false;
    }
  }
}

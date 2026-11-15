-- Phase 8: transactional outbox for outbound integration deliveries.
-- Additive only: one new table with its indexes and foreign key. Nothing
-- existing is altered, dropped or rewritten.

CREATE TABLE "OutboundEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "provider" VARCHAR(60) NOT NULL,
    "eventType" VARCHAR(120) NOT NULL,
    "idempotencyKey" VARCHAR(120) NOT NULL,
    "payload" JSONB NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" VARCHAR(500),
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutboundEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OutboundEvent_organizationId_provider_idempotencyKey_key"
    ON "OutboundEvent"("organizationId", "provider", "idempotencyKey");
CREATE INDEX "OutboundEvent_status_nextAttemptAt_idx" ON "OutboundEvent"("status", "nextAttemptAt");
CREATE INDEX "OutboundEvent_organizationId_createdAt_idx" ON "OutboundEvent"("organizationId", "createdAt");

ALTER TABLE "OutboundEvent" ADD CONSTRAINT "OutboundEvent_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

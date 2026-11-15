-- Phase 8: per-organization webhook secrets.
-- Additive only: creates one new table and its indexes/foreign key. No existing
-- table, column or row is altered, dropped or rewritten.

-- CreateTable
CREATE TABLE "WebhookEndpoint" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "provider" VARCHAR(60) NOT NULL,
    "secretHash" CHAR(64) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rotatedAt" TIMESTAMP(3),

    CONSTRAINT "WebhookEndpoint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WebhookEndpoint_provider_idx" ON "WebhookEndpoint"("provider");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEndpoint_organizationId_provider_key" ON "WebhookEndpoint"("organizationId", "provider");

-- AddForeignKey
ALTER TABLE "WebhookEndpoint" ADD CONSTRAINT "WebhookEndpoint_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

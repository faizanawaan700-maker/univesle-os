-- CreateTable
CREATE TABLE "IntegrationEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "provider" VARCHAR(60) NOT NULL,
    "eventId" VARCHAR(120) NOT NULL,
    "eventType" VARCHAR(120) NOT NULL,
    "payload" JSONB NOT NULL,
    "signatureHash" CHAR(64) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'RECEIVED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" VARCHAR(500),
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "IntegrationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganizationSettings" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "locale" VARCHAR(20) NOT NULL DEFAULT 'en-US',
    "timeZone" VARCHAR(60) NOT NULL DEFAULT 'UTC',
    "currencyCode" CHAR(3) NOT NULL DEFAULT 'USD',
    "currencyDisplay" VARCHAR(20) NOT NULL DEFAULT 'symbol',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IntegrationEvent_organizationId_receivedAt_idx" ON "IntegrationEvent"("organizationId", "receivedAt");

-- CreateIndex
CREATE INDEX "IntegrationEvent_organizationId_status_idx" ON "IntegrationEvent"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationEvent_organizationId_provider_eventId_key" ON "IntegrationEvent"("organizationId", "provider", "eventId");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationSettings_organizationId_key" ON "OrganizationSettings"("organizationId");

-- CreateIndex
CREATE INDEX "OrganizationSettings_organizationId_idx" ON "OrganizationSettings"("organizationId");

-- AddForeignKey
ALTER TABLE "IntegrationEvent" ADD CONSTRAINT "IntegrationEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationSettings" ADD CONSTRAINT "OrganizationSettings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;


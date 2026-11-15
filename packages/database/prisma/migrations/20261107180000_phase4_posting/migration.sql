-- Phase 4: accrual posting support (OPS-08 policies approved 2026-11-08).
-- Additive only: one new table plus two nullable columns on each of Sale and
-- PurchaseInvoice. No existing value is altered, dropped or rewritten.

CREATE TABLE "AccountingPeriod" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'OPEN',
    "closedAt" TIMESTAMP(3),
    "closedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountingPeriod_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AccountingPeriod_organizationId_id_key" ON "AccountingPeriod"("organizationId", "id");
CREATE UNIQUE INDEX "AccountingPeriod_organizationId_startDate_endDate_key"
    ON "AccountingPeriod"("organizationId", "startDate", "endDate");
CREATE INDEX "AccountingPeriod_organizationId_status_idx" ON "AccountingPeriod"("organizationId", "status");

ALTER TABLE "AccountingPeriod" ADD CONSTRAINT "AccountingPeriod_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AccountingPeriod" ADD CONSTRAINT "AccountingPeriod_closedById_fkey"
    FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Sale" ADD COLUMN "voidedAt" TIMESTAMP(3);
ALTER TABLE "Sale" ADD COLUMN "voidedById" TEXT;
ALTER TABLE "PurchaseInvoice" ADD COLUMN "voidedAt" TIMESTAMP(3);
ALTER TABLE "PurchaseInvoice" ADD COLUMN "voidedById" TEXT;

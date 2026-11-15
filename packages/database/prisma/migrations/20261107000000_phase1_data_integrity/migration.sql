-- Phase 1 additive constraints and durable API idempotency storage.
-- Preflight before rollout (run only against an authorized isolated database):
-- SELECT p."id" FROM "Payment" p WHERE (p."saleId" IS NULL) = (p."purchaseInvoiceId" IS NULL);
-- Tenant relationship preflight remains documented in .planning/UBOS_DATABASE_EVOLUTION_PLAN.md.

CREATE TABLE "IdempotencyRecord" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "operation" VARCHAR(100) NOT NULL,
    "keyHash" CHAR(64) NOT NULL,
    "requestHash" CHAR(64) NOT NULL,
    "responseStatus" INTEGER,
    "responseBody" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "IdempotencyRecord_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "IdempotencyRecord_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "IdempotencyRecord_scope_key_key"
    ON "IdempotencyRecord"("organizationId", "actorId", "operation", "keyHash");
CREATE INDEX "IdempotencyRecord_createdAt_idx"
    ON "IdempotencyRecord"("createdAt");

-- NOT VALID avoids blocking installation on pre-existing malformed rows while
-- enforcing the invariant on new or updated payments. Validate only after the
-- preflight query above returns no rows on the target database.
ALTER TABLE "Payment"
    ADD CONSTRAINT "Payment_exactly_one_target_check"
    CHECK (("saleId" IS NULL) <> ("purchaseInvoiceId" IS NULL)) NOT VALID;

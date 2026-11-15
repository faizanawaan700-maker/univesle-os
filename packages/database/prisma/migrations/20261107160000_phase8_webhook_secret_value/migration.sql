-- Phase 8 follow-up: HMAC verification requires the original webhook secret,
-- not a digest of it. The table was introduced in the previous migration and
-- contains no business data, but the change is expressed as an explicit rename
-- so existing rows (if any) are preserved rather than dropped.
ALTER TABLE "WebhookEndpoint" RENAME COLUMN "secretHash" TO "secret";
ALTER TABLE "WebhookEndpoint" ALTER COLUMN "secret" TYPE VARCHAR(128);

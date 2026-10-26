-- Distinguish complimentary (comped) subscriptions from real paying ones.
-- Additive and idempotent: safe to re-run.
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "source" TEXT NOT NULL DEFAULT 'store';
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "grantedByAdminId" TEXT;
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "grantReason" TEXT;

-- Backfill: the only reliably identifiable comped rows are those created by
-- admin manual activation, which stamp purchaseToken 'admin-activated-<ts>'.
-- Everything else stays 'store' (no guessing). grantedByAdminId / grantReason
-- are NOT backfilled: they only live in activity_logs.details JSON.
UPDATE "subscriptions" SET "source" = 'admin_grant' WHERE "purchaseToken" LIKE 'admin-activated-%' AND "source" = 'store';

CREATE INDEX IF NOT EXISTS "subscriptions_source_status_idx" ON "subscriptions"("source", "status");

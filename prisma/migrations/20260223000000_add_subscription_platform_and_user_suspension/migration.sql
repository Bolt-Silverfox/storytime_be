-- AlterTable: Add platform tracking fields to subscriptions
-- NOTE: These columns are also added by 20260215200000_add_subscription_platform_fields.
-- Use IF NOT EXISTS so a fresh deploy (where the earlier migration already added them)
-- does not fail with 42701, while environments missing them are still backfilled.
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "platform" TEXT;
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "productId" TEXT;
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "purchaseToken" TEXT;

-- AlterTable: Add suspension fields to users
-- NOTE: These columns are also added by 20260216120000_add_user_suspension_fields.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "isSuspended" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "suspendedAt" TIMESTAMP(3);

-- DropIndex: Remove redundant token index (token already has unique constraint)
DROP INDEX IF EXISTS "device_tokens_token_idx";

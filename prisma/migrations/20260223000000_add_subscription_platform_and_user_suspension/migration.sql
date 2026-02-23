-- AlterTable: Add platform tracking fields to subscriptions
ALTER TABLE "subscriptions" ADD COLUMN "platform" TEXT;
ALTER TABLE "subscriptions" ADD COLUMN "productId" TEXT;
ALTER TABLE "subscriptions" ADD COLUMN "purchaseToken" TEXT;

-- AlterTable: Add suspension fields to users
ALTER TABLE "users" ADD COLUMN "isSuspended" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN "suspendedAt" TIMESTAMP(3);

-- DropIndex: Remove redundant token index (token already has unique constraint)
DROP INDEX IF EXISTS "device_tokens_token_idx";

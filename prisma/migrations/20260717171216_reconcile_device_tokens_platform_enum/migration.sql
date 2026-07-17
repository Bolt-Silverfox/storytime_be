-- Reconcile device_tokens with the Prisma schema:
--   1. the DevicePlatform enum was never created by any migration
--   2. device_tokens.platform was TEXT but the schema declares it DevicePlatform
--   3. the lastUsed column was missing
-- The platform conversion is done IN PLACE with a USING cast so existing rows
-- (push tokens) are preserved. Existing values are already 'ios' | 'android' |
-- 'web', which match the enum labels. (Prisma's auto-generated DROP/ADD would
-- have destroyed data and failed on a non-empty table.)

-- CreateEnum
CREATE TYPE "DevicePlatform" AS ENUM ('ios', 'android', 'web');

-- AlterTable: convert platform TEXT -> DevicePlatform without dropping data
ALTER TABLE "device_tokens"
  ALTER COLUMN "platform" TYPE "DevicePlatform" USING ("platform"::"DevicePlatform");

-- AlterTable: add the missing lastUsed column
ALTER TABLE "device_tokens"
  ADD COLUMN IF NOT EXISTS "lastUsed" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

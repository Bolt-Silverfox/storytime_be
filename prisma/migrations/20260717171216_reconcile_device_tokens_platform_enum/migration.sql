-- Reconcile device_tokens with the Prisma schema:
--   1. the DevicePlatform enum was never created by any migration
--   2. device_tokens.platform was TEXT but the schema declares it DevicePlatform
--   3. the lastUsed column was missing
-- The platform conversion is done IN PLACE with a USING cast so existing rows
-- (push tokens) are preserved. Existing values are already 'ios' | 'android' |
-- 'web', which match the enum labels. (Prisma's auto-generated DROP/ADD would
-- have destroyed data and failed on a non-empty table.)

-- CreateEnum (guarded: idempotent on DBs where the type already exists)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DevicePlatform') THEN
    CREATE TYPE "DevicePlatform" AS ENUM ('ios', 'android', 'web');
  END IF;
END $$;

-- AlterTable: convert platform TEXT -> DevicePlatform without dropping data.
-- Guarded so re-runs (or DBs already converted) are a no-op.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'device_tokens'
      AND column_name = 'platform'
      AND udt_name <> 'DevicePlatform'
  ) THEN
    ALTER TABLE "device_tokens"
      ALTER COLUMN "platform" TYPE "DevicePlatform" USING ("platform"::"DevicePlatform");
  END IF;
END $$;

-- AlterTable: add the missing lastUsed column
ALTER TABLE "device_tokens"
  ADD COLUMN IF NOT EXISTS "lastUsed" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

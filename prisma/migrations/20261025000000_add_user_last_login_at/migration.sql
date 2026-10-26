-- AlterTable: nullable last-login timestamp (metadata-only, no table rewrite). No backfill:
-- sessions are deleted on logout so max(sessions.createdAt) would be a misleading lower bound.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "lastLoginAt" TIMESTAMP(3);

-- CreateIndex: admin user list sorts by lastLoginAt
CREATE INDEX IF NOT EXISTS "users_lastLoginAt_idx" ON "users"("lastLoginAt");

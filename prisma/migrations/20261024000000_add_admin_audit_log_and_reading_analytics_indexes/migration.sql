-- CreateTable: admin audit log (who performed a sensitive admin action)
CREATE TABLE "admin_audit_logs" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "adminName" TEXT NOT NULL,
    "adminEmail" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "details" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "admin_audit_logs_adminId_createdAt_idx" ON "admin_audit_logs"("adminId", "createdAt");

CREATE INDEX "admin_audit_logs_action_createdAt_idx" ON "admin_audit_logs"("action", "createdAt");

CREATE INDEX "admin_audit_logs_targetType_targetId_idx" ON "admin_audit_logs"("targetType", "targetId");

-- AlterTable: cover the admin reading-analytics cross-story scan (no kidId/
-- userId predicate), which is now widened to a 365-day window.
CREATE INDEX "story_progress_isDeleted_lastAccessed_idx" ON "story_progress"("isDeleted", "lastAccessed");

CREATE INDEX "user_story_progress_isDeleted_lastAccessed_idx" ON "user_story_progress"("isDeleted", "lastAccessed");

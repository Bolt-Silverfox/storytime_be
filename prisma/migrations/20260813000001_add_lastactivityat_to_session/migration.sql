-- AlterTable: add nullable last-activity timestamp (metadata-only, no rewrite).
ALTER TABLE "sessions" ADD COLUMN "lastActivityAt" TIMESTAMP(3);

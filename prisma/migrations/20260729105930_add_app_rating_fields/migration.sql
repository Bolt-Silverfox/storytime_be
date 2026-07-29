-- AlterTable: add per-user app-rating state
ALTER TABLE "users" ADD COLUMN "hasRatedApp" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN "rateAppDismissedAt" TIMESTAMP(3);

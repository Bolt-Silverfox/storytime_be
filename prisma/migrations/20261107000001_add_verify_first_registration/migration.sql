-- AlterTable
ALTER TABLE "tokens" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "users" ADD COLUMN "verifyFirstRegisteredAt" TIMESTAMP(3);

-- Additive: wrong-guess count on a one-time code, so the code is refused once the guess budget is spent.
-- Rollback: ALTER TABLE "tokens" DROP COLUMN "failedAttempts";
-- AlterTable
ALTER TABLE "tokens" ADD COLUMN "failedAttempts" INTEGER NOT NULL DEFAULT 0;

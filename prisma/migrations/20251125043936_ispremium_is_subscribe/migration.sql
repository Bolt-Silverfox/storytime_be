-- AlterTable
ALTER TABLE "stories" ADD COLUMN     "isPremium" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "isSubscribed" BOOLEAN NOT NULL DEFAULT false;

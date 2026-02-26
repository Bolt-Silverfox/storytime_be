-- AlterTable
ALTER TABLE "kids" ADD COLUMN     "bedtimeDimScreen" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "bedtimeLockApp" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "bedtimeReminder" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "bedtimeStoriesOnly" BOOLEAN NOT NULL DEFAULT false;

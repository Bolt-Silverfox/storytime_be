/*
  Warnings:

  - You are about to drop the column `type` on the `notifications` table. All the data in the column will be lost.
  - Added the required column `category` to the `notifications` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "NotificationCategory" AS ENUM ('EMAIL_VERIFICATION', 'PASSWORD_RESET', 'PASSWORD_RESET_ALERT', 'PASSWORD_CHANGED', 'PIN_RESET', 'NEW_LOGIN', 'NEW_STORY', 'STORY_FINISHED', 'STORY_RECOMMENDATION', 'WE_MISS_YOU', 'ACHIEVEMENT_UNLOCKED', 'BADGE_EARNED', 'STREAK_MILESTONE', 'DAILY_CHALLENGE_REMINDER', 'SCREEN_TIME_LIMIT', 'BEDTIME_REMINDER', 'WEEKLY_REPORT', 'SYSTEM_ALERT', 'SUBSCRIPTION_ALERT', 'PAYMENT_SUCCESS', 'PAYMENT_FAILED');

-- AlterTable
ALTER TABLE "notifications" DROP COLUMN "type",
ADD COLUMN     "category" "NotificationCategory" NOT NULL;

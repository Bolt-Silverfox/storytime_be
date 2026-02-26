/*
  Warnings:

  - A unique constraint covering the columns `[userId,category,type]` on the table `notification_preferences` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[kidId,category,type]` on the table `notification_preferences` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `category` to the `notification_preferences` table without a default value. This is not possible if the table is not empty.

*/
-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationCategory" ADD VALUE 'SUBSCRIPTION_REMINDER';
ALTER TYPE "NotificationCategory" ADD VALUE 'INCOMPLETE_STORY_REMINDER';
ALTER TYPE "NotificationCategory" ADD VALUE 'DAILY_LISTENING_REMINDER';

-- AlterTable
ALTER TABLE "notification_preferences" ADD COLUMN     "category" "NotificationCategory" NOT NULL;

-- AlterTable
ALTER TABLE "user_usages" ADD COLUMN     "geminiImageCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "geminiStoryCount" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE UNIQUE INDEX "notification_preferences_userId_category_type_key" ON "notification_preferences"("userId", "category", "type");

-- CreateIndex
CREATE UNIQUE INDEX "notification_preferences_kidId_category_type_key" ON "notification_preferences"("kidId", "category", "type");

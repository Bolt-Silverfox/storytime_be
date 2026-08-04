/*
  Warnings:

  - Changed the type of `type` on the `notification_preferences` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('email', 'push');

-- AlterTable
ALTER TABLE "notification_preferences" DROP COLUMN "type",
ADD COLUMN     "type" "NotificationType" NOT NULL,
ALTER COLUMN "enabled" DROP DEFAULT;

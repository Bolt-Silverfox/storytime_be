/*
  Warnings:

  - Changed the type of `type` on the `notification_preferences` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('email', 'push');

-- DropForeignKey
ALTER TABLE "voices" DROP CONSTRAINT "voices_userId_fkey";

-- AlterTable
ALTER TABLE "notification_preferences" DROP COLUMN "type",
ADD COLUMN     "type" "NotificationType" NOT NULL,
ALTER COLUMN "enabled" DROP DEFAULT;

-- AlterTable
ALTER TABLE "voices" ALTER COLUMN "userId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "voices" ADD CONSTRAINT "voices_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

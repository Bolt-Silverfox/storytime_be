/*
  Warnings:

  - A unique constraint covering the columns `[userId,kidId,badgeId]` on the table `user_badges` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "user_badges_userId_badgeId_key";

-- AlterTable
ALTER TABLE "user_badges" ADD COLUMN     "kidId" TEXT;

-- CreateIndex
CREATE INDEX "user_badges_kidId_idx" ON "user_badges"("kidId");

-- CreateIndex
CREATE UNIQUE INDEX "user_badges_userId_kidId_badgeId_key" ON "user_badges"("userId", "kidId", "badgeId");

-- AddForeignKey
ALTER TABLE "user_badges" ADD CONSTRAINT "user_badges_kidId_fkey" FOREIGN KEY ("kidId") REFERENCES "kids"("id") ON DELETE CASCADE ON UPDATE CASCADE;

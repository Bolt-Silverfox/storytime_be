/*
  Warnings:

  - You are about to drop the column `userId` on the `favorites` table. All the data in the column will be lost.
  - You are about to drop the column `userId` on the `story_progress` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[kidId,storyId]` on the table `story_progress` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `kidId` to the `favorites` table without a default value. This is not possible if the table is not empty.
  - Added the required column `kidId` to the `story_progress` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "story_progress_userId_storyId_key";

-- AlterTable
ALTER TABLE "favorites" DROP COLUMN "userId",
ADD COLUMN     "kidId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "story_progress" DROP COLUMN "userId",
ADD COLUMN     "kidId" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "story_progress_kidId_storyId_key" ON "story_progress"("kidId", "storyId");

-- AddForeignKey
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_kidId_fkey" FOREIGN KEY ("kidId") REFERENCES "kids"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "story_progress" ADD CONSTRAINT "story_progress_kidId_fkey" FOREIGN KEY ("kidId") REFERENCES "kids"("id") ON DELETE CASCADE ON UPDATE CASCADE;

/*
  Warnings:

  - A unique constraint covering the columns `[userId,storyId]` on the table `story_progress` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "story_progress_userId_storyId_key" ON "story_progress"("userId", "storyId");

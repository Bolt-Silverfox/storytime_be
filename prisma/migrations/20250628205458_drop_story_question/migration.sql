/*
  Warnings:

  - You are about to drop the `StoryQuestion` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "StoryQuestion" DROP CONSTRAINT "StoryQuestion_storyId_fkey";

-- DropTable
DROP TABLE "StoryQuestion";

-- CreateTable
CREATE TABLE "story_questions" (
    "id" TEXT NOT NULL,
    "storyId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "options" TEXT[],
    "answer" INTEGER NOT NULL,

    CONSTRAINT "story_questions_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "story_questions" ADD CONSTRAINT "story_questions_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "stories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

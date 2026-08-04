/*
  Warnings:

  - You are about to drop the column `answer` on the `story_questions` table. All the data in the column will be lost.
  - Added the required column `correctOption` to the `story_questions` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "kids" ADD COLUMN     "dailyScreenTimeLimitMins" INTEGER;

-- AlterTable
ALTER TABLE "story_questions" DROP COLUMN "answer",
ADD COLUMN     "correctOption" INTEGER NOT NULL;

-- CreateTable
CREATE TABLE "screen_time_sessions" (
    "id" TEXT NOT NULL,
    "kidId" TEXT NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endTime" TIMESTAMP(3),
    "duration" INTEGER,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "screen_time_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "question_answers" (
    "id" TEXT NOT NULL,
    "kidId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "storyId" TEXT NOT NULL,
    "selectedOption" INTEGER NOT NULL,
    "isCorrect" BOOLEAN NOT NULL,
    "answeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "question_answers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "screen_time_sessions_kidId_date_idx" ON "screen_time_sessions"("kidId", "date");

-- CreateIndex
CREATE INDEX "question_answers_kidId_idx" ON "question_answers"("kidId");

-- CreateIndex
CREATE INDEX "question_answers_kidId_answeredAt_idx" ON "question_answers"("kidId", "answeredAt");

-- AddForeignKey
ALTER TABLE "screen_time_sessions" ADD CONSTRAINT "screen_time_sessions_kidId_fkey" FOREIGN KEY ("kidId") REFERENCES "kids"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_answers" ADD CONSTRAINT "question_answers_kidId_fkey" FOREIGN KEY ("kidId") REFERENCES "kids"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_answers" ADD CONSTRAINT "question_answers_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "story_questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

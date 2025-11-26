-- AlterTable
ALTER TABLE "kids" ADD COLUMN     "currentReadingLevel" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "stories" ADD COLUMN     "difficultyLevel" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "wordCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "story_progress" ADD COLUMN     "totalTimeSpent" INTEGER NOT NULL DEFAULT 0;

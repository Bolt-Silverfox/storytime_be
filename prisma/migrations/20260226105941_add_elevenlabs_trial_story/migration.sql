-- AlterTable
ALTER TABLE "user_usages" ADD COLUMN     "elevenLabsTrialStoryId" TEXT;

-- AddForeignKey
ALTER TABLE "user_usages" ADD CONSTRAINT "user_usages_elevenLabsTrialStoryId_fkey" FOREIGN KEY ("elevenLabsTrialStoryId") REFERENCES "stories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

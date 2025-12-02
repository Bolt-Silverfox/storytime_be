/*
  Warnings:

  - You are about to drop the column `ageRange` on the `kids` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "kids" DROP COLUMN "ageRange",
ADD COLUMN     "ageGroupId" TEXT;

-- AlterTable
ALTER TABLE "stories" ADD COLUMN     "ageGroupId" TEXT;

-- AddForeignKey
ALTER TABLE "kids" ADD CONSTRAINT "kids_ageGroupId_fkey" FOREIGN KEY ("ageGroupId") REFERENCES "age_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stories" ADD CONSTRAINT "stories_ageGroupId_fkey" FOREIGN KEY ("ageGroupId") REFERENCES "age_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

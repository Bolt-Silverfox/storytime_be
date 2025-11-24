/*
  Warnings:

  - You are about to drop the column `displayName` on the `avatars` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "_StoryCategories" ADD CONSTRAINT "_StoryCategories_AB_pkey" PRIMARY KEY ("A", "B");

-- DropIndex
DROP INDEX "_StoryCategories_AB_unique";

-- AlterTable
ALTER TABLE "_StoryThemes" ADD CONSTRAINT "_StoryThemes_AB_pkey" PRIMARY KEY ("A", "B");

-- DropIndex
DROP INDEX "_StoryThemes_AB_unique";

-- AlterTable
ALTER TABLE "avatars" DROP COLUMN "displayName";

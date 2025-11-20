/*
  Warnings:

  - The primary key for the `_StoryCategories` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `_StoryThemes` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - A unique constraint covering the columns `[A,B]` on the table `_StoryCategories` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[A,B]` on the table `_StoryThemes` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "_StoryCategories" DROP CONSTRAINT "_StoryCategories_AB_pkey";

-- AlterTable
ALTER TABLE "_StoryThemes" DROP CONSTRAINT "_StoryThemes_AB_pkey";

-- CreateIndex
CREATE UNIQUE INDEX "_StoryCategories_AB_unique" ON "_StoryCategories"("A", "B");

-- CreateIndex
CREATE UNIQUE INDEX "_StoryThemes_AB_unique" ON "_StoryThemes"("A", "B");

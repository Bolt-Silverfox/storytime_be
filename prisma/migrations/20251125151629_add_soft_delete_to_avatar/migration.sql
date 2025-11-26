-- AlterTable
--ALTER TABLE "_StoryCategories" ADD CONSTRAINT "_StoryCategories_AB_pkey" PRIMARY KEY ("A", "B");

-- DropIndex
--DROP INDEX "_StoryCategories_AB_unique";

-- AlterTable
ALTER TABLE "avatars" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "isDeleted" BOOLEAN NOT NULL DEFAULT false;

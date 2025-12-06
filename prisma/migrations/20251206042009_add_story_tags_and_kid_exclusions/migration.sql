/*
  Warnings:

  - You are about to drop the column `excludedTags` on the `kids` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "kids" DROP COLUMN "excludedTags";

-- CreateTable
CREATE TABLE "story_tags" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "story_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kid_story_tag_exclusions" (
    "id" TEXT NOT NULL,
    "kidId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "kid_story_tag_exclusions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_StoryTags" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_StoryTags_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "story_tags_name_key" ON "story_tags"("name");

-- CreateIndex
CREATE UNIQUE INDEX "story_tags_slug_key" ON "story_tags"("slug");

-- CreateIndex
CREATE INDEX "story_tags_isDeleted_idx" ON "story_tags"("isDeleted");

-- CreateIndex
CREATE INDEX "kid_story_tag_exclusions_kidId_idx" ON "kid_story_tag_exclusions"("kidId");

-- CreateIndex
CREATE UNIQUE INDEX "kid_story_tag_exclusions_kidId_tagId_key" ON "kid_story_tag_exclusions"("kidId", "tagId");

-- CreateIndex
CREATE INDEX "_StoryTags_B_index" ON "_StoryTags"("B");

-- AddForeignKey
ALTER TABLE "kid_story_tag_exclusions" ADD CONSTRAINT "kid_story_tag_exclusions_kidId_fkey" FOREIGN KEY ("kidId") REFERENCES "kids"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kid_story_tag_exclusions" ADD CONSTRAINT "kid_story_tag_exclusions_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "story_tags"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_StoryTags" ADD CONSTRAINT "_StoryTags_A_fkey" FOREIGN KEY ("A") REFERENCES "stories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_StoryTags" ADD CONSTRAINT "_StoryTags_B_fkey" FOREIGN KEY ("B") REFERENCES "story_tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "stories" ADD COLUMN     "creatorKidId" TEXT;

-- CreateTable
CREATE TABLE "downloaded_stories" (
    "id" TEXT NOT NULL,
    "kidId" TEXT NOT NULL,
    "storyId" TEXT NOT NULL,
    "downloadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "downloaded_stories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "downloaded_stories_kidId_storyId_key" ON "downloaded_stories"("kidId", "storyId");

-- AddForeignKey
ALTER TABLE "stories" ADD CONSTRAINT "stories_creatorKidId_fkey" FOREIGN KEY ("creatorKidId") REFERENCES "kids"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "downloaded_stories" ADD CONSTRAINT "downloaded_stories_kidId_fkey" FOREIGN KEY ("kidId") REFERENCES "kids"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "downloaded_stories" ADD CONSTRAINT "downloaded_stories_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "stories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

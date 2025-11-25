-- AlterTable
ALTER TABLE "_StoryCategories" ADD CONSTRAINT "_StoryCategories_AB_pkey" PRIMARY KEY ("A", "B");

-- DropIndex
DROP INDEX "_StoryCategories_AB_unique";

-- AlterTable
ALTER TABLE "kids" ADD COLUMN     "bedtimeDays" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
ADD COLUMN     "bedtimeEnd" TEXT,
ADD COLUMN     "bedtimeStart" TEXT,
ADD COLUMN     "excludedTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "isBedtimeEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "_KidPreferredCategories" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_KidPreferredCategories_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "_KidPreferredCategories_B_index" ON "_KidPreferredCategories"("B");

-- AddForeignKey
ALTER TABLE "_KidPreferredCategories" ADD CONSTRAINT "_KidPreferredCategories_A_fkey" FOREIGN KEY ("A") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_KidPreferredCategories" ADD CONSTRAINT "_KidPreferredCategories_B_fkey" FOREIGN KEY ("B") REFERENCES "kids"("id") ON DELETE CASCADE ON UPDATE CASCADE;

/*
  Warnings:

  - The `meta` column on the `payment_methods` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- AlterTable
ALTER TABLE "kids" ADD COLUMN     "theme" TEXT;

-- AlterTable
ALTER TABLE "payment_methods" DROP COLUMN "meta",
ADD COLUMN     "meta" JSONB;

-- CreateTable
CREATE TABLE "KidFavorite" (
    "id" TEXT NOT NULL,
    "kidId" TEXT NOT NULL,
    "storyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KidFavorite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "KidFavorite_kidId_storyId_key" ON "KidFavorite"("kidId", "storyId");

-- AddForeignKey
ALTER TABLE "KidFavorite" ADD CONSTRAINT "KidFavorite_kidId_fkey" FOREIGN KEY ("kidId") REFERENCES "kids"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KidFavorite" ADD CONSTRAINT "KidFavorite_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "stories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

/*
  Warnings:

  - The `meta` column on the `payment_methods` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - A unique constraint covering the columns `[googleId]` on the table `users` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "kids" ADD COLUMN     "bedtimeDays" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
ADD COLUMN     "bedtimeEnd" TEXT,
ADD COLUMN     "bedtimeStart" TEXT,
ADD COLUMN     "excludedTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "isBedtimeEnabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "notification_preferences" ALTER COLUMN "enabled" SET DEFAULT true;

-- AlterTable
ALTER TABLE "payment_methods" DROP COLUMN "meta",
ADD COLUMN     "meta" JSONB;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "googleId" TEXT;

-- CreateTable
CREATE TABLE "_KidPreferredCategories" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_KidPreferredCategories_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "_KidPreferredCategories_B_index" ON "_KidPreferredCategories"("B");

-- CreateIndex
CREATE UNIQUE INDEX "users_googleId_key" ON "users"("googleId");

-- AddForeignKey
ALTER TABLE "_KidPreferredCategories" ADD CONSTRAINT "_KidPreferredCategories_A_fkey" FOREIGN KEY ("A") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_KidPreferredCategories" ADD CONSTRAINT "_KidPreferredCategories_B_fkey" FOREIGN KEY ("B") REFERENCES "kids"("id") ON DELETE CASCADE ON UPDATE CASCADE;

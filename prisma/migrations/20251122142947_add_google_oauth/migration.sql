/*
  Warnings:

  - You are about to drop the column `avatarUrl` on the `kids` table. All the data in the column will be lost.
  - You are about to drop the column `avatarUrl` on the `users` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[googleId]` on the table `users` will be added. If there are existing duplicate values, this will fail.

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
ALTER TABLE "kids" DROP COLUMN "avatarUrl";

-- AlterTable
ALTER TABLE "users" DROP COLUMN "avatarUrl",
ADD COLUMN     "googleId" TEXT,
ADD COLUMN     "googlePicture" TEXT,
ADD COLUMN     "googleVerified" BOOLEAN;

-- CreateIndex
CREATE UNIQUE INDEX "users_googleId_key" ON "users"("googleId");

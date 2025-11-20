/*
  Warnings:

  - You are about to drop the column `avatarType` on the `kids` table. All the data in the column will be lost.
  - You are about to drop the column `avatarUrl` on the `kids` table. All the data in the column will be lost.
  - You are about to drop the column `imageUrl` on the `system_avatars` table. All the data in the column will be lost.
  - You are about to drop the column `avatarUrl` on the `users` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[name]` on the table `system_avatars` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `url` to the `system_avatars` table without a default value. This is not possible if the table is not empty.

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
ALTER TABLE "kids" DROP COLUMN "avatarType",
DROP COLUMN "avatarUrl";

-- AlterTable
ALTER TABLE "system_avatars" DROP COLUMN "imageUrl",
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "displayName" TEXT,
ADD COLUMN     "isSystemAvatar" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "publicId" TEXT,
ADD COLUMN     "url" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "users" DROP COLUMN "avatarUrl",
ADD COLUMN     "systemAvatarId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "system_avatars_name_key" ON "system_avatars"("name");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_systemAvatarId_fkey" FOREIGN KEY ("systemAvatarId") REFERENCES "system_avatars"("id") ON DELETE SET NULL ON UPDATE CASCADE;

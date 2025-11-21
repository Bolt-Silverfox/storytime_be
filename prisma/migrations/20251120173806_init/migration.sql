/*
  Warnings:

  - You are about to drop the column `avatarUrl` on the `kids` table. All the data in the column will be lost.
  - You are about to drop the column `avatarUrl` on the `users` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "kids" DROP COLUMN "avatarUrl",
ADD COLUMN     "avatarId" TEXT;

-- AlterTable
ALTER TABLE "users" DROP COLUMN "avatarUrl",
ADD COLUMN     "avatarId" TEXT;

-- CreateTable
CREATE TABLE "avatars" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "displayName" TEXT,
    "url" TEXT NOT NULL,
    "isSystemAvatar" BOOLEAN NOT NULL DEFAULT false,
    "publicId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "avatars_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "avatars_name_idx" ON "avatars"("name");

-- CreateIndex
CREATE INDEX "avatars_isSystemAvatar_idx" ON "avatars"("isSystemAvatar");

-- CreateIndex
CREATE UNIQUE INDEX "avatars_name_key" ON "avatars"("name");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_avatarId_fkey" FOREIGN KEY ("avatarId") REFERENCES "avatars"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kids" ADD CONSTRAINT "kids_avatarId_fkey" FOREIGN KEY ("avatarId") REFERENCES "avatars"("id") ON DELETE SET NULL ON UPDATE CASCADE;
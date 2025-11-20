-- AlterTable
ALTER TABLE "kids" ADD COLUMN     "avatarType" TEXT NOT NULL DEFAULT 'system',
ADD COLUMN     "systemAvatarId" TEXT;

-- CreateTable
CREATE TABLE "system_avatars" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "imageUrl" TEXT NOT NULL,

    CONSTRAINT "system_avatars_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "kids" ADD CONSTRAINT "kids_systemAvatarId_fkey" FOREIGN KEY ("systemAvatarId") REFERENCES "system_avatars"("id") ON DELETE SET NULL ON UPDATE CASCADE;

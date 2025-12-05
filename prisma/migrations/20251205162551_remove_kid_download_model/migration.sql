/*
  Warnings:

  - You are about to drop the column `enableBiometrics` on the `users` table. All the data in the column will be lost.
  - You are about to drop the `kid_downloads` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "kid_downloads" DROP CONSTRAINT "kid_downloads_kidId_fkey";

-- DropForeignKey
ALTER TABLE "kid_downloads" DROP CONSTRAINT "kid_downloads_storyId_fkey";

-- AlterTable
ALTER TABLE "users" DROP COLUMN "enableBiometrics";

-- DropTable
DROP TABLE "kid_downloads";

-- CreateTable
CREATE TABLE "DeviceAuth" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "biometricsOn" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeviceAuth_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DeviceAuth_userId_deviceId_key" ON "DeviceAuth"("userId", "deviceId");

-- AddForeignKey
ALTER TABLE "DeviceAuth" ADD CONSTRAINT "DeviceAuth_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

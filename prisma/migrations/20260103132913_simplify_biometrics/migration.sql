/*
  Warnings:

  - You are about to drop the `DeviceAuth` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "DeviceAuth" DROP CONSTRAINT "DeviceAuth_userId_fkey";

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "biometricsEnabled" BOOLEAN NOT NULL DEFAULT false;

-- DropTable
DROP TABLE "DeviceAuth";

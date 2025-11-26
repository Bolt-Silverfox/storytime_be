/*
  Warnings:

  - Added the required column `status` to the `activity_logs` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "activity_logs" ADD COLUMN     "deviceModel" TEXT,
ADD COLUMN     "deviceName" TEXT,
ADD COLUMN     "ipAddress" TEXT,
ADD COLUMN     "os" TEXT,
ADD COLUMN     "status" TEXT NOT NULL;

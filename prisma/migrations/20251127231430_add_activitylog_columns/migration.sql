/*
  Warnings:

  - Added the required column `status` to the `activity_logs` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "activity_logs" DROP CONSTRAINT "activity_logs_kidId_fkey";

-- AlterTable
ALTER TABLE "activity_logs" ADD COLUMN     "deviceModel" TEXT,
ADD COLUMN     "deviceName" TEXT,
ADD COLUMN     "ipAddress" TEXT,
ADD COLUMN     "os" TEXT,
ADD COLUMN     "status" TEXT NOT NULL;

-- AddForeignKey
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_kidId_fkey" FOREIGN KEY ("kidId") REFERENCES "kids"("id") ON DELETE SET NULL ON UPDATE CASCADE;

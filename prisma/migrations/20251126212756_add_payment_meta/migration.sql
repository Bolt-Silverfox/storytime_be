/*
  Warnings:

  - You are about to drop the column `endAt` on the `subscriptions` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "payment_methods" ADD COLUMN     "meta" TEXT;

-- AlterTable
ALTER TABLE "subscriptions" DROP COLUMN "endAt",
ADD COLUMN     "endsAt" TIMESTAMP(3);

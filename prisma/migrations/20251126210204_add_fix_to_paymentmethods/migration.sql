/*
  Warnings:

  - You are about to drop the column `expiresAt` on the `subscriptions` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "avatars" ALTER COLUMN "displayName" DROP NOT NULL;

-- AlterTable
ALTER TABLE "payment_methods" ADD COLUMN     "provider" TEXT;

-- AlterTable
ALTER TABLE "payment_transactions" ADD COLUMN     "currency" TEXT,
ADD COLUMN     "reference" TEXT;

-- AlterTable
ALTER TABLE "subscriptions" DROP COLUMN "expiresAt",
ADD COLUMN     "endAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "pinHash" TEXT;

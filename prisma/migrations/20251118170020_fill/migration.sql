/*
  Warnings:

  - You are about to drop the column `token` on the `tokens` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[hashedToken]` on the table `tokens` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `hashedToken` to the `tokens` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `tokens` table without a default value. This is not possible if the table is not empty.
  - Changed the type of `type` on the `tokens` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- CreateEnum
CREATE TYPE "TokenType" AS ENUM ('EMAIL_VERIFICATION', 'PASSWORD_RESET', 'REFRESH_TOKEN');

-- DropIndex
DROP INDEX "tokens_token_key";

-- DropIndex
DROP INDEX "tokens_userId_token_idx";

-- AlterTable
ALTER TABLE "tokens" DROP COLUMN "token",
ADD COLUMN     "hashedToken" TEXT NOT NULL,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL,
DROP COLUMN "type",
ADD COLUMN     "type" "TokenType" NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "tokens_hashedToken_key" ON "tokens"("hashedToken");

-- CreateIndex
CREATE INDEX "tokens_userId_type_idx" ON "tokens"("userId", "type");

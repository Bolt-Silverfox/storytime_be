/*
  Warnings:

  - You are about to drop the column `googlePicture` on the `users` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[googleEmail]` on the table `users` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "users" DROP COLUMN "googlePicture",
ADD COLUMN     "googleAvatar" TEXT,
ADD COLUMN     "googleEmail" TEXT,
ALTER COLUMN "googleVerified" SET DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX "users_googleEmail_key" ON "users"("googleEmail");

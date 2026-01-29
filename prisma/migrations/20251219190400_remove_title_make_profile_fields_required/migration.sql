/*
  Warnings:

  - You are about to drop the column `title` on the `users` table. All the data in the column will be lost.
  - Made the column `language` on table `profiles` required. This step will fail if there are existing NULL values in that column.
  - Made the column `country` on table `profiles` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "profiles" ALTER COLUMN "language" SET NOT NULL,
ALTER COLUMN "country" SET NOT NULL;

-- AlterTable
ALTER TABLE "users" DROP COLUMN "title";

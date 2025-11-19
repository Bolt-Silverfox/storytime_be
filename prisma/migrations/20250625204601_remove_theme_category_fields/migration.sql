/*
  Warnings:

  - You are about to drop the column `category` on the `stories` table. All the data in the column will be lost.
  - You are about to drop the column `theme` on the `stories` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "stories" DROP COLUMN "category",
DROP COLUMN "theme";

/*
  Warnings:

  - Added the required column `updatedAt` to the `age_groups` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "age_groups" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

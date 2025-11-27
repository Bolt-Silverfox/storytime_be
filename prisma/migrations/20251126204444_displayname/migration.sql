/*
  Warnings:

  - Added the required column `displayName` to the `avatars` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "avatars" ADD COLUMN     "displayName" TEXT NOT NULL;

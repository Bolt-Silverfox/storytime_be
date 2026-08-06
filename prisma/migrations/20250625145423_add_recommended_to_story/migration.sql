/*
  Warnings:

  - Made the column `coverImageUrl` on table `stories` required. This step will fail if there are existing NULL values in that column.
  - Made the column `audioUrl` on table `stories` required. This step will fail if there are existing NULL values in that column.
  - Made the column `ageMin` on table `stories` required. This step will fail if there are existing NULL values in that column.
  - Made the column `ageMax` on table `stories` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "stories" ADD COLUMN     "recommended" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "coverImageUrl" SET NOT NULL,
ALTER COLUMN "audioUrl" SET NOT NULL,
ALTER COLUMN "isInteractive" DROP DEFAULT,
ALTER COLUMN "ageMin" SET NOT NULL,
ALTER COLUMN "ageMax" SET NOT NULL;

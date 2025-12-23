-- AlterTable
ALTER TABLE "profiles" ADD COLUMN     "preferredLanguages" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Additive: Cloudinary public id of an uploaded voice sample, so deleting the voice can free its storage.
-- Rollback: ALTER TABLE "voices" DROP COLUMN "publicId";
-- AlterTable
ALTER TABLE "voices" ADD COLUMN "publicId" TEXT;

/*
  Warnings:

  - You are about to drop the `story_audio_cache` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "story_audio_cache" DROP CONSTRAINT "story_audio_cache_storyId_fkey";

-- DropTable
DROP TABLE "story_audio_cache";

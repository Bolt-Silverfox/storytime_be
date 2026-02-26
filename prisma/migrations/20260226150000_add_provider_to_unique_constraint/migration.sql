-- DropIndex
DROP INDEX IF EXISTS "paragraph_audio_cache_storyId_textHash_voiceId_key";

-- CreateIndex
CREATE UNIQUE INDEX "paragraph_audio_cache_storyId_textHash_voiceId_provider_key" ON "paragraph_audio_cache"("storyId", "textHash", "voiceId", "provider");

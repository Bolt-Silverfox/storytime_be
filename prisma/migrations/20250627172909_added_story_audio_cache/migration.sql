-- CreateTable
CREATE TABLE "story_audio_cache" (
    "id" TEXT NOT NULL,
    "storyId" TEXT NOT NULL,
    "voiceType" TEXT NOT NULL,
    "audioUrl" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "story_audio_cache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "story_audio_cache_storyId_audioUrl_key" ON "story_audio_cache"("storyId", "audioUrl");

-- CreateIndex
CREATE UNIQUE INDEX "story_audio_cache_storyId_voiceType_key" ON "story_audio_cache"("storyId", "voiceType");

-- AddForeignKey
ALTER TABLE "story_audio_cache" ADD CONSTRAINT "story_audio_cache_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "stories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

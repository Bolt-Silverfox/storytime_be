-- CreateTable
CREATE TABLE "paragraph_audio_cache" (
    "id" TEXT NOT NULL,
    "storyId" TEXT NOT NULL,
    "textHash" TEXT NOT NULL,
    "voiceId" TEXT NOT NULL,
    "audioUrl" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "paragraph_audio_cache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "paragraph_audio_cache_storyId_idx" ON "paragraph_audio_cache"("storyId");

-- CreateIndex
CREATE UNIQUE INDEX "paragraph_audio_cache_storyId_textHash_voiceId_key" ON "paragraph_audio_cache"("storyId", "textHash", "voiceId");

-- AddForeignKey
ALTER TABLE "paragraph_audio_cache" ADD CONSTRAINT "paragraph_audio_cache_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "stories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "user_story_progress" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "storyId" TEXT NOT NULL,
    "progress" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "lastAccessed" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "totalTimeSpent" INTEGER NOT NULL DEFAULT 0,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "user_story_progress_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_story_progress_isDeleted_idx" ON "user_story_progress"("isDeleted");

-- CreateIndex
CREATE UNIQUE INDEX "user_story_progress_userId_storyId_key" ON "user_story_progress"("userId", "storyId");

-- AddForeignKey
ALTER TABLE "user_story_progress" ADD CONSTRAINT "user_story_progress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_story_progress" ADD CONSTRAINT "user_story_progress_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "stories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

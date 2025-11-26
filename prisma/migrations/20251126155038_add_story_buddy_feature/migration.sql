-- AlterTable
ALTER TABLE "kids" ADD COLUMN     "storyBuddyId" TEXT;

-- CreateTable
CREATE TABLE "story_buddies" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT,
    "type" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "personality" TEXT,
    "voiceType" TEXT,
    "greetingMessages" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "ageGroupMin" INTEGER NOT NULL DEFAULT 3,
    "ageGroupMax" INTEGER NOT NULL DEFAULT 12,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "story_buddies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "buddy_interactions" (
    "id" TEXT NOT NULL,
    "kidId" TEXT NOT NULL,
    "buddyId" TEXT NOT NULL,
    "interactionType" TEXT NOT NULL,
    "context" TEXT,
    "message" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "buddy_interactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_StoryThemes" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_StoryThemes_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "story_buddies_name_key" ON "story_buddies"("name");

-- CreateIndex
CREATE INDEX "buddy_interactions_kidId_timestamp_idx" ON "buddy_interactions"("kidId", "timestamp");

-- CreateIndex
CREATE INDEX "buddy_interactions_buddyId_idx" ON "buddy_interactions"("buddyId");

-- CreateIndex
CREATE INDEX "_StoryThemes_B_index" ON "_StoryThemes"("B");

-- AddForeignKey
ALTER TABLE "kids" ADD CONSTRAINT "kids_storyBuddyId_fkey" FOREIGN KEY ("storyBuddyId") REFERENCES "story_buddies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buddy_interactions" ADD CONSTRAINT "buddy_interactions_buddyId_fkey" FOREIGN KEY ("buddyId") REFERENCES "story_buddies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buddy_interactions" ADD CONSTRAINT "buddy_interactions_kidId_fkey" FOREIGN KEY ("kidId") REFERENCES "kids"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_StoryThemes" ADD CONSTRAINT "_StoryThemes_A_fkey" FOREIGN KEY ("A") REFERENCES "stories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_StoryThemes" ADD CONSTRAINT "_StoryThemes_B_fkey" FOREIGN KEY ("B") REFERENCES "Theme"("id") ON DELETE CASCADE ON UPDATE CASCADE;

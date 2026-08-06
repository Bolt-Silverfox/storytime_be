-- AlterTable
ALTER TABLE "kids" ADD COLUMN     "buddySelectedAt" TIMESTAMP(3),
ADD COLUMN     "storyBuddyId" TEXT;

-- CreateTable
CREATE TABLE "story_buddies" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT,
    "type" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "profileAvatarUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "themeColor" TEXT,
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

-- CreateIndex
CREATE UNIQUE INDEX "story_buddies_name_key" ON "story_buddies"("name");

-- CreateIndex
CREATE INDEX "buddy_interactions_kidId_timestamp_idx" ON "buddy_interactions"("kidId", "timestamp");

-- CreateIndex
CREATE INDEX "buddy_interactions_buddyId_idx" ON "buddy_interactions"("buddyId");

-- AddForeignKey
ALTER TABLE "kids" ADD CONSTRAINT "kids_storyBuddyId_fkey" FOREIGN KEY ("storyBuddyId") REFERENCES "story_buddies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buddy_interactions" ADD CONSTRAINT "buddy_interactions_buddyId_fkey" FOREIGN KEY ("buddyId") REFERENCES "story_buddies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buddy_interactions" ADD CONSTRAINT "buddy_interactions_kidId_fkey" FOREIGN KEY ("kidId") REFERENCES "kids"("id") ON DELETE CASCADE ON UPDATE CASCADE;

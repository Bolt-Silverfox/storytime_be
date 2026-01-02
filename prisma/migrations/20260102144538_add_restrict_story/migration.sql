-- CreateTable
CREATE TABLE "restricted_stories" (
    "id" TEXT NOT NULL,
    "kidId" TEXT NOT NULL,
    "storyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "restricted_stories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "restricted_stories_kidId_idx" ON "restricted_stories"("kidId");

-- CreateIndex
CREATE UNIQUE INDEX "restricted_stories_kidId_storyId_key" ON "restricted_stories"("kidId", "storyId");

-- AddForeignKey
ALTER TABLE "restricted_stories" ADD CONSTRAINT "restricted_stories_kidId_fkey" FOREIGN KEY ("kidId") REFERENCES "kids"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restricted_stories" ADD CONSTRAINT "restricted_stories_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "stories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restricted_stories" ADD CONSTRAINT "restricted_stories_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

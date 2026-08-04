-- CreateTable
CREATE TABLE "parent_recommendations" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kidId" TEXT NOT NULL,
    "storyId" TEXT NOT NULL,
    "message" TEXT,
    "recommendedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "parent_recommendations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "parent_recommendations_isDeleted_idx" ON "parent_recommendations"("isDeleted");

-- CreateIndex
CREATE INDEX "parent_recommendations_kidId_idx" ON "parent_recommendations"("kidId");

-- CreateIndex
CREATE INDEX "parent_recommendations_userId_kidId_idx" ON "parent_recommendations"("userId", "kidId");

-- CreateIndex
CREATE UNIQUE INDEX "parent_recommendations_userId_kidId_storyId_key" ON "parent_recommendations"("userId", "kidId", "storyId");

-- AddForeignKey
ALTER TABLE "parent_recommendations" ADD CONSTRAINT "parent_recommendations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parent_recommendations" ADD CONSTRAINT "parent_recommendations_kidId_fkey" FOREIGN KEY ("kidId") REFERENCES "kids"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parent_recommendations" ADD CONSTRAINT "parent_recommendations_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "stories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

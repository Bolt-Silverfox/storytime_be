-- CreateTable
CREATE TABLE "StoryQuestion" (
    "id" TEXT NOT NULL,
    "storyId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "options" TEXT[],
    "answer" INTEGER NOT NULL,

    CONSTRAINT "StoryQuestion_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "StoryQuestion" ADD CONSTRAINT "StoryQuestion_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "stories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

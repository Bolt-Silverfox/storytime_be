-- CreateTable
CREATE TABLE "KidDownload" (
    "id" TEXT NOT NULL,
    "kidId" TEXT NOT NULL,
    "storyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KidDownload_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "KidDownload_kidId_storyId_key" ON "KidDownload"("kidId", "storyId");

-- AddForeignKey
ALTER TABLE "KidDownload" ADD CONSTRAINT "KidDownload_kidId_fkey" FOREIGN KEY ("kidId") REFERENCES "kids"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KidDownload" ADD CONSTRAINT "KidDownload_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "stories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

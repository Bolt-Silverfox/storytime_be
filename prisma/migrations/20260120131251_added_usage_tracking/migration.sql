-- CreateTable
CREATE TABLE "user_usages" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "elevenLabsCount" INTEGER NOT NULL DEFAULT 0,
    "currentMonth" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_usages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_usages_userId_key" ON "user_usages"("userId");

-- AddForeignKey
ALTER TABLE "user_usages" ADD CONSTRAINT "user_usages_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

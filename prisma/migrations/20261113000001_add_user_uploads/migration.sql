-- Additive: per-user Cloudinary upload ledger for the cumulative upload cap.
-- Rollback: DROP TABLE "user_uploads";
-- CreateTable
CREATE TABLE "user_uploads" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "publicId" TEXT,
    "bytes" INTEGER NOT NULL,
    "pending" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_uploads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_uploads_publicId_key" ON "user_uploads"("publicId");

-- CreateIndex
CREATE INDEX "user_uploads_userId_idx" ON "user_uploads"("userId");

-- AddForeignKey
ALTER TABLE "user_uploads" ADD CONSTRAINT "user_uploads_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


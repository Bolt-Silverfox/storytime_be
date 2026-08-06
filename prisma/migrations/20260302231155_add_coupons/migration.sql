-- CreateEnum
CREATE TYPE "CouponType" AS ENUM ('PERCENTAGE', 'FLAT', 'FREE_TRIAL_DAYS');

-- DropIndex
DROP INDEX "downloaded_stories_kidId_idx";

-- DropIndex
DROP INDEX "user_story_progress_userId_idx";

-- CreateTable
CREATE TABLE "coupons" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "type" "CouponType" NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "maxUses" INTEGER,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validUntil" TIMESTAMP(3),
    "plan" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "coupons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coupon_redemptions" (
    "id" TEXT NOT NULL,
    "couponId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coupon_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "coupons_code_key" ON "coupons"("code");

-- CreateIndex
CREATE INDEX "coupons_code_idx" ON "coupons"("code");

-- CreateIndex
CREATE INDEX "coupons_isActive_idx" ON "coupons"("isActive");

-- CreateIndex
CREATE INDEX "coupon_redemptions_couponId_idx" ON "coupon_redemptions"("couponId");

-- CreateIndex
CREATE INDEX "coupon_redemptions_userId_idx" ON "coupon_redemptions"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "coupon_redemptions_couponId_userId_key" ON "coupon_redemptions"("couponId", "userId");

-- CreateIndex
CREATE INDEX "downloaded_stories_kidId_downloadedAt_idx" ON "downloaded_stories"("kidId", "downloadedAt" DESC);

-- CreateIndex
CREATE INDEX "favorites_kidId_isDeleted_createdAt_idx" ON "favorites"("kidId", "isDeleted", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "stories_isDeleted_createdAt_idx" ON "stories"("isDeleted", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "story_progress_kidId_completed_isDeleted_lastAccessed_idx" ON "story_progress"("kidId", "completed", "isDeleted", "lastAccessed" DESC);

-- CreateIndex
CREATE INDEX "user_story_progress_userId_completed_isDeleted_lastAccessed_idx" ON "user_story_progress"("userId", "completed", "isDeleted", "lastAccessed" DESC);

-- CreateIndex
CREATE INDEX "voices_elevenLabsVoiceId_idx" ON "voices"("elevenLabsVoiceId");

-- AddForeignKey
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "coupons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

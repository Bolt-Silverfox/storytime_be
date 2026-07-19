-- AlterTable: out-of-order delivery watermark for store subscription webhooks
ALTER TABLE "subscriptions" ADD COLUMN     "lastEventAt" TIMESTAMP(3);

-- CreateTable: store webhook receipts (Apple ASSN v2 / Google Play RTDN)
CREATE TABLE "webhook_events" (
    "id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "externalEventId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'received',
    "errorMessage" TEXT,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "webhook_events_platform_eventType_idx" ON "webhook_events"("platform", "eventType");

-- CreateIndex
CREATE INDEX "webhook_events_status_createdAt_idx" ON "webhook_events"("status", "createdAt");

-- CreateIndex
CREATE INDEX "webhook_events_createdAt_idx" ON "webhook_events"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_events_platform_externalEventId_key" ON "webhook_events"("platform", "externalEventId");

-- CreateIndex: resolve subscriptions by store purchase token during webhook processing
CREATE INDEX "subscriptions_purchaseToken_idx" ON "subscriptions"("purchaseToken");

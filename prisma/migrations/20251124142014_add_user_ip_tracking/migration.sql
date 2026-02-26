-- CreateTable
CREATE TABLE "user_ips" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ipAddress" TEXT NOT NULL,
    "userAgent" TEXT,
    "firstUsed" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsed" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_ips_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_ips_ipAddress_idx" ON "user_ips"("ipAddress");

-- CreateIndex
CREATE UNIQUE INDEX "user_ips_userId_ipAddress_key" ON "user_ips"("userId", "ipAddress");

-- AddForeignKey
ALTER TABLE "user_ips" ADD CONSTRAINT "user_ips_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

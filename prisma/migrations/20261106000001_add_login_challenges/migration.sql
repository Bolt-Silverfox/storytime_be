-- CreateEnum
CREATE TYPE "LoginChallengePurpose" AS ENUM ('login');

-- CreateTable
CREATE TABLE "login_challenges" (
    "id" TEXT NOT NULL,
    "emailNormalized" TEXT NOT NULL,
    "purpose" "LoginChallengePurpose" NOT NULL DEFAULT 'login',
    "codeHash" TEXT NOT NULL,
    "linkTokenHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "invalidatedAt" TIMESTAMP(3),
    "requestIpHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "login_challenges_linkTokenHash_key" ON "login_challenges"("linkTokenHash");

-- CreateIndex
CREATE INDEX "login_challenges_emailNormalized_createdAt_idx" ON "login_challenges"("emailNormalized", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "login_challenges_expiresAt_idx" ON "login_challenges"("expiresAt");


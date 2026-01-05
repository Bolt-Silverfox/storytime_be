/*
  Warnings:

  - You are about to drop the column `preferredLanguages` on the `profiles` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "profiles" DROP COLUMN "preferredLanguages";

-- CreateTable
CREATE TABLE "learning_expectations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "learning_expectations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_learning_expectations" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "learningExpectationId" TEXT NOT NULL,
    "selectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "user_learning_expectations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "learning_expectations_name_key" ON "learning_expectations"("name");

-- CreateIndex
CREATE INDEX "learning_expectations_isDeleted_idx" ON "learning_expectations"("isDeleted");

-- CreateIndex
CREATE INDEX "learning_expectations_isActive_idx" ON "learning_expectations"("isActive");

-- CreateIndex
CREATE INDEX "user_learning_expectations_userId_idx" ON "user_learning_expectations"("userId");

-- CreateIndex
CREATE INDEX "user_learning_expectations_learningExpectationId_idx" ON "user_learning_expectations"("learningExpectationId");

-- CreateIndex
CREATE INDEX "user_learning_expectations_isDeleted_idx" ON "user_learning_expectations"("isDeleted");

-- CreateIndex
CREATE UNIQUE INDEX "user_learning_expectations_userId_learningExpectationId_key" ON "user_learning_expectations"("userId", "learningExpectationId");

-- AddForeignKey
ALTER TABLE "user_learning_expectations" ADD CONSTRAINT "user_learning_expectations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_learning_expectations" ADD CONSTRAINT "user_learning_expectations_learningExpectationId_fkey" FOREIGN KEY ("learningExpectationId") REFERENCES "learning_expectations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

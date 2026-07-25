-- AlterTable
ALTER TABLE "question_answers" ADD COLUMN     "userId" TEXT,
ALTER COLUMN "kidId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "question_answers_userId_idx" ON "question_answers"("userId");

-- AddForeignKey
ALTER TABLE "question_answers" ADD CONSTRAINT "question_answers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

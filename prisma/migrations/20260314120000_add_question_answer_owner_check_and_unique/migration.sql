-- CreateIndex
CREATE UNIQUE INDEX "question_answers_userId_questionId_key" ON "question_answers"("userId", "questionId");

-- AddCheckConstraint
ALTER TABLE "question_answers" ADD CONSTRAINT "question_answers_owner_check" CHECK ("kidId" IS NOT NULL OR "userId" IS NOT NULL);

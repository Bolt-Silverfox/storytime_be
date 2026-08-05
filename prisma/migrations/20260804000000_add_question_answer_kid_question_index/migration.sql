-- Serve the hasKidAnswered(kidId, questionId) lookup in
-- PrismaQuestionAnswerRepository. The table only indexed those columns
-- separately (plus the composite (kidId, answeredAt)), so the first-answer
-- check degrades as answer history grows.
--
-- Deliberately NOT unique: blue records every answer as a new row, so a kid
-- may answer the same question more than once. See
-- 20260802000000_reconcile_green_history_objects, which drops green's
-- UNIQUE(userId, questionId) for the same reason.
--
-- Guarded so it no-ops on databases where it already exists.
CREATE INDEX IF NOT EXISTS "question_answers_kidId_questionId_idx"
  ON "question_answers"("kidId", "questionId");

-- Reconcile objects that exist on green-history (develop-v1.2.0) databases
-- but diverged from blue's schema, ahead of promoting blue onto them.
--
-- 1. DROP the UNIQUE(userId, questionId) index green created in
--    20260314120000_add_question_answer_owner_check_and_unique. Blue records
--    every answer as a new row (plain create, no upsert) so users may answer
--    the same question more than once; on green DBs the surviving unique
--    index would make the second answer fail with 23505.
--    (The question_answers_owner_check CHECK constraint from the same green
--    migration is intentionally KEPT where it exists: blue's writes always
--    set kidId or userId, so it is harmless defense-in-depth.)
DROP INDEX IF EXISTS "question_answers_userId_questionId_key";

-- 2. Restore the guest-activity query index green added in
--    20260406000000_add_activitylog_guest_query_index; it was dropped from
--    blue's schema unintentionally. Guarded so green DBs (where it already
--    exists) no-op and fresh blue DBs create it.
CREATE INDEX IF NOT EXISTS "activity_logs_action_isDeleted_createdAt_idx"
  ON "activity_logs"("action", "isDeleted", "createdAt" DESC);

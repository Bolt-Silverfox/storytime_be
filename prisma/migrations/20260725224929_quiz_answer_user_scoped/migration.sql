-- Guarded rewrite: green (develop-v1.2.0) databases already have all of these
-- objects from 20260314011049_make_question_answer_kid_optional, so the
-- original unguarded statements fail there (42701 duplicate column — the dev
-- P3009 incident). Every statement is idempotent so this applies cleanly on
-- green-history DBs, fresh DBs, and half-applied DBs alike.

-- AlterTable
ALTER TABLE "question_answers" ADD COLUMN IF NOT EXISTS "userId" TEXT;
ALTER TABLE "question_answers" ALTER COLUMN "kidId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "question_answers_userId_idx" ON "question_answers"("userId");

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'question_answers_userId_fkey'
      AND conrelid = '"question_answers"'::regclass
      AND contype = 'f'
  ) THEN
    ALTER TABLE "question_answers" ADD CONSTRAINT "question_answers_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

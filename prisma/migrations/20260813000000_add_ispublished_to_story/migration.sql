-- AlterTable: add draft/published flag. Nullable-free but safe: a NOT NULL
-- column WITH a constant DEFAULT is a metadata-only change in Postgres (no
-- table rewrite). Default true keeps every existing story published.
ALTER TABLE "stories" ADD COLUMN "isPublished" BOOLEAN NOT NULL DEFAULT true;

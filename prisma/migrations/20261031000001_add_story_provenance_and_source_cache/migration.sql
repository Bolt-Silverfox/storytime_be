-- Story provenance + source cache foundation. Purely additive.
--
-- The ALTER TABLE / CREATE INDEX on "stories" below take ACCESS EXCLUSIVE /
-- SHARE locks. Fail fast instead of queueing behind a long transaction (which
-- would block every story read/write queued behind us). If this errors with a
-- lock timeout (SQLSTATE 55P03) nothing was applied but Prisma records the
-- migration as failed, and a plain re-run then fails with P3009. Recover with:
--   prisma migrate resolve --rolled-back 20261031000001_add_story_provenance_and_source_cache
-- and then run `prisma migrate deploy` again at a quieter moment. SET LOCAL is
-- scoped to the migration's implicit transaction.
SET LOCAL lock_timeout = '5s';
--
-- stories: ten NULLABLE columns with no default. Adding a nullable column
-- with no default is metadata-only in Postgres (no table rewrite, no scan),
-- and existing rows read NULL. No existing column or default is touched
-- (isPublished stays DEFAULT true).
ALTER TABLE "stories"
  ADD COLUMN "sourceName" TEXT,
  ADD COLUMN "sourceId" TEXT,
  ADD COLUMN "sourceUrl" TEXT,
  ADD COLUMN "licenseCode" TEXT,
  ADD COLUMN "licenseUrl" TEXT,
  ADD COLUMN "authorName" TEXT,
  ADD COLUMN "attributionText" TEXT,
  ADD COLUMN "adaptationNotes" TEXT,
  ADD COLUMN "importedAt" TIMESTAMP(3),
  ADD COLUMN "contentHash" TEXT;

-- source_cache: new table (the "fetch once" cache). Payloads are not stored
-- here; rawPayloadKey points at the object store / file.
CREATE TABLE "source_cache" (
    "id" TEXT NOT NULL,
    "sourceName" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "rawPayloadKey" TEXT,
    "contentHash" TEXT,
    "contentChanged" BOOLEAN NOT NULL DEFAULT false,
    "previousContentHash" TEXT,
    "httpStatus" INTEGER NOT NULL,
    "etag" TEXT,
    "lastModified" TEXT,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revalidateAfter" TIMESTAMP(3) NOT NULL,
    "licenseSnapshot" TEXT,
    "fetchedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "source_cache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "source_cache_revalidateAfter_idx" ON "source_cache"("revalidateAfter");

-- CreateIndex
CREATE INDEX "source_cache_contentChanged_idx" ON "source_cache"("contentChanged");

-- CreateIndex
CREATE UNIQUE INDEX "source_cache_sourceName_sourceId_key" ON "source_cache"("sourceName", "sourceId");

-- CreateIndex: dedupe lookups on the stories table. The table is small enough
-- (thousands of rows) that a plain CREATE INDEX is a sub-second lock.
CREATE INDEX "stories_contentHash_idx" ON "stories"("contentHash");

-- CreateIndex: unique imported story per source. NULLs are distinct in
-- Postgres, so non-imported stories (sourceName/sourceId NULL) never collide.
CREATE UNIQUE INDEX "stories_sourceName_sourceId_key" ON "stories"("sourceName", "sourceId");

-- source_fetch_lease: per-key fetch claim (see SourceCacheService). Rows are
-- deleted on release; expiresAt (DB clock, UTC) frees a crashed holder.
CREATE TABLE "source_fetch_lease" (
    "sourceName" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "lockedBy" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "source_fetch_lease_pkey" PRIMARY KEY ("sourceName","sourceId")
);

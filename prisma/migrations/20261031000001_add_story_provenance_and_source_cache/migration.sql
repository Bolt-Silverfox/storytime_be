-- Story provenance + source cache foundation. Purely additive.
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

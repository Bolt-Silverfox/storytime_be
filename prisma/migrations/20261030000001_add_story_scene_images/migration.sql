-- Additive: per-scene story illustrations with a human review workflow.
-- New enum + new table only; no existing table or column is touched.
-- Rollback (safe, nothing else references it):
--   DROP TABLE "story_scene_images"; DROP TYPE "SceneImageStatus";
CREATE TYPE "SceneImageStatus" AS ENUM ('PENDING_GENERATION', 'PENDING_REVIEW', 'APPROVED', 'REJECTED');

CREATE TABLE "story_scene_images" (
    "id" TEXT NOT NULL,
    "storyId" TEXT NOT NULL,
    "sceneIndex" INTEGER NOT NULL,
    "startPage" INTEGER NOT NULL,
    "endPage" INTEGER NOT NULL,
    "textHash" TEXT NOT NULL,
    "imageUrl" TEXT,
    "prompt" TEXT,
    "styleNotes" TEXT,
    "provider" TEXT,
    "model" TEXT,
    "status" "SceneImageStatus" NOT NULL DEFAULT 'PENDING_GENERATION',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "story_scene_images_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "story_scene_images_storyId_sceneIndex_key" ON "story_scene_images"("storyId", "sceneIndex");

CREATE INDEX "story_scene_images_status_isDeleted_createdAt_idx" ON "story_scene_images"("status", "isDeleted", "createdAt");

ALTER TABLE "story_scene_images" ADD CONSTRAINT "story_scene_images_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "stories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

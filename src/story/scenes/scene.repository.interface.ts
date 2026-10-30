import type { Prisma, SceneImageStatus, StorySceneImage } from '@prisma/client';

export type SceneWithStory = StorySceneImage & {
  story: { id: string; title: string; textContent: string | null };
};

export interface ScenePlanItem {
  sceneIndex: number;
  startPage: number;
  endPage: number;
  textHash: string;
  prompt?: string;
  styleNotes?: string;
  /** true => wipe image/review state (range or text changed, or new row) */
  reset: boolean;
}

export interface IStorySceneRepository {
  findStoryText(
    storyId: string,
  ): Promise<{ id: string; textContent: string | null } | null>;
  /** Non-deleted scenes by default, ordered by sceneIndex. */
  findByStory(
    storyId: string,
    opts?: { includeDeleted?: boolean },
  ): Promise<StorySceneImage[]>;
  findApprovedByStory(storyId: string): Promise<StorySceneImage[]>;
  findByIdWithStory(id: string): Promise<SceneWithStory | null>;
  /** One transaction: upsert planned scenes (reviving soft-deleted), soft-delete removed indexes. */
  applyPlan(
    storyId: string,
    plan: { upserts: ScenePlanItem[]; removeIndexes: number[] },
  ): Promise<void>;
  update(
    id: string,
    data: Prisma.StorySceneImageUncheckedUpdateInput,
  ): Promise<StorySceneImage>;
  listForReview(params: {
    status: SceneImageStatus;
    skip: number;
    take: number;
  }): Promise<{ items: SceneWithStory[]; total: number }>;
}

export const STORY_SCENE_REPOSITORY = Symbol('STORY_SCENE_REPOSITORY');

import type { Prisma, SceneImageStatus, StorySceneImage } from '@prisma/client';

export type SceneWithStory = StorySceneImage & {
  story: { id: string; title: string; textContent: string | null };
};

export interface SceneKeep {
  id: string;
  fromIndex: number;
  sceneIndex: number;
  prompt?: string;
  styleNotes?: string;
}

export interface SceneCreate {
  sceneIndex: number;
  startPage: number;
  endPage: number;
  textHash: string;
  prompt?: string;
  styleNotes?: string;
}

export interface SceneRetire {
  id: string;
  /** Soft-delete; when set, also move the row to this (negative) index to free its slot. */
  parkIndex: number | null;
}

export interface ScenePlan {
  keeps: SceneKeep[];
  creates: SceneCreate[];
  retires: SceneRetire[];
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
  /**
   * One transaction: park/soft-delete retired scenes, move kept scenes to their
   * new index (via a temporary index so the unique key never collides), create
   * new scenes.
   */
  applyPlan(storyId: string, plan: ScenePlan): Promise<void>;
  /**
   * Conditional update: applies `data` only if the row still matches `guard`
   * (compare-and-set). Returns the updated row, or null when the guard no
   * longer holds (a concurrent change won).
   */
  updateIf(
    id: string,
    guard: Prisma.StorySceneImageWhereInput,
    data: Prisma.StorySceneImageUncheckedUpdateInput,
  ): Promise<StorySceneImage | null>;
  listForReview(params: {
    status: SceneImageStatus;
    skip: number;
    take: number;
  }): Promise<{ items: SceneWithStory[]; total: number }>;
}

export const STORY_SCENE_REPOSITORY = Symbol('STORY_SCENE_REPOSITORY');

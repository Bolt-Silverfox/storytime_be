import type { Prisma } from '@prisma/client';

// ==================== Types ====================
export type StoryQuestionForAnswer = Prisma.StoryQuestionGetPayload<{
  select: { id: true; options: true; correctOption: true };
}>;

// ==================== Repository Interface ====================
export interface IStoryQuestionRepository {
  // Find a question (id, options, correctOption) used to validate an answer
  findQuestionForAnswer(id: string): Promise<StoryQuestionForAnswer | null>;
}

export const STORY_QUESTION_REPOSITORY = Symbol('STORY_QUESTION_REPOSITORY');

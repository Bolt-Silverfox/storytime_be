import type { QuestionAnswer, Prisma } from '@prisma/client';

// ==================== Types ====================
export type CreatedQuestionAnswer = Prisma.QuestionAnswerGetPayload<{
  select: { id: true; isCorrect: true };
}>;

// ==================== Repository Interface ====================
export interface IQuestionAnswerRepository {
  // Create a question answer, returning id + isCorrect
  createAnswer(
    data: Prisma.QuestionAnswerUncheckedCreateInput,
  ): Promise<CreatedQuestionAnswer>;

  // Find all answers for a kid answered on/after the given date
  findAnswersByKidSince(kidId: string, since: Date): Promise<QuestionAnswer[]>;

  // Whether the kid has already answered this question (any attempt)
  hasKidAnswered(kidId: string, questionId: string): Promise<boolean>;
}

export const QUESTION_ANSWER_REPOSITORY = Symbol('QUESTION_ANSWER_REPOSITORY');

import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import type {
  IQuestionAnswerRepository,
  CreatedQuestionAnswer,
} from './question-answer.repository.interface';
import type { QuestionAnswer, Prisma } from '@prisma/client';

@Injectable()
export class PrismaQuestionAnswerRepository implements IQuestionAnswerRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createAnswer(
    data: Prisma.QuestionAnswerUncheckedCreateInput,
  ): Promise<CreatedQuestionAnswer> {
    return this.prisma.questionAnswer.create({
      data,
      select: {
        id: true,
        isCorrect: true,
      },
    });
  }

  async findAnswersByKidSince(
    kidId: string,
    since: Date,
  ): Promise<QuestionAnswer[]> {
    return this.prisma.questionAnswer.findMany({
      where: {
        kidId,
        answeredAt: { gte: since },
      },
    });
  }

  async hasKidAnswered(kidId: string, questionId: string): Promise<boolean> {
    const existing = await this.prisma.questionAnswer.findFirst({
      where: { kidId, questionId },
      select: { id: true },
    });
    return existing !== null;
  }
}

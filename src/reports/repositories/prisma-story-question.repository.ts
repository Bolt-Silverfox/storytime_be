import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import type {
  IStoryQuestionRepository,
  StoryQuestionForAnswer,
} from './story-question.repository.interface';

@Injectable()
export class PrismaStoryQuestionRepository implements IStoryQuestionRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findQuestionForAnswer(
    id: string,
  ): Promise<StoryQuestionForAnswer | null> {
    return this.prisma.storyQuestion.findUnique({
      where: { id },
      select: {
        id: true,
        options: true,
        correctOption: true,
      },
    });
  }
}

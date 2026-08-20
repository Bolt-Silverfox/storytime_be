import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import type {
  IBuddyMessagingRepository,
  ChallengeContext,
  StoryContext,
} from './buddy-messaging.repository.interface';
import type { BuddyInteraction } from '@prisma/client';

@Injectable()
export class PrismaBuddyMessagingRepository implements IBuddyMessagingRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findChallengeContext(
    challengeId: string,
  ): Promise<ChallengeContext | null> {
    return this.prisma.dailyChallenge.findUnique({
      where: {
        id: challengeId,
        isDeleted: false,
      },
      select: { wordOfTheDay: true, meaning: true },
    });
  }

  async findStoryContext(storyId: string): Promise<StoryContext | null> {
    return this.prisma.story.findUnique({
      where: {
        id: storyId,
        isDeleted: false,
      },
      select: { title: true },
    });
  }

  async createBuddyInteraction(
    kidId: string,
    buddyId: string,
    interactionType: string,
    context?: string | null,
  ): Promise<BuddyInteraction> {
    return this.prisma.buddyInteraction.create({
      data: {
        kidId,
        buddyId,
        interactionType,
        context: context || null,
        message: null,
      },
    });
  }
}

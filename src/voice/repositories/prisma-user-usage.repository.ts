import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import type {
  IUserUsageRepository,
  UsageCounterField,
} from './user-usage.repository.interface';
import type { UserUsage } from '@prisma/client';

@Injectable()
export class PrismaUserUsageRepository implements IUserUsageRepository {
  constructor(private readonly prisma: PrismaService) {}

  async incrementCounterWithRollover(
    userId: string,
    currentMonth: string,
    field: UsageCounterField,
    amount: number,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.userUsage.updateMany({
        where: { userId, currentMonth: { not: currentMonth } },
        data: {
          currentMonth,
          elevenLabsCount: 0,
          geminiStoryCount: 0,
          geminiImageCount: 0,
        },
      });
      await tx.userUsage.upsert({
        where: { userId },
        create: { userId, currentMonth, [field]: amount },
        update: { currentMonth, [field]: { increment: amount } },
      });
    });
  }

  async decrementElevenLabsCreditsFloored(
    userId: string,
    credits: number,
  ): Promise<number> {
    // Atomic decrement floored at zero — avoids read-then-update race that
    // could push elevenLabsCount negative under concurrent requests.
    // Sync: references Prisma model UserUsage, columns elevenLabsCount and userId.
    return this.prisma
      .$executeRaw`UPDATE "user_usages" SET "elevenLabsCount" = GREATEST("elevenLabsCount" - ${credits}, 0) WHERE "userId" = ${userId}`;
  }

  async upsertEnsureExists(
    userId: string,
    currentMonth: string,
  ): Promise<UserUsage> {
    return this.prisma.userUsage.upsert({
      where: { userId },
      create: { userId, currentMonth },
      update: {},
    });
  }

  async lockSecondVoiceIfNull(
    userId: string,
    voiceUuid: string,
  ): Promise<{ count: number }> {
    return this.prisma.userUsage.updateMany({
      where: { userId, selectedSecondVoiceId: null },
      data: { selectedSecondVoiceId: voiceUuid },
    });
  }

  async lockTrialStoryIfNull(
    userId: string,
    storyId: string,
  ): Promise<{ count: number }> {
    return this.prisma.userUsage.updateMany({
      where: { userId, elevenLabsTrialStoryId: null },
      data: { elevenLabsTrialStoryId: storyId },
    });
  }

  async findByUserId(userId: string): Promise<UserUsage | null> {
    return this.prisma.userUsage.findUnique({
      where: { userId },
    });
  }

  async findSelectedSecondVoiceId(
    userId: string,
  ): Promise<{ selectedSecondVoiceId: string | null } | null> {
    return this.prisma.userUsage.findUnique({
      where: { userId },
      select: { selectedSecondVoiceId: true },
    });
  }
}

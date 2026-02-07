import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AiProviders } from '@/shared/constants/ai-providers.constants';
import { VOICE_CONFIG_SETTINGS } from './voice.config';
import { SUBSCRIPTION_STATUS } from '../subscription/subscription.constants';

@Injectable()
export class VoiceQuotaService {
  private readonly logger = new Logger(VoiceQuotaService.name);

  constructor(private readonly prisma: PrismaService) {}

  private getCurrentMonth(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }

  async checkUsage(userId: string): Promise<boolean> {
    const currentMonth = this.getCurrentMonth();

    // Single query: Get user with subscriptions AND usage in one call
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        subscriptions: {
          where: {
            status: SUBSCRIPTION_STATUS.ACTIVE,
            // Include lifetime subscriptions (null endsAt) and active ones
            OR: [{ endsAt: { gt: new Date() } }, { endsAt: null }],
          },
          take: 1, // Only need to know if one exists
        },
        usage: true,
      },
    });

    if (!user) return false;

    // Determine plan from included subscription
    const isPremium = user.subscriptions.length > 0;
    const limit = isPremium
      ? VOICE_CONFIG_SETTINGS.QUOTAS.PREMIUM
      : VOICE_CONFIG_SETTINGS.QUOTAS.FREE;

    // Atomic month reset and upsert using transaction
    const usage = await this.prisma.$transaction(async (tx) => {
      // Reset count if month changed (atomic conditional update)
      await tx.userUsage.updateMany({
        where: { userId, currentMonth: { not: currentMonth } },
        data: { currentMonth, elevenLabsCount: 0 },
      });
      // Upsert with non-empty update to ensure atomic behavior
      return tx.userUsage.upsert({
        where: { userId },
        create: { userId, currentMonth, elevenLabsCount: 0 },
        update: { currentMonth }, // Non-empty update for atomicity
      });
    });

    if (usage.elevenLabsCount >= limit) {
      this.logger.log(
        `User ${userId} exceeded ElevenLabs quota (${usage.elevenLabsCount}/${limit}).`,
      );
      return false;
    }

    return true;
  }

  async incrementUsage(userId: string): Promise<void> {
    await this.prisma.userUsage.update({
      where: { userId },
      data: {
        elevenLabsCount: { increment: 1 },
      },
    });
    await this.logAiActivity(
      userId,
      AiProviders.ElevenLabs,
      'voice_cloning',
      1,
    );
  }

  async trackGeminiStory(userId: string): Promise<void> {
    // Ensure usage record exists (in case it wasn't created by voice check)
    const currentMonth = this.getCurrentMonth();
    await this.prisma.userUsage.upsert({
      where: { userId },
      create: { userId, currentMonth, geminiStoryCount: 1 },
      update: { geminiStoryCount: { increment: 1 } },
    });
    await this.logAiActivity(userId, AiProviders.Gemini, 'story_generation', 1);
  }

  async trackGeminiImage(userId: string): Promise<void> {
    const currentMonth = this.getCurrentMonth();
    await this.prisma.userUsage.upsert({
      where: { userId },
      create: { userId, currentMonth, geminiImageCount: 1 },
      update: { geminiImageCount: { increment: 1 } },
    });

    await this.logAiActivity(userId, AiProviders.Gemini, 'image_generation', 1);
  }

  private async logAiActivity(
    userId: string,
    provider: string,
    type: string,
    credits: number,
  ) {
    try {
      await this.prisma.activityLog.create({
        data: {
          userId,
          action: 'AI_GENERATION',
          status: 'SUCCESS',
          details: JSON.stringify({ provider, type, credits }),
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to log AI activity for user ${userId}: ${error.message}`,
      );
    }
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AiProviders } from '@/shared/constants/ai-providers.constants';

/**
 * Tracks AI usage counters (ElevenLabs credits, Gemini story/image) with
 * monthly rollover, and records AI activity logs.
 *
 * Extracted verbatim from VoiceQuotaService — this is the usage-accounting
 * concern, kept independent of the access-control/locking logic.
 */
@Injectable()
export class VoiceUsageService {
  private readonly logger = new Logger(VoiceUsageService.name);

  constructor(private readonly prisma: PrismaService) {}

  getCurrentMonth(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }

  /**
   * Atomically increment a usage counter with monthly rollover.
   * When the stored month differs from the current month, ALL counters
   * are reset to zero (not just the one being incremented) so that
   * whichever counter triggers first in a new month performs a full reset.
   */
  private async incrementCounter(
    userId: string,
    field: 'elevenLabsCount' | 'geminiStoryCount' | 'geminiImageCount',
    amount: number,
  ): Promise<void> {
    const currentMonth = this.getCurrentMonth();
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

  async incrementUsage(userId: string): Promise<void> {
    await this.incrementCounter(userId, 'elevenLabsCount', 1);
    await this.logAiActivity(
      userId,
      AiProviders.ElevenLabs,
      'tts_generation',
      1,
    );
  }

  /**
   * Record ElevenLabs credit usage and track for analytics.
   * This method only increments counters — access control (premium
   * per-story limit, free-tier voice lock) is enforced by callers.
   */
  async recordUsage(userId: string, credits: number): Promise<number> {
    await this.incrementCounter(userId, 'elevenLabsCount', credits);
    await this.logAiActivity(
      userId,
      AiProviders.ElevenLabs,
      'tts_batch_reservation',
      credits,
    );
    return credits;
  }

  /**
   * Release previously reserved ElevenLabs credits (e.g. when batch
   * paragraphs fail after quota was reserved).
   */
  async releaseReservedUsage(userId: string, credits: number): Promise<void> {
    if (credits <= 0) return;
    // Atomic decrement floored at zero — avoids read-then-update race that
    // could push elevenLabsCount negative under concurrent requests.
    // Sync: references Prisma model UserUsage, columns elevenLabsCount and userId.
    const affected = await this.prisma
      .$executeRaw`UPDATE "user_usages" SET "elevenLabsCount" = GREATEST("elevenLabsCount" - ${credits}, 0) WHERE "userId" = ${userId}`;
    if (affected > 0) {
      this.logger.log(
        `Released up to ${credits} ElevenLabs credits for user ${userId}`,
      );
    }
  }

  async trackGeminiStory(userId: string): Promise<void> {
    await this.incrementCounter(userId, 'geminiStoryCount', 1);
    await this.logAiActivity(userId, AiProviders.Gemini, 'story_generation', 1);
  }

  async trackGeminiImage(userId: string): Promise<void> {
    await this.incrementCounter(userId, 'geminiImageCount', 1);
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
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to log AI activity for user ${userId}: ${errorMessage}`,
      );
    }
  }
}

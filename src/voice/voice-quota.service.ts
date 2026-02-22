import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AiProviders } from '@/shared/constants/ai-providers.constants';
import { VOICE_CONFIG_SETTINGS } from './voice.config';
import { SUBSCRIPTION_STATUS } from '../subscription/subscription.constants';
import { FREE_TIER_LIMITS } from '@/shared/constants/free-tier.constants';
import { VOICE_CONFIG } from './voice.constants';

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

    // Single query: Get user with subscription AND usage in one call
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        subscription: true,
        usage: true,
      },
    });

    if (!user) return false;

    // Determine if user has active premium subscription
    const now = new Date();
    const isPremium =
      user.subscription?.status === SUBSCRIPTION_STATUS.ACTIVE &&
      (user.subscription.endsAt === null || user.subscription.endsAt > now);
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
    const currentMonth = this.getCurrentMonth();
    // Use transaction to handle month rollover atomically (matches checkUsage pattern)
    await this.prisma.$transaction(async (tx) => {
      await tx.userUsage.updateMany({
        where: { userId, currentMonth: { not: currentMonth } },
        data: { currentMonth, elevenLabsCount: 0 },
      });
      await tx.userUsage.upsert({
        where: { userId },
        create: { userId, currentMonth, elevenLabsCount: 1 },
        update: { currentMonth, elevenLabsCount: { increment: 1 } },
      });
    });
    await this.logAiActivity(
      userId,
      AiProviders.ElevenLabs,
      'tts_generation',
      1,
    );
  }

  async trackGeminiStory(userId: string): Promise<void> {
    const currentMonth = this.getCurrentMonth();
    // Use transaction to handle monthly rollover for Gemini counters
    await this.prisma.$transaction(async (tx) => {
      // Reset Gemini counters if month changed
      await tx.userUsage.updateMany({
        where: { userId, currentMonth: { not: currentMonth } },
        data: { currentMonth, geminiStoryCount: 0, geminiImageCount: 0 },
      });
      await tx.userUsage.upsert({
        where: { userId },
        create: { userId, currentMonth, geminiStoryCount: 1 },
        update: { currentMonth, geminiStoryCount: { increment: 1 } },
      });
    });
    await this.logAiActivity(userId, AiProviders.Gemini, 'story_generation', 1);
  }

  async trackGeminiImage(userId: string): Promise<void> {
    const currentMonth = this.getCurrentMonth();
    // Use transaction to handle monthly rollover for Gemini counters
    await this.prisma.$transaction(async (tx) => {
      // Reset Gemini counters if month changed
      await tx.userUsage.updateMany({
        where: { userId, currentMonth: { not: currentMonth } },
        data: { currentMonth, geminiStoryCount: 0, geminiImageCount: 0 },
      });
      await tx.userUsage.upsert({
        where: { userId },
        create: { userId, currentMonth, geminiImageCount: 1 },
        update: { currentMonth, geminiImageCount: { increment: 1 } },
      });
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
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to log AI activity for user ${userId}: ${errorMessage}`,
      );
    }
  }

  // ========== FREE TIER VOICE LIMITS ==========

  /**
   * Check if a user can use a specific voice
   * Premium users can use any voice
   * Free users can only use the default voice (LILY)
   */
  async canUseVoice(userId: string, voiceId: string): Promise<boolean> {
    const isPremium = await this.isPremiumUser(userId);
    if (isPremium) return true;

    const defaultVoiceType = FREE_TIER_LIMITS.VOICES.DEFAULT_VOICE;

    // Check if it's the default voice (by VoiceType enum or elevenLabsId)
    if (voiceId === (defaultVoiceType as string)) return true;
    const defaultVoiceConfig = VOICE_CONFIG[defaultVoiceType];
    if (defaultVoiceConfig && voiceId === defaultVoiceConfig.elevenLabsId)
      return true;

    // Check if voiceId is a UUID that matches the default voice in the database
    if (defaultVoiceConfig) {
      const voiceRecord = await this.prisma.voice.findUnique({
        where: { id: voiceId },
      });
      if (voiceRecord?.elevenLabsVoiceId === defaultVoiceConfig.elevenLabsId) {
        return true;
      }
    }

    return false;
  }

  /**
   * Get voice access info for a user
   */
  async getVoiceAccess(userId: string): Promise<{
    isPremium: boolean;
    unlimited: boolean;
    defaultVoice: string;
    maxVoices: number;
  }> {
    const isPremium = await this.isPremiumUser(userId);

    if (isPremium) {
      return {
        isPremium: true,
        unlimited: true,
        defaultVoice: FREE_TIER_LIMITS.VOICES.DEFAULT_VOICE,
        maxVoices: -1, // unlimited
      };
    }

    return {
      isPremium: false,
      unlimited: false,
      defaultVoice: FREE_TIER_LIMITS.VOICES.DEFAULT_VOICE,
      maxVoices: FREE_TIER_LIMITS.VOICES.CUSTOM_SLOTS + 1,
    };
  }

  /**
   * Check if user has an active premium subscription
   */
  async isPremiumUser(userId: string): Promise<boolean> {
    const subscription = await this.prisma.subscription.findFirst({
      where: {
        userId,
        status: SUBSCRIPTION_STATUS.ACTIVE,
        OR: [{ endsAt: { gt: new Date() } }, { endsAt: null }],
      },
    });

    return !!subscription;
  }
}

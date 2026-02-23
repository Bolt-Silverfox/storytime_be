import { Injectable, Logger } from '@nestjs/common';
import { ErrorHandler } from '@/shared/utils/error-handler.util';
import { DateFormatUtil } from '@/shared/utils/date-format.util';
import { PrismaService } from '../prisma/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AiProviders } from '@/shared/constants/ai-providers.constants';
import { VOICE_CONFIG_SETTINGS } from './voice.config';
import { SubscriptionService } from '../subscription/subscription.service';
import { SUBSCRIPTION_STATUS } from '../subscription/subscription.constants';
import { FREE_TIER_LIMITS } from '@/shared/constants/free-tier.constants';
import { VOICE_CONFIG } from './voice.constants';
import {
  AppEvents,
  AiUsageTrackedEvent,
  QuotaExhaustedEvent,
  QuotaTypes,
} from '@/shared/events';

@Injectable()
export class VoiceQuotaService {
  private readonly logger = new Logger(VoiceQuotaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
    private readonly subscriptionService: SubscriptionService,
  ) {}

  async checkUsage(userId: string): Promise<boolean> {
    const currentMonth = DateFormatUtil.getCurrentMonthString();

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

      // Emit quota exhausted event
      this.eventEmitter.emit(AppEvents.QUOTA_EXHAUSTED, {
        userId,
        quotaType: QuotaTypes.VOICE,
        used: usage.elevenLabsCount,
        limit,
        exhaustedAt: new Date(),
      } satisfies QuotaExhaustedEvent);

      return false;
    }

    return true;
  }

  async incrementUsage(userId: string): Promise<void> {
    const currentMonth = DateFormatUtil.getCurrentMonthString();
    await this.prisma.userUsage.upsert({
      where: { userId },
      create: {
        userId,
        currentMonth,
        elevenLabsCount: 1,
      },
      update: {
        elevenLabsCount: { increment: 1 },
      },
    });
    this.eventEmitter.emit(AppEvents.AI_USAGE_TRACKED, {
      userId,
      provider: AiProviders.ElevenLabs,
      type: 'voice_cloning',
      credits: 1,
      trackedAt: new Date(),
    } satisfies AiUsageTrackedEvent);
  }

  async trackGeminiStory(userId: string): Promise<void> {
    const currentMonth = DateFormatUtil.getCurrentMonthString();
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
    this.eventEmitter.emit(AppEvents.AI_USAGE_TRACKED, {
      userId,
      provider: AiProviders.Gemini,
      type: 'story_generation',
      credits: 1,
      trackedAt: new Date(),
    } satisfies AiUsageTrackedEvent);
  }

  async trackGeminiImage(userId: string): Promise<void> {
    const currentMonth = DateFormatUtil.getCurrentMonthString();
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
    this.eventEmitter.emit(AppEvents.AI_USAGE_TRACKED, {
      userId,
      provider: AiProviders.Gemini,
      type: 'image_generation',
      credits: 1,
      trackedAt: new Date(),
    } satisfies AiUsageTrackedEvent);
  }

  // ========== FREE TIER VOICE LIMITS ==========

  /**
   * Check if a user can use a specific voice
   * Premium users can use any voice
   * Free users can only use DEFAULT_VOICE + their selected second voice
   */
  async canUseVoice(userId: string, voiceId: string): Promise<boolean> {
    const isPremium = await this.subscriptionService.isPremiumUser(userId);
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

    // Check if it's their selected second voice
    const usage = await this.prisma.userUsage.findUnique({
      where: { userId },
    });

    if (!usage?.selectedSecondVoiceId) return false;

    // Check if voiceId matches the selected second voice (by ID or elevenLabsId)
    if (usage.selectedSecondVoiceId === voiceId) return true;

    // Also check if it matches via the Voice table
    const selectedVoice = await this.prisma.voice.findUnique({
      where: { id: usage.selectedSecondVoiceId },
    });

    return selectedVoice?.elevenLabsVoiceId === voiceId;
  }

  /**
   * Get voice access info for a user
   */
  async getVoiceAccess(userId: string): Promise<{
    isPremium: boolean;
    unlimited: boolean;
    defaultVoice: string;
    selectedSecondVoice: string | null;
    maxVoices: number;
  }> {
    const isPremium = await this.subscriptionService.isPremiumUser(userId);

    if (isPremium) {
      return {
        isPremium: true,
        unlimited: true,
        defaultVoice: FREE_TIER_LIMITS.VOICES.DEFAULT_VOICE,
        selectedSecondVoice: null,
        maxVoices: -1, // unlimited
      };
    }

    const usage = await this.prisma.userUsage.findUnique({
      where: { userId },
    });

    return {
      isPremium: false,
      unlimited: false,
      defaultVoice: FREE_TIER_LIMITS.VOICES.DEFAULT_VOICE,
      selectedSecondVoice: usage?.selectedSecondVoiceId ?? null,
      maxVoices: 1 + FREE_TIER_LIMITS.VOICES.CUSTOM_SLOTS, // default + 1 custom
    };
  }

}

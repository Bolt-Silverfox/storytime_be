import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionService } from '../subscription/subscription.service';
import { AiProviders } from '@/shared/constants/ai-providers.constants';
import { VOICE_CONFIG_SETTINGS } from './voice.config';
import { FREE_TIER_LIMITS } from '@/shared/constants/free-tier.constants';
import { VOICE_CONFIG } from './voice.constants';

@Injectable()
export class VoiceQuotaService {
  private readonly logger = new Logger(VoiceQuotaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptionService: SubscriptionService,
  ) {}

  private getCurrentMonth(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }

  /**
   * Check if a user is allowed to use ElevenLabs (per-call check).
   * Premium users always pass — their limits are per-story via canUseVoiceForStory().
   * Free users are not checked here — they go through canFreeUserUseElevenLabs() instead.
   */
  async checkUsage(userId: string): Promise<boolean> {
    const isPremium = await this.subscriptionService.isPremiumUser(userId);
    return isPremium;
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

  /**
   * Atomically check remaining ElevenLabs quota and reserve credits.
   * Returns the number of credits actually reserved (may be less than
   * requested if the user doesn't have enough remaining).
   */
  async checkAndReserveUsage(userId: string, credits: number): Promise<number> {
    const currentMonth = this.getCurrentMonth();

    const isPremium = await this.subscriptionService.isPremiumUser(userId);

    // Premium users have no monthly quota — grant all requested credits.
    // Per-story voice limits are enforced separately via canUseVoiceForStory().
    if (isPremium) {
      // Still track usage for analytics, but don't cap it
      await this.prisma.$transaction(async (tx) => {
        await tx.userUsage.updateMany({
          where: { userId, currentMonth: { not: currentMonth } },
          data: { currentMonth, elevenLabsCount: 0 },
        });
        await tx.userUsage.upsert({
          where: { userId },
          create: { userId, currentMonth, elevenLabsCount: credits },
          update: {
            currentMonth,
            elevenLabsCount: { increment: credits },
          },
        });
      });
      await this.logAiActivity(
        userId,
        AiProviders.ElevenLabs,
        'tts_batch_reservation',
        credits,
      );
      return credits;
    }

    // Free users who pass the voice check get all credits (no monthly cap).
    // Their access is gated by canFreeUserUseElevenLabs() instead.
    await this.prisma.$transaction(async (tx) => {
      await tx.userUsage.updateMany({
        where: { userId, currentMonth: { not: currentMonth } },
        data: { currentMonth, elevenLabsCount: 0 },
      });
      await tx.userUsage.upsert({
        where: { userId },
        create: { userId, currentMonth, elevenLabsCount: credits },
        update: {
          currentMonth,
          elevenLabsCount: { increment: credits },
        },
      });
    });
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

  /**
   * Check if a premium user can use a specific voice for a story.
   * Premium users are limited to MAX_PREMIUM_VOICES_PER_STORY distinct
   * premium voices per story. If the voice is already cached for this
   * story, it's always allowed (no new cost). Otherwise, check how many
   * distinct voices already have cached audio for this story.
   */
  async canUseVoiceForStory(
    storyId: string,
    voiceId: string,
  ): Promise<boolean> {
    const limit = VOICE_CONFIG_SETTINGS.QUOTAS.MAX_PREMIUM_VOICES_PER_STORY;

    const distinctVoices: Array<{ voiceId: string }> = await this.prisma
      .$queryRaw`SELECT DISTINCT "voiceId" FROM "paragraph_audio_cache" WHERE "storyId" = ${storyId}`;

    const cachedVoiceIds = distinctVoices.map((v) => v.voiceId);

    // Already cached for this story — always allowed (zero cost)
    if (cachedVoiceIds.includes(voiceId)) {
      return true;
    }

    // New voice — only allow if under the limit
    if (cachedVoiceIds.length >= limit) {
      this.logger.log(
        `Story ${storyId} already has ${cachedVoiceIds.length} distinct voices (limit ${limit}). Denying voice ${voiceId}.`,
      );
      return false;
    }

    return true;
  }

  /**
   * Check if a free user can use ElevenLabs for a given voice.
   * Free users get 1 premium voice total (across all stories).
   * Once they use a premium voice, it's locked in via selectedSecondVoiceId.
   * If they haven't used one yet, allow and lock it in.
   */
  async canFreeUserUseElevenLabs(
    userId: string,
    voiceId: string,
  ): Promise<boolean> {
    const currentMonth = this.getCurrentMonth();
    const usage = await this.prisma.userUsage.upsert({
      where: { userId },
      create: { userId, currentMonth },
      update: {},
    });

    // Never used a premium voice — allow and lock this one in
    if (!usage.selectedSecondVoiceId) {
      await this.prisma.userUsage.update({
        where: { userId },
        data: { selectedSecondVoiceId: voiceId },
      });
      this.logger.log(`Free user ${userId} locked in premium voice ${voiceId}`);
      return true;
    }

    // Same voice they already picked — allow
    if (usage.selectedSecondVoiceId === voiceId) {
      return true;
    }

    // Different voice — deny
    this.logger.log(
      `Free user ${userId} already used premium voice ${usage.selectedSecondVoiceId}. Denying ${voiceId}.`,
    );
    return false;
  }

  // ========== FREE TIER VOICE LIMITS ==========

  /**
   * Check if a user can use a specific voice
   * Premium users can use any voice
   * Free users can use the default voice (LILY) + their one locked-in premium voice
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

    // Check if this is the free user's locked-in premium voice
    const usage = await this.prisma.userUsage.findUnique({
      where: { userId },
    });
    if (usage?.selectedSecondVoiceId === voiceId) {
      return true;
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
    const isPremium = await this.subscriptionService.isPremiumUser(userId);

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
      maxVoices: FREE_TIER_LIMITS.VOICES.CUSTOM_SLOTS + 1, // +1 for the always-available default voice
    };
  }
}

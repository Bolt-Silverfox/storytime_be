import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionService } from '../subscription/subscription.service';
import { AiProviders } from '@/shared/constants/ai-providers.constants';
import { VOICE_CONFIG_SETTINGS } from './voice.config';
import { FREE_TIER_LIMITS } from '@/shared/constants/free-tier.constants';
import { VOICE_CONFIG } from './voice.constants';
import { VoiceType } from './dto/voice.dto';

@Injectable()
export class VoiceQuotaService {
  private readonly logger = new Logger(VoiceQuotaService.name);

  /**
   * Map a stored voiceId (VoiceType enum, UUID, or elevenLabsId) to
   * its canonical ElevenLabs voice ID so comparisons are consistent.
   */
  async resolveCanonicalVoiceId(voiceId: string): Promise<string> {
    // Already a VoiceType enum key → look up elevenLabsId
    if (Object.values(VoiceType).includes(voiceId as VoiceType)) {
      return VOICE_CONFIG[voiceId as VoiceType].elevenLabsId;
    }
    // Could be a UUID from the Voice table
    const voice = await this.prisma.voice.findUnique({
      where: { id: voiceId, isDeleted: false },
    });
    if (voice?.elevenLabsVoiceId) {
      return voice.elevenLabsVoiceId;
    }
    // Already an elevenLabsId or unknown — return as-is
    return voiceId;
  }

  /**
   * Resolve an ElevenLabs voice ID to the Voice table UUID.
   * Returns null if no matching voice record is found.
   */
  private async resolveVoiceUuid(
    elevenLabsVoiceId: string,
  ): Promise<string | null> {
    const voice = await this.prisma.voice.findFirst({
      where: { elevenLabsVoiceId, isDeleted: false },
      select: { id: true },
    });
    return voice?.id ?? null;
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptionService: SubscriptionService,
  ) {}

  private getCurrentMonth(): string {
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

    // Normalize cached voiceIds to canonical elevenLabsId form so that
    // VoiceType enum names, UUIDs, and elevenLabsIds all compare correctly.
    // Batch UUID lookups to avoid N+1 queries.
    const uuidCandidates = distinctVoices
      .map((v) => v.voiceId)
      .filter((id) => !Object.values(VoiceType).includes(id as VoiceType));

    const voiceRecords =
      uuidCandidates.length > 0
        ? await this.prisma.voice.findMany({
            where: { id: { in: uuidCandidates }, isDeleted: false },
            select: { id: true, elevenLabsVoiceId: true },
          })
        : [];
    const uuidToElevenLabs = new Map(
      voiceRecords
        .filter((v) => v.elevenLabsVoiceId)
        .map((v) => [v.id, v.elevenLabsVoiceId!]),
    );

    const canonicalCachedIds = distinctVoices.map((v) => {
      if (Object.values(VoiceType).includes(v.voiceId as VoiceType)) {
        return VOICE_CONFIG[v.voiceId as VoiceType].elevenLabsId;
      }
      return uuidToElevenLabs.get(v.voiceId) ?? v.voiceId;
    });
    const uniqueCachedIds = [...new Set(canonicalCachedIds)];

    // Normalize the incoming voiceId the same way cached IDs are resolved
    const canonicalVoiceId = await this.resolveCanonicalVoiceId(voiceId);

    // Already cached for this story — always allowed (zero cost)
    if (uniqueCachedIds.includes(canonicalVoiceId)) {
      return true;
    }

    // New voice — only allow if under the limit
    if (uniqueCachedIds.length >= limit) {
      this.logger.log(
        `Story ${storyId} already has ${uniqueCachedIds.length} distinct voices (limit ${limit}). Denying voice ${voiceId}.`,
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
   *
   * The default voice (LILY) is always allowed and never consumes the slot.
   * Locking uses an atomic compare-and-set (updateMany with
   * selectedSecondVoiceId: null) to prevent races.
   */
  async canFreeUserUseElevenLabs(
    userId: string,
    elevenLabsVoiceId: string,
  ): Promise<boolean> {
    // Default voice is always allowed — don't consume the premium slot
    const defaultVoiceType = FREE_TIER_LIMITS.VOICES.DEFAULT_VOICE;
    if (elevenLabsVoiceId === (defaultVoiceType as string)) return true;
    const defaultConfig = VOICE_CONFIG[defaultVoiceType];
    if (defaultConfig && elevenLabsVoiceId === defaultConfig.elevenLabsId)
      return true;

    // Resolve ElevenLabs ID to Voice table UUID for FK-safe storage.
    // selectedSecondVoiceId has a FK constraint referencing voices.id.
    const voiceUuid = await this.resolveVoiceUuid(elevenLabsVoiceId);
    if (!voiceUuid) {
      this.logger.warn(
        `No voice record found for ElevenLabs ID ${elevenLabsVoiceId}. Denying free-tier premium voice.`,
      );
      return false;
    }

    const currentMonth = this.getCurrentMonth();
    const usage = await this.prisma.userUsage.upsert({
      where: { userId },
      create: { userId, currentMonth },
      update: {},
    });

    // Same voice they already picked — allow (compare UUIDs)
    if (usage.selectedSecondVoiceId === voiceUuid) {
      return true;
    }

    // Already locked a different voice — deny
    if (usage.selectedSecondVoiceId) {
      this.logger.log(
        `Free user ${userId} already used premium voice ${usage.selectedSecondVoiceId}. Denying ${elevenLabsVoiceId}.`,
      );
      return false;
    }

    // Never used a premium voice — atomic compare-and-set to lock this one in.
    // Only updates if selectedSecondVoiceId is still null, preventing races.
    // Stores the Voice table UUID (not ElevenLabs ID) to satisfy FK constraint.
    const { count } = await this.prisma.userUsage.updateMany({
      where: { userId, selectedSecondVoiceId: null },
      data: { selectedSecondVoiceId: voiceUuid },
    });

    if (count > 0) {
      this.logger.log(
        `Free user ${userId} locked in premium voice ${voiceUuid} (${elevenLabsVoiceId})`,
      );
      return true;
    }

    // Another request raced and locked a different voice — re-check
    const updated = await this.prisma.userUsage.findUnique({
      where: { userId },
    });
    if (updated?.selectedSecondVoiceId === voiceUuid) {
      return true;
    }

    this.logger.log(
      `Free user ${userId} lost race — premium voice ${updated?.selectedSecondVoiceId} was locked by concurrent request. Denying ${elevenLabsVoiceId}.`,
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

    // Resolve the requested voice to its canonical ElevenLabs ID
    const requestedCanonical = await this.resolveCanonicalVoiceId(voiceId);

    // Check if it's the default voice
    const defaultConfig = VOICE_CONFIG[FREE_TIER_LIMITS.VOICES.DEFAULT_VOICE];
    if (requestedCanonical === defaultConfig.elevenLabsId) return true;

    // Check if this is the free user's locked-in premium voice.
    // selectedSecondVoiceId stores a Voice table UUID, so resolve it
    // to canonical ElevenLabs ID for consistent comparison.
    const usage = await this.prisma.userUsage.findUnique({
      where: { userId },
    });
    if (usage?.selectedSecondVoiceId) {
      const lockedCanonical = await this.resolveCanonicalVoiceId(
        usage.selectedSecondVoiceId,
      );
      if (lockedCanonical === requestedCanonical) return true;
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

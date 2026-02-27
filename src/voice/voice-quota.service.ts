import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionService } from '../subscription/subscription.service';
import { AiProviders } from '@/shared/constants/ai-providers.constants';
import { VOICE_CONFIG_SETTINGS } from './voice.config';
import { FREE_TIER_LIMITS } from '@/shared/constants/free-tier.constants';
import { VOICE_CONFIG } from './voice.constants';
import { VoiceType, VOICE_TYPE_MIGRATION_MAP } from './dto/voice.dto';

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
    // Check migration map for old enum names (CHARLIE → MILO, etc.)
    const migrated = VOICE_TYPE_MIGRATION_MAP[voiceId];
    if (migrated) {
      return VOICE_CONFIG[migrated].elevenLabsId;
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
   * If no DB row exists but the ID belongs to a known system voice,
   * auto-creates the row so voice locking works without manual seeding.
   */
  private async resolveVoiceUuid(
    elevenLabsVoiceId: string,
  ): Promise<string | null> {
    const voice = await this.prisma.voice.findFirst({
      where: { elevenLabsVoiceId, isDeleted: false, userId: null },
      select: { id: true },
    });
    if (voice) return voice.id;

    // Auto-seed from VOICE_CONFIG if this is a known system voice
    const configEntry = Object.entries(VOICE_CONFIG).find(
      ([, config]) => config.elevenLabsId === elevenLabsVoiceId,
    );
    if (!configEntry) return null;

    const [key, config] = configEntry;
    const created = await this.prisma.voice.create({
      data: {
        elevenLabsVoiceId: config.elevenLabsId,
        name: key,
        type: 'elevenlabs',
        voiceAvatar: config.voiceAvatar,
        url: config.previewUrl,
        isDeleted: false,
        userId: null,
      },
      select: { id: true },
    });
    this.logger.log(
      `Auto-seeded voice ${key} (${elevenLabsVoiceId}) with UUID ${created.id}`,
    );
    return created.id;
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
      .filter(
        (id) =>
          !Object.values(VoiceType).includes(id as VoiceType) &&
          !(id in VOICE_TYPE_MIGRATION_MAP),
      );

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
      const migrated = VOICE_TYPE_MIGRATION_MAP[v.voiceId];
      if (migrated) {
        return VOICE_CONFIG[migrated].elevenLabsId;
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

  // Check if a free user can use ElevenLabs for a given voice.
  // Free users get ONE voice total. Once locked via selectedSecondVoiceId,
  // only that voice is allowed. Locking uses atomic compare-and-set to prevent races.
  // ElevenLabs is only available for their first story (trial). After that,
  // the same locked voice is rendered via Deepgram/Edge TTS.
  async canFreeUserUseElevenLabs(
    userId: string,
    elevenLabsVoiceId: string,
    storyId: string,
  ): Promise<boolean> {
    // Ensure usage record exists
    const currentMonth = this.getCurrentMonth();
    const usage = await this.prisma.userUsage.upsert({
      where: { userId },
      create: { userId, currentMonth },
      update: {},
    });

    // === Voice locking check ===
    // Resolve ElevenLabs ID to Voice table UUID for FK-safe storage.
    // selectedSecondVoiceId has a FK constraint referencing voices.id.
    const voiceUuid = await this.resolveVoiceUuid(elevenLabsVoiceId);
    if (!voiceUuid) {
      this.logger.warn(
        `No voice record found for ElevenLabs ID ${elevenLabsVoiceId}. Denying free-tier voice.`,
      );
      return false;
    }

    if (usage.selectedSecondVoiceId === voiceUuid) {
      // This is the locked voice — proceed to trial check
    } else if (usage.selectedSecondVoiceId) {
      // Already locked a different voice — deny
      this.logger.log(
        `Free user ${userId} already locked voice ${usage.selectedSecondVoiceId}. Denying ${elevenLabsVoiceId}.`,
      );
      return false;
    } else {
      // No voice locked yet — atomic compare-and-set to lock this one in.
      const { count } = await this.prisma.userUsage.updateMany({
        where: { userId, selectedSecondVoiceId: null },
        data: { selectedSecondVoiceId: voiceUuid },
      });

      if (count > 0) {
        this.logger.log(
          `Free user ${userId} locked voice ${voiceUuid} (${elevenLabsVoiceId})`,
        );
      } else {
        // Another request raced and locked a different voice — re-check
        const updated = await this.prisma.userUsage.findUnique({
          where: { userId },
        });
        if (updated?.selectedSecondVoiceId !== voiceUuid) {
          this.logger.log(
            `Free user ${userId} lost race — voice ${updated?.selectedSecondVoiceId} was locked by concurrent request. Denying ${elevenLabsVoiceId}.`,
          );
          return false;
        }
      }
    }

    // === ElevenLabs trial story check ===
    // Same trial story — allow ElevenLabs
    if (usage.elevenLabsTrialStoryId === storyId) {
      return true;
    }

    // Already used trial on a different story — deny ElevenLabs (will fall through to Deepgram/Edge)
    if (usage.elevenLabsTrialStoryId) {
      this.logger.log(
        `Free user ${userId} already used ElevenLabs trial on story ${usage.elevenLabsTrialStoryId}. Denying for story ${storyId}.`,
      );
      return false;
    }

    // No trial used yet — atomic lock to this story
    const { count: trialCount } = await this.prisma.userUsage.updateMany({
      where: { userId, elevenLabsTrialStoryId: null },
      data: { elevenLabsTrialStoryId: storyId },
    });

    if (trialCount > 0) {
      this.logger.log(
        `Free user ${userId} locked ElevenLabs trial to story ${storyId}`,
      );
      return true;
    }

    // Lost race — check if same story won
    const raceCheck = await this.prisma.userUsage.findUnique({
      where: { userId },
    });
    if (raceCheck?.elevenLabsTrialStoryId === storyId) {
      return true;
    }

    this.logger.log(
      `Free user ${userId} lost ElevenLabs trial race — story ${raceCheck?.elevenLabsTrialStoryId} won. Denying story ${storyId}.`,
    );
    return false;
  }

  // ========== FREE TIER VOICE LIMITS ==========

  // Check if a user can use a specific voice.
  // Premium users can use any voice.
  // Free users get ONE voice total — once locked, only that voice is allowed.
  // Falls back to preferredVoiceId for existing users who picked a voice
  // before the locking mechanism was added.
  async canUseVoice(userId: string, voiceId: string): Promise<boolean> {
    const isPremium = await this.subscriptionService.isPremiumUser(userId);
    if (isPremium) return true;

    const requestedCanonical = await this.resolveCanonicalVoiceId(voiceId);

    const usage = await this.prisma.userUsage.findUnique({
      where: { userId },
    });

    // Check explicit lock first
    if (usage?.selectedSecondVoiceId) {
      const lockedCanonical = await this.resolveCanonicalVoiceId(
        usage.selectedSecondVoiceId,
      );
      return lockedCanonical === requestedCanonical;
    }

    // Fall back to preferredVoiceId for legacy users
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { preferredVoiceId: true },
    });

    if (user?.preferredVoiceId) {
      const preferredCanonical = await this.resolveCanonicalVoiceId(
        user.preferredVoiceId,
      );
      return preferredCanonical === requestedCanonical;
    }

    // No voice locked yet — allow any (locking happens downstream in canFreeUserUseElevenLabs)
    return true;
  }

  // Lock a free user's voice in UserUsage.selectedSecondVoiceId.
  // Called from setPreferredVoice so the lock takes effect immediately
  // (not deferred to TTS generation).
  // Uses compare-and-set: only locks when selectedSecondVoiceId is null.
  // Returns true if locked successfully, false if CAS failed or voice not found.
  async lockFreeUserVoice(userId: string, voiceId: string): Promise<boolean> {
    const canonicalId = await this.resolveCanonicalVoiceId(voiceId);
    const voiceUuid = await this.resolveVoiceUuid(canonicalId);
    if (!voiceUuid) {
      this.logger.warn(
        `No voice record found for ElevenLabs ID ${canonicalId}. Skipping lock for user ${userId}.`,
      );
      return false;
    }

    const currentMonth = this.getCurrentMonth();

    // Ensure the usage record exists (without setting the lock)
    await this.prisma.userUsage.upsert({
      where: { userId },
      create: { userId, currentMonth },
      update: {},
    });

    // Atomic compare-and-set: only set if currently null
    const { count } = await this.prisma.userUsage.updateMany({
      where: { userId, selectedSecondVoiceId: null },
      data: { selectedSecondVoiceId: voiceUuid },
    });

    if (count > 0) {
      this.logger.log(
        `Locked free user ${userId} voice to ${voiceUuid} via setPreferredVoice`,
      );
      return true;
    }

    // CAS returned 0 — could be a benign race where the same voice was locked concurrently
    const current = await this.prisma.userUsage.findUnique({
      where: { userId },
      select: { selectedSecondVoiceId: true },
    });
    if (current?.selectedSecondVoiceId === voiceUuid) {
      return true;
    }

    this.logger.warn(
      `CAS failed: free user ${userId} voice already locked to ${current?.selectedSecondVoiceId}. Requested ${voiceUuid}.`,
    );
    return false;
  }

  // Get voice access info for a user
  async getVoiceAccess(userId: string): Promise<{
    isPremium: boolean;
    unlimited: boolean;
    defaultVoice: string;
    maxVoices: number;
    lockedVoiceId: string | null;
    elevenLabsTrialStoryId: string | null;
  }> {
    const isPremium = await this.subscriptionService.isPremiumUser(userId);

    if (isPremium) {
      return {
        isPremium: true,
        unlimited: true,
        defaultVoice: FREE_TIER_LIMITS.VOICES.DEFAULT_VOICE,
        maxVoices: -1, // unlimited
        lockedVoiceId: null,
        elevenLabsTrialStoryId: null,
      };
    }

    const [usage, user] = await Promise.all([
      this.prisma.userUsage.findUnique({ where: { userId } }),
      this.prisma.user.findUnique({
        where: { id: userId },
        include: { preferredVoice: true },
      }),
    ]);

    // Explicit TTS lock takes priority, fall back to preferredVoiceId
    // for existing users who picked a voice before locking was added
    const lockedUuid =
      usage?.selectedSecondVoiceId ?? user?.preferredVoiceId ?? null;

    // Resolve UUID to VoiceType key so mobile can match against available voices
    let lockedVoiceId: string | null = null;
    if (lockedUuid) {
      // Determine source of locked voice: explicit lock vs user preference
      let lockedVoice: { elevenLabsVoiceId: string | null } | null = null;
      if (lockedUuid === usage?.selectedSecondVoiceId) {
        lockedVoice = await this.prisma.voice.findFirst({
          where: { id: lockedUuid, isDeleted: false },
          select: { elevenLabsVoiceId: true },
        });
      } else if (user?.preferredVoice) {
        lockedVoice = {
          elevenLabsVoiceId: user.preferredVoice.elevenLabsVoiceId,
        };
      }

      const elevenLabsId = lockedVoice?.elevenLabsVoiceId;
      // Find the VoiceType key whose config matches this elevenLabsId
      const voiceTypeKey = elevenLabsId
        ? (Object.entries(VOICE_CONFIG).find(
            ([, config]) => config.elevenLabsId === elevenLabsId,
          )?.[0] ?? null)
        : null;

      // Report the locked voice — free users get ONE voice total
      if (voiceTypeKey) {
        lockedVoiceId = voiceTypeKey;
      } else if (lockedUuid) {
        // UUID didn't resolve to a known VoiceType — still report it
        lockedVoiceId = lockedUuid;
      }
    }

    return {
      isPremium: false,
      unlimited: false,
      defaultVoice: FREE_TIER_LIMITS.VOICES.DEFAULT_VOICE,
      maxVoices: 1, // free users get ONE voice total
      lockedVoiceId,
      elevenLabsTrialStoryId: usage?.elevenLabsTrialStoryId ?? null,
    };
  }
}

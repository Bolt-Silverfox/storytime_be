import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
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
    const currentMonth = this.getCurrentMonth();
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

  // ========== FREE TIER VOICE LIMITS ==========

  /**
   * Check if a user can use a specific voice
   * Premium users can use any voice
   * Free users can only use DEFAULT_VOICE + their selected second voice
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
   * Set the second voice for a free user
   */
  async setSecondVoice(userId: string, voiceId: string): Promise<void> {
    const isPremium = await this.isPremiumUser(userId);
    if (isPremium) {
      throw new BadRequestException(
        'Premium users have unlimited voice access and do not need to set a second voice',
      );
    }

    // Validate voice exists
    const voice = await this.prisma.voice.findUnique({
      where: { id: voiceId },
    });
    if (!voice) {
      throw new NotFoundException('Voice not found');
    }

    const currentMonth = this.getCurrentMonth();
    await this.prisma.userUsage.upsert({
      where: { userId },
      create: {
        userId,
        currentMonth,
        selectedSecondVoiceId: voiceId,
      },
      update: {
        selectedSecondVoiceId: voiceId,
      },
    });

    this.logger.log(`User ${userId} set second voice to ${voiceId}`);
  }

  /**
   * Get the user's selected second voice ID
   */
  async getSecondVoice(userId: string): Promise<string | null> {
    const usage = await this.prisma.userUsage.findUnique({
      where: { userId },
    });
    return usage?.selectedSecondVoiceId ?? null;
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
    const isPremium = await this.isPremiumUser(userId);

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

  /**
   * Check if user has an active premium subscription
   */
  private async isPremiumUser(userId: string): Promise<boolean> {
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

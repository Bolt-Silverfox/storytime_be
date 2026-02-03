import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AiProviders } from '@/shared/constants/ai-providers.constants';
import { VOICE_CONFIG_SETTINGS } from './voice.config';
import { SUBSCRIPTION_STATUS } from '../subscription/subscription.constants';

@Injectable()
export class VoiceQuotaService {
    private readonly logger = new Logger(VoiceQuotaService.name);

    constructor(private readonly prisma: PrismaService) { }

    private getCurrentMonth(): string {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    }

    async checkUsage(userId: string): Promise<boolean> {
        // 1. Get User Subscription Status
        // Quick check on user's role or plan
        const user = await this.prisma.user.findUnique({
            where: { id: userId },
            include: { subscriptions: true }, // Restore payment models usage
        });

        if (!user) return false;

        // Determine plan
        const activeSubscription = user.subscriptions.find(
            (s) => s.status === SUBSCRIPTION_STATUS.ACTIVE && s.endsAt && s.endsAt > new Date()
        );
        const isPremium = !!activeSubscription;

        const limit = isPremium ? VOICE_CONFIG_SETTINGS.QUOTAS.PREMIUM : VOICE_CONFIG_SETTINGS.QUOTAS.FREE;

        // 2. Get/Init Usage Record
        const currentMonth = this.getCurrentMonth();
        let usage = await this.prisma.userUsage.findUnique({
            where: { userId },
        });

        // Reset if new month
        if (usage && usage.currentMonth !== currentMonth) {
            usage = await this.prisma.userUsage.update({
                where: { userId },
                data: { currentMonth, elevenLabsCount: 0 },
            });
        } else if (!usage) {
            usage = await this.prisma.userUsage.create({
                data: { userId, currentMonth },
            });
        }

        if (usage.elevenLabsCount >= limit) {
            this.logger.log(`User ${userId} exceeded ElevenLabs quota (${usage.elevenLabsCount}/${limit}).`);
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
        await this.logAiActivity(userId, AiProviders.ElevenLabs, 'voice_cloning', 1);
    }

    async trackGeminiStory(userId: string): Promise<void> {
        // Ensure usage record exists (in case it wasn't created by voice check)
        const currentMonth = this.getCurrentMonth();
        await this.prisma.userUsage.upsert({
            where: { userId },
            create: { userId, currentMonth, geminiStoryCount: 1 },
            update: { geminiStoryCount: { increment: 1 } }
        });
        await this.logAiActivity(userId, AiProviders.Gemini, 'story_generation', 1);
    }

    async trackGeminiImage(userId: string): Promise<void> {
        const currentMonth = this.getCurrentMonth();
        await this.prisma.userUsage.upsert({
            where: { userId },
            create: { userId, currentMonth, geminiImageCount: 1 },
            update: { geminiImageCount: { increment: 1 } }
        });

        await this.logAiActivity(userId, AiProviders.Gemini, 'image_generation', 1);
    }

    private async logAiActivity(userId: string, provider: string, type: string, credits: number) {
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
            this.logger.error(`Failed to log AI activity for user ${userId}: ${error.message}`);
        }
    }
}

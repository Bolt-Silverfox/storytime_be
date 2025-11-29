import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateKidDto, UpdateKidDto } from './dto/kid.dto';
import { VoiceService } from '../voice/voice.service';
import { VoiceType, VOICEID } from '@/story/story.dto';


@Injectable()
export class KidService {
    constructor(private prisma: PrismaService, private voiceService: VoiceService) { }

    // --- HELPER: Transforms the DB response for the Frontend ---
    // This ensures preferredVoiceId is ALWAYS the ElevenLabs ID (if available) (frontend specified smh)
    private transformKid(kid: any) {
        if (!kid) return null;

        let finalVoiceId = kid.preferredVoiceId;

        // If we have the relation loaded, use the real ElevenLabs ID instead of our DB UUID
        if (kid.preferredVoice && kid.preferredVoice.elevenLabsVoiceId) {
            finalVoiceId = kid.preferredVoice.elevenLabsVoiceId;
        }

        return {
            ...kid,
            preferredVoiceId: finalVoiceId,
            // We keep the preferredVoice object too, in case they need the name/url
        };
    }

    async createKid(userId: string, dto: CreateKidDto) {
        const { preferredCategoryIds, avatarId, ...data } = dto;

        const kid = await this.prisma.kid.create({
            data: {
                ...data,
                parentId: userId,
                avatarId: avatarId,
                preferredCategories: preferredCategoryIds
                    ? { connect: preferredCategoryIds.map((id) => ({ id })) }
                    : undefined,
            },
            include: {
                avatar: true,
                preferredCategories: true,
                preferredVoice: true,
                parent: { select: { id: true, name: true, email: true } },
            },
        });
        return this.transformKid(kid);
    }

    async findAllByUser(userId: string) {
        const kids = await this.prisma.kid.findMany({
            where: { parentId: userId },
            include: {
                avatar: true,
                preferredCategories: true,
                preferredVoice: true,
                parent: { select: { id: true, name: true, email: true } },
            },
            orderBy: { createdAt: 'desc' },
        });

        // Map every kid through the transformer
        return kids.map(k => this.transformKid(k));
    }

    async findOne(kidId: string, userId: string) {
        const kid = await this.prisma.kid.findUnique({
            where: { id: kidId },
            include: {
                avatar: true,
                preferredCategories: true,
                preferredVoice: true,
                notificationPreferences: true,
                activityLogs: { take: 10, orderBy: { createdAt: 'desc' } },
                parent: { select: { id: true, name: true, email: true } },
            },
        });

        if (!kid) throw new NotFoundException('Kid not found');
        if (kid.parentId !== userId) throw new ForbiddenException('Access denied');

        return this.transformKid(kid);
    }

    async updateKid(kidId: string, userId: string, dto: UpdateKidDto) {
        // 1. Verify ownership
        const kid = await this.prisma.kid.findUnique({ where: { id: kidId } });
        if (!kid || kid.parentId !== userId) {
            throw new NotFoundException('Kid not found or access denied');
        }

        const { preferredCategoryIds, preferredVoiceId, avatarId, ...rest } = dto;

        // 2. Resolve Voice ID (Supports both UUID and ElevenLabs ID input)
        let finalVoiceId = undefined;

        if (preferredVoiceId) {
            // Check if input is a UUID (Internal DB ID)
            const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(preferredVoiceId);

            if (isUuid) {
                const voice = await this.prisma.voice.findUnique({
                    where: { id: preferredVoiceId },
                });
                if (!voice) throw new NotFoundException('Voice not found');
                finalVoiceId = voice.id;
            } else {
                // If not UUID, assume it's ElevenLabs ID and find/create it
                const voice = await this.voiceService.findOrCreateElevenLabsVoice(preferredVoiceId, userId);
                finalVoiceId = voice.id;
            }
        }

        // 3. Update the Kid
        const updatedKid = await this.prisma.kid.update({
            where: { id: kidId },
            data: {
                ...rest,
                avatar: avatarId
                    ? { connect: { id: avatarId } }
                    : undefined,
                preferredCategories: preferredCategoryIds
                    ? { set: preferredCategoryIds.map((id) => ({ id })) }
                    : undefined,
                preferredVoice: finalVoiceId
                    ? { connect: { id: finalVoiceId } }
                    : undefined,
            },
            include: {
                avatar: true,
                preferredCategories: true,
                preferredVoice: true,
                parent: { select: { id: true, name: true, email: true } },
            },
        });

        return this.transformKid(updatedKid);
    }

    async deleteKid(kidId: string, userId: string) {
        const kid = await this.prisma.kid.findUnique({ where: { id: kidId } });
        if (!kid || kid.parentId !== userId) {
            throw new NotFoundException('Kid not found or access denied');
        }

        return this.prisma.kid.delete({
            where: { id: kidId },
        });
    }

    async createKids(userId: string, dtos: CreateKidDto[]) {
        const parent = await this.prisma.user.findUnique({ where: { id: userId } });
        if (!parent) throw new NotFoundException('Parent User not found');

        // Execute creates in transaction
        await this.prisma.$transaction(
            dtos.map((dto) => {
                const { preferredCategoryIds, avatarId, ...data } = dto;
                return this.prisma.kid.create({
                    data: {
                        ...data,
                        parentId: userId,
                        avatarId: avatarId,
                        preferredCategories: preferredCategoryIds
                            ? { connect: preferredCategoryIds.map((id) => ({ id })) }
                            : undefined,
                    },
                });
            })
        );

        // Fetch them back to return full structures
        return this.findAllByUser(userId);
    }

    // -------------------------------------------------------------
// SET KID PREFERRED VOICE
// Called by PATCH /user/kids/:kidId/voice
// -------------------------------------------------------------
async setKidPreferredVoice(kidId: string, voiceType: string) {
    // resolve the actual ElevenLabs ID or internal ID
    const kid = await this.prisma.kid.findUnique({
        where: { id: kidId },
        include: { preferredVoice: true },
    });

    if (!kid) throw new NotFoundException('Kid not found');

    // voiceType is a KEY like "MALE", "FEMALE", "ROBOT", etc.
    const voiceId = VOICEID[voiceType as keyof typeof VOICEID];

    if (!voiceId) {
        throw new ForbiddenException('Invalid voice type');
    }

    // Update DB
    const updatedKid = await this.prisma.kid.update({
        where: { id: kidId },
        data: { preferredVoiceId: voiceId },
        include: { preferredVoice: true },
    });

    return {
        kidId: updatedKid.id,
        voiceId: updatedKid.preferredVoiceId,
        voiceName: updatedKid.preferredVoice?.name ?? null,
    };
}

// -------------------------------------------------------------
// GET KID PREFERRED VOICE
// Called by GET /user/kids/:kidId/voice
// -------------------------------------------------------------
    async getKidPreferredVoice(kidId: string) {
        const kid = await this.prisma.kid.findUnique({
            where: { id: kidId },
            include: { preferredVoice: true },
        });

        if (!kid) throw new NotFoundException('Kid not found');

        return {
            kidId: kid.id,
            voiceId: kid.preferredVoiceId,
            voiceName: kid.preferredVoice?.name ?? null,
        };
    }

}
import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateKidDto, UpdateKidDto, KidVoiceDto } from './dto/kid.dto';
import { VoiceType } from '@/story/story.dto';
import { VoiceService } from '../voice/voice.service';

@Injectable()
export class KidService {
    constructor(private prisma: PrismaService, private voiceService: VoiceService) { }

    async createKid(userId: string, dto: CreateKidDto) {
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
            include: {
                avatar: true,
                preferredCategories: true,
            },
        });
    }

    async findAllByUser(userId: string) {
        return this.prisma.kid.findMany({
            where: { parentId: userId },
            include: {
                avatar: true,
                preferredCategories: true,
            },
            orderBy: { createdAt: 'desc' },
        });
    }

    async findOne(kidId: string, userId: string) {
        const kid = await this.prisma.kid.findUnique({
            where: { id: kidId },
            include: {
                avatar: true,
                preferredCategories: true,
                notificationPreferences: true,
                activityLogs: { take: 10, orderBy: { createdAt: 'desc' } },
            },
        });

        if (!kid) throw new NotFoundException('Kid not found');
        if (kid.parentId !== userId) throw new ForbiddenException('Access denied');

        return kid;
    }

    async updateKid(kidId: string, userId: string, dto: UpdateKidDto) {
        // 1. Verify ownership
        const kid = await this.prisma.kid.findUnique({ where: { id: kidId } });
        if (!kid || kid.parentId !== userId) {
            throw new NotFoundException('Kid not found or access denied');
        }

        const { preferredCategoryIds, preferredVoiceId, avatarId, ...rest } = dto;

        // 2. Resolve Voice ID
        let finalVoiceId = undefined;

        if (preferredVoiceId) {
            // Check if it looks like a UUID (YOUR database ID)
            const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(preferredVoiceId);

            if (isUuid) {
                // If it is a UUID, verify it exists in your DB
                const voice = await this.prisma.voice.findUnique({
                    where: { id: preferredVoiceId },
                });
                if (!voice) throw new NotFoundException('Voice not found');
                finalVoiceId = voice.id;
            } else {
                // If NOT a UUID, assume it's an ElevenLabs ID (like "2Eiw...")
                // and lazy-load it into your DB
                const voice = await this.voiceService.findOrCreateElevenLabsVoice(preferredVoiceId, userId);
                finalVoiceId = voice.id;
            }
        }

        // 3. Update the Kid
        return this.prisma.kid.update({
            where: { id: kidId },
            data: {
                ...rest,
                avatar: avatarId
                    ? { connect: { id: avatarId } }
                    : undefined,
                preferredCategories: preferredCategoryIds
                    ? { set: preferredCategoryIds.map((id) => ({ id })) }
                    : undefined,

                // CONNECT THE RESOLVED LOCAL ID
                preferredVoice: finalVoiceId
                    ? { connect: { id: finalVoiceId } }
                    : undefined,
            },
            include: {
                avatar: true,
                preferredCategories: true,
                preferredVoice: true,
            },
        });
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

    async setKidPreferredVoice(
        kidId: string,
        voiceType: VoiceType,
    ): Promise<KidVoiceDto> {
        const voice = await this.prisma.voice.findFirst({
            where: { name: voiceType },
        });
        if (!voice) {
            throw new NotFoundException(`Voice type ${voiceType} not found`);
        }

        const kid = await this.prisma.kid.update({
            where: { id: kidId },
            data: { preferredVoiceId: voice.id },
        });
        return {
            kidId: kid.id,
            voiceType,
            preferredVoiceId: kid.preferredVoiceId!,
        };
    }

    async getKidPreferredVoice(kidId: string): Promise<KidVoiceDto> {
        const kid = await this.prisma.kid.findUnique({
            where: { id: kidId },
            include: {
                avatar: true,
            },
        });
        if (!kid || !kid.preferredVoiceId)
            return { kidId, voiceType: VoiceType.MILO, preferredVoiceId: '' };

        const voice = await this.prisma.voice.findUnique({
            where: { id: kid.preferredVoiceId },
        });
        return {
            kidId: kid.id,
            voiceType: (voice?.name?.toUpperCase() as VoiceType) || VoiceType.MILO,
            preferredVoiceId: kid.preferredVoiceId,
        };
    }

    async createKids(userId: string, dtos: CreateKidDto[]) {
        const parent = await this.prisma.user.findUnique({ where: { id: userId } });
        if (!parent) throw new NotFoundException('Parent User not found');
        // We map the DTOs into Prisma operations
        const operations = dtos.map((dto) => {
            const { preferredCategoryIds, avatarId, ...data } = dto;

            return this.prisma.kid.create({
                data: {
                    ...data,
                    parentId: userId,
                    avatarId: avatarId,
                    // Connect Categories if provided
                    preferredCategories: preferredCategoryIds
                        ? { connect: preferredCategoryIds.map((id) => ({ id })) }
                        : undefined,
                },
                include: {
                    avatar: true,
                    preferredCategories: true,
                },
            });
        });

        // Execute all operations in a single transaction
        return this.prisma.$transaction(operations);
    }
}
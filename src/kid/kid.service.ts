import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateKidDto, UpdateKidDto } from './dto/kid.dto';
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
                preferredVoice: true, // Return voice info immediately
            },
        });
    }

    async findAllByUser(userId: string) {
        return this.prisma.kid.findMany({
            where: { parentId: userId },
            include: {
                avatar: true,
                preferredCategories: true,
                preferredVoice: true, // Frontend needs this to see elevenLabsVoiceId
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
                preferredVoice: true, // Frontend needs this
                notificationPreferences: true,
                activityLogs: { take: 10, orderBy: { createdAt: 'desc' } },
            },
        });

        if (!kid) throw new NotFoundException('Kid not found');
        if (kid.parentId !== userId) throw new ForbiddenException('Access denied');

        return kid;
    }

    async updateKid(kidId: string, userId: string, dto: UpdateKidDto) {
        const kid = await this.prisma.kid.findUnique({ where: { id: kidId } });
        if (!kid || kid.parentId !== userId) {
            throw new NotFoundException('Kid not found or access denied');
        }

        const { preferredCategoryIds, preferredVoiceId, avatarId, ...rest } = dto;

        let finalVoiceId = undefined;

        if (preferredVoiceId) {
            // Regex to check if it's your local DB UUID
            const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(preferredVoiceId);

            if (isUuid) {
                // It's already in your DB
                const voice = await this.prisma.voice.findUnique({ where: { id: preferredVoiceId } });
                if (!voice) throw new NotFoundException('Voice not found');
                finalVoiceId = voice.id;
            } else {
                // It's an ElevenLabs ID -> Find or Create it
                const voice = await this.voiceService.findOrCreateElevenLabsVoice(preferredVoiceId, userId);
                finalVoiceId = voice.id;
            }
        }

        return this.prisma.kid.update({
            where: { id: kidId },
            data: {
                ...rest,
                avatar: avatarId ? { connect: { id: avatarId } } : undefined,
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
                preferredVoice: true, // Returns the full object with elevenLabsVoiceId
            },
        });
    }

    async deleteKid(kidId: string, userId: string) {
        const kid = await this.prisma.kid.findUnique({ where: { id: kidId } });
        if (!kid || kid.parentId !== userId) throw new NotFoundException('Kid not found');
        return this.prisma.kid.delete({ where: { id: kidId } });
    }

    async createKids(userId: string, dtos: CreateKidDto[]) {
        const operations = dtos.map((dto) => {
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
                include: { avatar: true, preferredCategories: true, preferredVoice: true },
            });
        });
        return this.prisma.$transaction(operations);
    }
}
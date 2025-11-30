import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateKidDto, UpdateKidDto } from './dto/kid.dto';
import { VoiceService } from '../voice/voice.service';

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
            where: { 
                parentId: userId,
                isDeleted: false // EXCLUDE SOFT DELETED KIDS
            },
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
            where: { 
                id: kidId,
                isDeleted: false // EXCLUDE SOFT DELETED KIDS
            },
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
        // 1. Verify ownership and check if not soft deleted
        const kid = await this.prisma.kid.findUnique({ 
            where: { 
                id: kidId,
                isDeleted: false // CANNOT UPDATE SOFT DELETED KIDS
            } 
        });
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
                    where: { 
                        id: preferredVoiceId,
                        isDeleted: false // CANNOT USE SOFT DELETED VOICES
                    },
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

    /**
     * Soft delete or permanently delete a kid
     * @param kidId Kid ID
     * @param userId User ID for verification
     * @param permanent Whether to permanently delete (default: false)
     */
    async deleteKid(kidId: string, userId: string, permanent: boolean = false) {
        const kid = await this.prisma.kid.findUnique({ 
            where: { 
                id: kidId,
                isDeleted: false // CANNOT DELETE ALREADY DELETED KIDS
            } 
        });
        if (!kid || kid.parentId !== userId) {
            throw new NotFoundException('Kid not found or access denied');
        }

        if (permanent) {
            return this.prisma.kid.delete({
                where: { id: kidId },
            });
        } else {
            return this.prisma.kid.update({
                where: { id: kidId },
                data: { 
                    isDeleted: true, 
                    deletedAt: new Date() 
                },
            });
        }
    }

    /**
     * Restore a soft deleted kid
     * @param kidId Kid ID
     * @param userId User ID for verification
     */
    async undoDeleteKid(kidId: string, userId: string) {
        const kid = await this.prisma.kid.findUnique({ 
            where: { id: kidId } 
        });
        if (!kid) throw new NotFoundException('Kid not found');
        if (kid.parentId !== userId) throw new ForbiddenException('Access denied');
        if (!kid.isDeleted) throw new BadRequestException('Kid is not deleted');

        return this.prisma.kid.update({
            where: { id: kidId },
            data: { 
                isDeleted: false, 
                deletedAt: null 
            },
        });
    }

    async createKids(userId: string, dtos: CreateKidDto[]) {
        const parent = await this.prisma.user.findUnique({ 
            where: { 
                id: userId,
                isDeleted: false // CANNOT CREATE KIDS FOR SOFT DELETED USERS
            } 
        });
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
}
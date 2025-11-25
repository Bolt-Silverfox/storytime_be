import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateKidDto, UpdateKidDto } from './dto/kid.dto';

@Injectable()
export class KidService {
    constructor(private prisma: PrismaService) { }

    // Migrated from AuthService (Single creation is cleaner, but loop is fine for bulk)
    async createKid(userId: string, dto: CreateKidDto) {
        const { preferredCategoryIds, ...data } = dto;

        return this.prisma.kid.create({
            data: {
                ...data,
                parentId: userId,
                preferredCategories: preferredCategoryIds
                    ? { connect: preferredCategoryIds.map((id) => ({ id })) }
                    : undefined,
            },
            include: { avatar: true, preferredCategories: true },
        });
    }

    // Migrated from AuthService
    async findAllByUser(userId: string) {
        return this.prisma.kid.findMany({
            where: { parentId: userId },
            include: {
                avatar: true,
                preferredCategories: true,
            },
            orderBy: { createdAt: 'asc' },
        });
    }

    // NEW: Get Single Kid
    async findOne(kidId: string, userId: string) {
        const kid = await this.prisma.kid.findUnique({
            where: { id: kidId },
            include: {
                avatar: true,
                preferredCategories: true,
                notificationPreferences: true,
                activityLogs: { take: 5, orderBy: { createdAt: 'desc' } },
            },
        });

        if (!kid) throw new NotFoundException('Kid not found');
        if (kid.parentId !== userId) throw new ForbiddenException('Access denied');

        return kid;
    }

    // Enhanced Update (Handles Bedtime & Categories)
    async updateKid(kidId: string, userId: string, dto: UpdateKidDto) {
        const kid = await this.prisma.kid.findUnique({ where: { id: kidId } });
        if (!kid || kid.parentId !== userId) throw new NotFoundException('Kid not found');

        const { preferredCategoryIds, ...rest } = dto;

        return this.prisma.kid.update({
            where: { id: kidId },
            data: {
                ...rest,
                // Update Many-to-Many relation
                preferredCategories: preferredCategoryIds
                    ? { set: preferredCategoryIds.map((id) => ({ id })) } // 'set' replaces existing list
                    : undefined,
            },
            include: { avatar: true, preferredCategories: true },
        });
    }

    // Migrated from AuthService
    async deleteKid(kidId: string, userId: string) {
        const kid = await this.prisma.kid.findUnique({ where: { id: kidId } });
        if (!kid || kid.parentId !== userId) throw new NotFoundException('Kid not found');

        return this.prisma.kid.delete({ where: { id: kidId } });
    }
}
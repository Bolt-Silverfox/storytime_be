import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { Kid, Voice, User } from '@prisma/client';
import {
  IKidRepository,
  KidWithRelations,
  CreateKidData,
  UpdateKidData,
} from './kid.repository.interface';

const kidRelationsBasic = {
  avatar: true,
  preferredCategories: true,
  preferredVoice: true,
  parent: { select: { id: true, name: true, email: true } },
} as const;

const kidRelationsFull = {
  ...kidRelationsBasic,
  notificationPreferences: true,
  activityLogs: { take: 10, orderBy: { createdAt: 'desc' as const } },
} as const;

@Injectable()
export class PrismaKidRepository implements IKidRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: CreateKidData): Promise<KidWithRelations> {
    const { preferredCategoryIds, avatarId, parentId, ...rest } = data;

    return this.prisma.kid.create({
      data: {
        ...rest,
        parentId,
        avatarId,
        preferredCategories: preferredCategoryIds
          ? { connect: preferredCategoryIds.map((id) => ({ id })) }
          : undefined,
      },
      include: kidRelationsBasic,
    });
  }

  async findById(id: string): Promise<Kid | null> {
    return this.prisma.kid.findUnique({
      where: { id },
    });
  }

  async findByIdNotDeleted(id: string): Promise<Kid | null> {
    return this.prisma.kid.findUnique({
      where: { id, isDeleted: false },
    });
  }

  async findByIdWithRelations(id: string): Promise<KidWithRelations | null> {
    return this.prisma.kid.findUnique({
      where: { id, isDeleted: false },
      include: kidRelationsBasic,
    });
  }

  async findByIdWithFullRelations(
    id: string,
  ): Promise<KidWithRelations | null> {
    return this.prisma.kid.findUnique({
      where: { id, isDeleted: false },
      include: kidRelationsFull,
    });
  }

  async findAllByParentId(parentId: string): Promise<KidWithRelations[]> {
    return this.prisma.kid.findMany({
      where: { parentId, isDeleted: false },
      include: kidRelationsBasic,
      orderBy: { createdAt: 'desc' },
    });
  }

  async update(id: string, data: UpdateKidData): Promise<KidWithRelations> {
    const { preferredCategoryIds, preferredVoiceId, avatarId, ...rest } = data;

    return this.prisma.kid.update({
      where: { id },
      data: {
        ...rest,
        avatar: avatarId ? { connect: { id: avatarId } } : undefined,
        preferredCategories: preferredCategoryIds
          ? { set: preferredCategoryIds.map((id) => ({ id })) }
          : undefined,
        preferredVoice: preferredVoiceId
          ? { connect: { id: preferredVoiceId } }
          : undefined,
      },
      include: kidRelationsBasic,
    });
  }

  async softDelete(id: string): Promise<Kid> {
    return this.prisma.kid.update({
      where: { id },
      data: {
        isDeleted: true,
        deletedAt: new Date(),
      },
    });
  }

  async restore(id: string): Promise<Kid> {
    return this.prisma.kid.update({
      where: { id },
      data: {
        isDeleted: false,
        deletedAt: null,
      },
    });
  }

  async hardDelete(id: string): Promise<Kid> {
    return this.prisma.kid.delete({
      where: { id },
    });
  }

  async createMany(parentId: string, data: CreateKidData[]): Promise<void> {
    await this.prisma.$transaction(
      data.map((kidData) => {
        const { preferredCategoryIds, avatarId, ...rest } = kidData;
        return this.prisma.kid.create({
          data: {
            ...rest,
            parentId,
            avatarId,
            preferredCategories: preferredCategoryIds
              ? { connect: preferredCategoryIds.map((id) => ({ id })) }
              : undefined,
          },
        });
      }),
    );
  }

  async countParentRecommendations(kidId: string): Promise<number> {
    return this.prisma.parentRecommendation.count({
      where: { kidId, isDeleted: false },
    });
  }

  async findVoiceById(voiceId: string): Promise<Voice | null> {
    return this.prisma.voice.findUnique({
      where: { id: voiceId, isDeleted: false },
    });
  }

  async findUserByIdNotDeleted(userId: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { id: userId, isDeleted: false },
    });
  }
}

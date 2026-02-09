import { Injectable } from '@nestjs/common';
import { Avatar, User, Kid } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { IAvatarRepository } from './avatar.repository.interface';

@Injectable()
export class PrismaAvatarRepository implements IAvatarRepository {
  constructor(private readonly prisma: PrismaService) {}

  // Avatar CRUD
  async findById(id: string): Promise<Avatar | null> {
    return this.prisma.avatar.findUnique({ where: { id } });
  }

  async findByIdNotDeleted(id: string): Promise<Avatar | null> {
    return this.prisma.avatar.findUnique({
      where: { id, isDeleted: false },
    });
  }

  async findByName(name: string): Promise<Avatar | null> {
    return this.prisma.avatar.findUnique({ where: { name } });
  }

  async findAll(includeDeleted = false): Promise<Avatar[]> {
    const where = includeDeleted ? {} : { isDeleted: false };
    return this.prisma.avatar.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findSystemAvatars(): Promise<Avatar[]> {
    return this.prisma.avatar.findMany({
      where: { isSystemAvatar: true, isDeleted: false },
      orderBy: { name: 'asc' },
    });
  }

  async findAllSystemAvatars(): Promise<Avatar[]> {
    return this.prisma.avatar.findMany({
      where: { isSystemAvatar: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(data: {
    name: string;
    url: string;
    publicId?: string | null;
    isSystemAvatar: boolean;
    createdBy?: string;
  }): Promise<Avatar> {
    return this.prisma.avatar.create({
      data: {
        name: data.name,
        url: data.url,
        publicId: data.publicId || null,
        isSystemAvatar: data.isSystemAvatar,
        isDeleted: false,
        deletedAt: null,
        ...(data.createdBy && { createdBy: data.createdBy }),
      },
    });
  }

  async update(
    id: string,
    data: Partial<Pick<Avatar, 'name' | 'url' | 'publicId'>>,
  ): Promise<Avatar> {
    return this.prisma.avatar.update({ where: { id }, data });
  }

  async upsertByName(
    name: string,
    data: {
      url: string;
      publicId?: string | null;
      isSystemAvatar: boolean;
    },
  ): Promise<Avatar> {
    return this.prisma.avatar.upsert({
      where: { name },
      update: {
        url: data.url,
        publicId: data.publicId,
        isSystemAvatar: data.isSystemAvatar,
        isDeleted: false,
        deletedAt: null,
      },
      create: {
        name,
        url: data.url,
        publicId: data.publicId || null,
        isSystemAvatar: data.isSystemAvatar,
        isDeleted: false,
        deletedAt: null,
      },
    });
  }

  async softDelete(id: string): Promise<Avatar> {
    return this.prisma.avatar.update({
      where: { id },
      data: { isDeleted: true, deletedAt: new Date() },
    });
  }

  async hardDelete(id: string): Promise<Avatar> {
    return this.prisma.avatar.delete({ where: { id } });
  }

  async restore(id: string): Promise<Avatar> {
    return this.prisma.avatar.update({
      where: { id },
      data: { isDeleted: false, deletedAt: null },
    });
  }

  // Usage counts
  async countUsersUsingAvatar(avatarId: string): Promise<number> {
    return this.prisma.user.count({ where: { avatarId } });
  }

  async countKidsUsingAvatar(avatarId: string): Promise<number> {
    return this.prisma.kid.count({ where: { avatarId } });
  }

  // User avatar operations
  async findUserById(userId: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id: userId } });
  }

  async findUserWithAvatar(
    userId: string,
  ): Promise<(User & { avatar: Avatar | null }) | null> {
    return this.prisma.user.findUnique({
      where: { id: userId },
      include: { avatar: true },
    });
  }

  async updateUserAvatar(
    userId: string,
    avatarId: string,
  ): Promise<User & { avatar: Avatar | null }> {
    return this.prisma.user.update({
      where: { id: userId },
      data: { avatarId },
      include: { avatar: true },
    });
  }

  // Kid avatar operations
  async findKidById(kidId: string): Promise<Kid | null> {
    return this.prisma.kid.findUnique({ where: { id: kidId } });
  }

  async findKidWithAvatar(
    kidId: string,
  ): Promise<(Kid & { avatar: Avatar | null }) | null> {
    return this.prisma.kid.findUnique({
      where: { id: kidId },
      include: { avatar: true },
    });
  }

  async updateKidAvatar(
    kidId: string,
    avatarId: string,
  ): Promise<Kid & { avatar: Avatar | null }> {
    return this.prisma.kid.update({
      where: { id: kidId },
      data: { avatarId },
      include: { avatar: true },
    });
  }
}

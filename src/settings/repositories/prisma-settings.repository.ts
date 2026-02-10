import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Profile, Kid, User } from '@prisma/client';
import {
  ISettingsRepository,
  KidWithAvatar,
  KidWithParentProfile,
  UserWithProfileAndKids,
} from './settings.repository.interface';

@Injectable()
export class PrismaSettingsRepository implements ISettingsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findProfileByUserId(userId: string): Promise<Profile | null> {
    return this.prisma.profile.findUnique({ where: { userId } });
  }

  async createProfile(
    userId: string,
    data: { language: string; country: string },
  ): Promise<Profile> {
    return this.prisma.profile.create({
      data: { userId, ...data },
    });
  }

  async updateProfile(
    userId: string,
    data: Partial<
      Pick<
        Profile,
        'explicitContent' | 'maxScreenTimeMins' | 'language' | 'country'
      >
    >,
  ): Promise<Profile> {
    return this.prisma.profile.update({
      where: { userId },
      data,
    });
  }

  async findKidById(kidId: string): Promise<Kid | null> {
    return this.prisma.kid.findUnique({
      where: { id: kidId },
    });
  }

  async findKidWithParentProfile(
    kidId: string,
  ): Promise<KidWithParentProfile | null> {
    return this.prisma.kid.findUnique({
      where: { id: kidId },
      include: {
        parent: {
          include: {
            profile: true,
          },
        },
      },
    });
  }

  async updateKidScreenTimeLimit(
    kidId: string,
    limitMins: number | null,
  ): Promise<Kid> {
    return this.prisma.kid.update({
      where: { id: kidId },
      data: {
        dailyScreenTimeLimitMins: limitMins,
      },
    });
  }

  async findKidsByParentWithAvatar(parentId: string): Promise<KidWithAvatar[]> {
    return this.prisma.kid.findMany({
      where: { parentId },
      include: {
        avatar: true,
      },
    });
  }

  async updateManyKidsScreenTimeLimit(
    parentId: string,
    currentLimit: null,
    newLimit: number,
  ): Promise<{ count: number }> {
    return this.prisma.kid.updateMany({
      where: {
        parentId,
        dailyScreenTimeLimitMins: currentLimit,
      },
      data: {
        dailyScreenTimeLimitMins: newLimit,
      },
    });
  }

  async findUserWithProfileAndKids(
    userId: string,
  ): Promise<UserWithProfileAndKids | null> {
    return this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        profile: true,
        kids: true,
      },
    });
  }

  async findUserWithProfile(
    userId: string,
  ): Promise<(User & { profile: Profile | null }) | null> {
    return this.prisma.user.findUnique({
      where: { id: userId },
      include: { profile: true },
    });
  }
}

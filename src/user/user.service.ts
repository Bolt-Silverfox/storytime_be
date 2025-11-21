import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { UserRole } from './user.controller';
import { KidVoiceDto, UpdateUserDto } from './user.dto';
import { VoiceType } from '@/story/story.dto';
import { SoftDeleteService } from '../common/soft-delete.service';

const prisma = new PrismaClient();

@Injectable()
export class UserService {
  constructor(private softDeleteService: SoftDeleteService) {}

  async getUser(id: string): Promise<any> {
    const user = await prisma.user.findUnique({
      where: { 
        id,
        deletedAt: null 
      },
      include: { 
        profile: true, 
        kids: {
          where: {
            deletedAt: null
          }
        }, 
        avatar: true,
      },
    });
    if (!user) return null;
    return {
      ...user,
      numberOfKids: user.kids ? user.kids.length : 0,
    };
  }

  async getAllUsers(): Promise<any[]> {
    return await prisma.user.findMany({
      where: {
        deletedAt: null
      },
      include: { 
        profile: true,  
        avatar: true,
      },
    });
  }

  async softDeleteUser(id: string): Promise<any> {
    return await this.softDeleteService.softDelete('user', id);
  }

  async undoDeleteUser(id: string): Promise<boolean> {
    return await this.softDeleteService.undoSoftDelete('user', id);
  }

  async permanentDeleteUser(id: string): Promise<any> {
    return await this.softDeleteService.permanentDelete('user', id);
  }

  async updateUser(id: string, data: UpdateUserDto): Promise<any> {
    const user = await prisma.user.findUnique({ 
      where: { 
        id,
        deletedAt: null 
      } 
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const updateData: any = {};

    if (data.title !== undefined) {
      updateData.title = data.title;
    }

    if (data.name !== undefined) {
      updateData.name = data.name;
    }

    if (data.avatarId !== undefined) {
      updateData.avatarId = data.avatarId;
    } else if (data.avatarUrl !== undefined) {
      updateData.avatarId = data.avatarUrl;
    }

    const profileUpdateData: any = {};
    if (data.language !== undefined) {
      profileUpdateData.language = data.language;
    }
    if (data.country !== undefined) {
      profileUpdateData.country = data.country;
    }

    if (Object.keys(updateData).length === 0 && Object.keys(profileUpdateData).length === 0) {
      return this.getUser(id);
    }

    const updatedUser = await prisma.user.update({
      where: { id },
      data: {
        ...updateData,
        ...(Object.keys(profileUpdateData).length > 0 && {
          profile: {
            upsert: {
              create: profileUpdateData,
              update: profileUpdateData,
            },
          },
        }),
      },
      include: {
        profile: true,
        avatar: true,
        kids: {
          where: {
            deletedAt: null
          }
        },
      },
    });

    return {
      ...updatedUser,
      numberOfKids: updatedUser.kids ? updatedUser.kids.length : 0,
    };
  }

  async getUserRole(id: string): Promise<any> {
    const user = await prisma.user.findUnique({ 
      where: { 
        id,
        deletedAt: null 
      } 
    });
    return { id: user?.id, role: user?.role };
  }

  async updateUserRole(id: string, role: UserRole): Promise<any> {
    if (!Object.values(UserRole).includes(role)) {
      throw new Error('Invalid role');
    }
    const user = await prisma.user.update({
      where: { id },
      data: { role },
      include: {
        avatar: true,
      },
    });
    return { id: user.id, role: user.role };
  }

  async setKidPreferredVoice(
    kidId: string,
    voiceType: VoiceType,
  ): Promise<KidVoiceDto> {
    const voice = await prisma.voice.findFirst({
      where: { name: voiceType },
    });
    if (!voice) {
      throw new Error(`Voice type ${voiceType} not found`);
    }

    const kid = await prisma.kid.update({
      where: { id: kidId },
      data: { preferredVoiceId: voice.id },
    });
    return {
      kidId: kid.id,
      voiceType,
      preferredVoiceId: kid.preferredVoiceId!,
    };
  }

  async getKidPreferredVoice(kidId: string): Promise<KidVoiceDto | null> {
    const kid = await prisma.kid.findUnique({ 
      where: { 
        id: kidId,
        deletedAt: null 
      },
      include: {
        avatar: true,
      },
    });
    if (!kid || !kid.preferredVoiceId)
      return { kidId, voiceType: VoiceType.MILO, preferredVoiceId: '' };

    const voice = await prisma.voice.findUnique({
      where: { id: kid.preferredVoiceId },
    });
    return {
      kidId: kid.id,
      voiceType: (voice?.name?.toUpperCase() as VoiceType) || VoiceType.MILO,
      preferredVoiceId: kid.preferredVoiceId,
    };
  }
}
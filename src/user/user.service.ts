import { Injectable, NotFoundException } from '@nestjs/common';
import  PrismaService  from '../prisma/prisma.service';
import { UserRole } from './user.controller';
import { KidVoiceDto, UpdateUserDto } from './user.dto';
import { VoiceType } from '@/story/story.dto';

@Injectable()
export class UserService {
  constructor(private readonly prisma: PrismaService) {}

  async getUser(id: string): Promise<any> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: { 
        profile: true, 
        kids: true, 
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
    return this.prisma.user.findMany({
      include: { 
        profile: true,
        avatar: true,
      },
    });
  }

  async deleteUser(id: string): Promise<any> {
    return this.prisma.user.delete({
      where: { id },
    });
  }

  async updateUser(id: string, data: UpdateUserDto): Promise<any> {
    const user = await this.prisma.user.findUnique({ where: { id } });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const updateData: any = {};

    if (data.title !== undefined) updateData.title = data.title;
    if (data.name !== undefined) updateData.name = data.name;

    if (data.avatarId !== undefined) {
      updateData.avatarId = data.avatarId;
    }

    const profileUpdate: any = {};
    if (data.language !== undefined) profileUpdate.language = data.language;
    if (data.country !== undefined) profileUpdate.country = data.country;

    const updated = await this.prisma.user.update({
      where: { id },
      data: {
        ...updateData,
        ...(Object.keys(profileUpdate).length > 0
          ? { profile: { upsert: { create: profileUpdate, update: profileUpdate } } }
          : {}),
      },
      include: { profile: true, kids: true, avatar: true },
    });

    return {
      ...updated,
      numberOfKids: updated.kids?.length ?? 0,
    };
  }

  async getUserRole(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    return { id: user?.id, role: user?.role };
  }

  async updateUserRole(id: string, role: UserRole) {
    if (!Object.values(UserRole).includes(role)) {
      throw new Error('Invalid role');
    }

    const user = await this.prisma.user.update({
      where: { id },
      data: { role },
      include: { avatar: true },
    });

    return { id: user.id, role: user.role };
  }

  async setKidPreferredVoice(kidId: string, voiceType: VoiceType): Promise<KidVoiceDto> {
    const voice = await this.prisma.voice.findFirst({
      where: { name: voiceType },
    });

    if (!voice) throw new Error(`Voice type ${voiceType} not found`);

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

  async getKidPreferredVoice(kidId: string): Promise<KidVoiceDto | null> {
    const kid = await this.prisma.kid.findUnique({
      where: { id: kidId },
      include: { avatar: true },
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
}

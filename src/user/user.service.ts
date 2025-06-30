import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { UserRole } from './user.controller';
import { KidVoiceDto } from './user.dto';
import { VoiceType } from '@/story/story.dto';

const prisma = new PrismaClient();

@Injectable()
export class UserService {
  async getUser(id: string): Promise<any> {
    // Fetch user, profile, and kids count
    const user = await prisma.user.findUnique({
      where: { id },
      include: { profile: true, kids: true },
    });
    if (!user) return null;
    return {
      ...user,
      numberOfKids: user.kids ? user.kids.length : 0,
    };
  }

  async getAllUsers(): Promise<any[]> {
    return await prisma.user.findMany({
      include: { profile: true },
    });
  }

  async deleteUser(id: string): Promise<any> {
    return await prisma.user.delete({
      where: { id },
    });
  }

  async updateUser(id: string, body: any): Promise<any> {
    return await prisma.user.update({
      where: { id },
      data: {
        name: body.name,
        avatarUrl: body.avatarUrl,
        title: body.title,
        profile: {
          update: {
            language: body.language,
            country: body.country,
          },
        },
      },
    });
  }

  async getUserRole(id: string): Promise<any> {
    const user = await prisma.user.findUnique({ where: { id } });
    return { id: user?.id, role: user?.role };
  }

  async updateUserRole(id: string, role: UserRole): Promise<any> {
    if (!Object.values(UserRole).includes(role)) {
      throw new Error('Invalid role');
    }
    const user = await prisma.user.update({
      where: { id },
      data: { role },
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
    const kid = await prisma.kid.findUnique({ where: { id: kidId } });
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

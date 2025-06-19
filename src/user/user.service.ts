import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { UserRole } from './user.controller';
import { SetKidPreferredVoiceDto, KidVoiceDto } from './user.dto';

const prisma = new PrismaClient();

@Injectable()
export class UserService {
  async getUser(id: string): Promise<any> {
    return await prisma.user.findUnique({
      where: { id },
      include: { profile: true },
    });
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
    // Example: update name and avatarUrl
    return await prisma.user.update({
      where: { id },
      data: {
        name: body.name,
        avatarUrl: body.avatarUrl,
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
    dto: SetKidPreferredVoiceDto,
  ): Promise<KidVoiceDto> {
    const kid = await prisma.kid.update({
      where: { id: dto.kidId },
      data: { preferredVoiceId: dto.voiceId },
    });
    return { kidId: kid.id, preferredVoiceId: kid.preferredVoiceId! };
  }

  async getKidPreferredVoice(kidId: string): Promise<KidVoiceDto | null> {
    const kid = await prisma.kid.findUnique({ where: { id: kidId } });
    if (!kid || !kid.preferredVoiceId) return null;
    return { kidId: kid.id, preferredVoiceId: kid.preferredVoiceId };
  }
}

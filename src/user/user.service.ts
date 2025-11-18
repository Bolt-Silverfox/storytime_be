import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { UserRole } from './user.controller';
import {
  SetKidPreferredVoiceDto,
  KidVoiceDto,
  UpdateUserDto,
} from './user.dto';

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

  async updateUser(id: string, data: UpdateUserDto): Promise<any> {
    // Check if user exists
    const user = await prisma.user.findUnique({ where: { id } });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Build update payload dynamically - only include fields that are provided
    const updateData: Partial<{
      title: string;
      name: string;
      avatarUrl: string;
    }> = {};

    if (data.name !== undefined) {
      updateData.name = data.name;
    }

    if (data.avatarUrl !== undefined) {
      updateData.avatarUrl = data.avatarUrl;
    }

    // If no fields to update, return existing user
    if (Object.keys(updateData).length === 0) {
      return user;
    }

    // Update user with only provided fields
    return await prisma.user.update({
      where: { id },
      data: updateData,
      // include: { profile: true },
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

import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import type { IVoiceRepository } from './voice.repository.interface';
import type { Voice, Prisma } from '@prisma/client';

@Injectable()
export class PrismaVoiceRepository implements IVoiceRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createVoice(data: Prisma.VoiceUncheckedCreateInput): Promise<Voice> {
    return this.prisma.voice.create({ data });
  }

  async createVoiceReturningId(
    data: Prisma.VoiceUncheckedCreateInput,
  ): Promise<{ id: string }> {
    return this.prisma.voice.create({
      data,
      select: { id: true },
    });
  }

  async createUploadedVoiceWithinCap(
    userId: string,
    data: Prisma.VoiceUncheckedCreateInput,
    cap: number,
  ): Promise<Voice | null> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`voice-upload:${userId}`}))`;
      const existing = await tx.voice.count({
        where: { userId, type: 'uploaded', isDeleted: false },
      });
      if (existing >= cap) return null;
      return tx.voice.create({ data });
    });
  }

  async updateVoice(
    id: string,
    data: Prisma.VoiceUncheckedUpdateInput,
  ): Promise<Voice> {
    return this.prisma.voice.update({ where: { id }, data });
  }

  async hardDeleteVoice(id: string): Promise<void> {
    await this.prisma.voice.delete({ where: { id } });
  }

  async findManyByUserNotDeleted(userId: string): Promise<Voice[]> {
    return this.prisma.voice.findMany({
      where: { userId, isDeleted: false },
    });
  }

  async findFirstByUserAndElevenLabsId(
    userId: string,
    elevenLabsVoiceId: string,
  ): Promise<Voice | null> {
    return this.prisma.voice.findFirst({
      where: {
        userId: userId,
        elevenLabsVoiceId: elevenLabsVoiceId,
        isDeleted: false,
      },
    });
  }

  async findSystemVoiceByElevenLabsId(
    elevenLabsVoiceId: string,
  ): Promise<Voice | null> {
    return this.prisma.voice.findFirst({
      where: {
        elevenLabsVoiceId,
        userId: null,
        isDeleted: false,
      },
    });
  }

  async findFirstByIdNotDeleted(id: string): Promise<Voice | null> {
    return this.prisma.voice.findFirst({
      where: { id, isDeleted: false },
    });
  }

  async findSystemVoicesByElevenLabsIds(
    elevenLabsVoiceIds: string[],
  ): Promise<Voice[]> {
    return this.prisma.voice.findMany({
      where: {
        elevenLabsVoiceId: { in: elevenLabsVoiceIds },
        userId: null,
        isDeleted: false,
      },
    });
  }

  async findUniqueByIdNotDeleted(id: string): Promise<Voice | null> {
    return this.prisma.voice.findUnique({
      where: { id, isDeleted: false },
    });
  }

  async findSystemVoiceIdByElevenLabsId(
    elevenLabsVoiceId: string,
  ): Promise<{ id: string } | null> {
    return this.prisma.voice.findFirst({
      where: { elevenLabsVoiceId, isDeleted: false, userId: null },
      select: { id: true },
    });
  }

  async findVoiceIdElevenLabsPairs(
    ids: string[],
  ): Promise<Array<{ id: string; elevenLabsVoiceId: string | null }>> {
    return this.prisma.voice.findMany({
      where: { id: { in: ids } },
      select: { id: true, elevenLabsVoiceId: true },
    });
  }

  async findElevenLabsIdById(
    id: string,
  ): Promise<{ elevenLabsVoiceId: string | null } | null> {
    return this.prisma.voice.findFirst({
      where: { id, isDeleted: false },
      select: { elevenLabsVoiceId: true },
    });
  }
}

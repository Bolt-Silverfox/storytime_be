import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import type { IVoiceRepository } from './voice.repository.interface';
import type { Voice, Prisma } from '@prisma/client';
import { PENDING_VOICE_GRACE_MS } from '../voice.constants';

const HIDE_PENDING_UPLOADS: Prisma.VoiceWhereInput = {
  NOT: { type: 'uploaded', url: null },
};

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
      const cutoff = new Date(Date.now() - PENDING_VOICE_GRACE_MS);
      await tx.voice.deleteMany({
        where: {
          userId,
          type: 'uploaded',
          url: null,
          createdAt: { lt: cutoff },
        },
      });
      const existing = await tx.voice.count({
        where: {
          userId,
          type: 'uploaded',
          isDeleted: false,
          OR: [{ url: { not: null } }, { createdAt: { gte: cutoff } }],
        },
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
      where: { userId, isDeleted: false, ...HIDE_PENDING_UPLOADS },
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
      where: { id, isDeleted: false, ...HIDE_PENDING_UPLOADS },
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
    return this.prisma.voice.findFirst({
      where: { id, isDeleted: false, ...HIDE_PENDING_UPLOADS },
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
      where: { id, isDeleted: false, ...HIDE_PENDING_UPLOADS },
      select: { elevenLabsVoiceId: true },
    });
  }
}

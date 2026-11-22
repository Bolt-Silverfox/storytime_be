import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import type { IVoiceRepository } from './voice.repository.interface';
import type { Voice, Prisma } from '@prisma/client';
import { lockVoiceForDelete } from './voice-row-lock';
import { VoiceSourceType } from '../dto/voice.dto';

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

  async findByIdAndUser(id: string, userId: string): Promise<Voice | null> {
    return this.prisma.voice.findFirst({ where: { id, userId } });
  }

  async softDeleteOwnedIfUnreferenced(
    id: string,
    userId: string,
    options?: { releaseOwnersFreeTierLock: boolean },
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      // Postgres re-reads the references only in a statement that starts after this lock is granted.
      await lockVoiceForDelete(tx, id);
      const { count } = await tx.voice.updateMany({
        where: {
          id,
          userId,
          isDeleted: false,
          usersPreferring: { none: {} },
          kidsPreferring: { none: {} },
          usersWithAsSecond: {
            none: options?.releaseOwnersFreeTierLock
              ? { userId: { not: userId } }
              : {},
          },
        },
        data: { isDeleted: true, deletedAt: new Date() },
      });
      if (count === 0) {
        return false;
      }
      if (options?.releaseOwnersFreeTierLock) {
        await tx.userUsage.updateMany({
          where: { userId, selectedSecondVoiceId: id },
          data: { selectedSecondVoiceId: null },
        });
      }
      return true;
    });
  }

  async clearElevenLabsVoiceId(id: string, userId: string): Promise<void> {
    await this.prisma.voice.updateMany({
      where: { id, userId },
      data: { elevenLabsVoiceId: null },
    });
  }

  async isElevenLabsIdUsedByAnotherVoice(
    elevenLabsVoiceId: string,
    excludedVoiceId: string,
  ): Promise<boolean> {
    const other = await this.prisma.voice.findFirst({
      where: {
        elevenLabsVoiceId,
        isDeleted: false,
        id: { not: excludedVoiceId },
      },
      select: { id: true },
    });
    return other !== null;
  }

  async isElevenLabsIdOfUploadedVoice(
    elevenLabsVoiceId: string,
  ): Promise<boolean> {
    const uploaded = await this.prisma.voice.findFirst({
      where: { elevenLabsVoiceId, type: VoiceSourceType.UPLOADED },
      select: { id: true },
    });
    return uploaded !== null;
  }
}

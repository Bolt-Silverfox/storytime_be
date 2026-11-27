import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import type {
  IVoiceUserRepository,
  UserWithPreferredVoice,
} from './user.repository.interface';
import { lockLiveVoiceForReference } from './voice-row-lock';

@Injectable()
export class PrismaVoiceUserRepository implements IVoiceUserRepository {
  constructor(private readonly prisma: PrismaService) {}

  async updatePreferredVoiceWithInclude(
    userId: string,
    voiceId: string,
  ): Promise<UserWithPreferredVoice | null> {
    return this.prisma.$transaction(async (tx) => {
      if (!(await lockLiveVoiceForReference(tx, voiceId))) {
        return null;
      }
      return tx.user.update({
        where: { id: userId },
        data: { preferredVoiceId: voiceId },
        include: { preferredVoice: true },
      });
    });
  }

  async findByIdWithPreferredVoice(
    userId: string,
  ): Promise<UserWithPreferredVoice | null> {
    return this.prisma.user.findUnique({
      where: { id: userId },
      include: { preferredVoice: true },
    });
  }

  async findPreferredVoiceId(
    userId: string,
  ): Promise<{ preferredVoiceId: string | null } | null> {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: { preferredVoiceId: true },
    });
  }
}

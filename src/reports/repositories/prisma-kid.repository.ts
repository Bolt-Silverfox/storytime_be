import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import type {
  IKidRepository,
  KidParentId,
  KidWithAvatar,
  KidWithAvatarAndActivity,
} from './kid.repository.interface';

@Injectable()
export class PrismaKidRepository implements IKidRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findParentIdByKidId(id: string): Promise<KidParentId | null> {
    return this.prisma.kid.findUnique({
      where: { id },
      select: { parentId: true },
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

  async findKidWithAvatarAndActivity(
    id: string,
  ): Promise<KidWithAvatarAndActivity | null> {
    return this.prisma.kid.findUnique({
      where: { id },
      include: {
        avatar: true,
        activityLogs: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });
  }
}

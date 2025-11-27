import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdateKidAvatarDto } from './kid-avatar.dto';

@Injectable()
export class KidAvatarService {
  constructor(private prisma: PrismaService) {}

  async getKidAvatar(kidId: string, parentId: string) {
    const kid = await this.prisma.kid.findUnique({
      where: { id: kidId },
      include: { avatar: true },
    });

    if (!kid) throw new NotFoundException('Kid not found');
    if (kid.parentId !== parentId) throw new ForbiddenException('Access denied');

    return {
      kidId: kid.id,
      avatar: kid.avatar,
      avatarUrl: kid.avatar?.url ?? kid.avatarUrl ?? null,
    };
  }

  async updateKidAvatar(
    kidId: string,
    dto: UpdateKidAvatarDto,
    parentId: string,
  ) {
    const kid = await this.prisma.kid.findUnique({
      where: { id: kidId },
      include: { avatar: true },
    });

    if (!kid) throw new NotFoundException('Kid not found');
    if (kid.parentId !== parentId) throw new ForbiddenException('Access denied');

    const data: any = {};

    if (dto.avatarId) data.avatarId = dto.avatarId;
    if (dto.avatarUrl) data.avatarUrl = dto.avatarUrl;

    return this.prisma.kid.update({
      where: { id: kidId },
      data,
      include: { avatar: true },
    });
  }
}


import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import  PrismaService  from '../prisma/prisma.service';
import { UploadService } from '../upload/upload.service';

@Injectable()
export class AvatarService {
  private readonly logger = new Logger(AvatarService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly uploadService: UploadService,
  ) {}

  async getSystemAvatars() {
    return this.prisma.systemAvatar.findMany({
      orderBy: { name: 'asc' },
    });
  }

  async assignToUser(userId: string, avatarId: string) {
    const avatar = await this.prisma.systemAvatar.findUnique({ where: { id: avatarId } });
    if (!avatar) throw new NotFoundException('Avatar not found');

    return this.prisma.user.update({
      where: { id: userId },
      data: { systemAvatarId: avatarId },
      include: { systemAvatar: true },
    });
  }

  async assignToKid(kidId: string, avatarId: string) {
    const avatar = await this.prisma.systemAvatar.findUnique({ where: { id: avatarId } });
    if (!avatar) throw new NotFoundException('Avatar not found');

    return this.prisma.kid.update({
      where: { id: kidId },
      data: { systemAvatarId: avatarId },
      include: { systemAvatar: true },
    });
  }
}

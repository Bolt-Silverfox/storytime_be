import { Injectable, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';

@Injectable()
export class KidDownloadsService {
  constructor(private prisma: PrismaService) {}

  private async assertOwnership(kidId: string, parentId: string) {
    const kid = await this.prisma.kid.findUnique({ where: { id: kidId } });
    if (!kid) throw new NotFoundException('Kid not found');
    if (kid.parentId !== parentId) throw new ForbiddenException('Access denied');
    return kid;
  }

  async list(kidId: string, parentId: string) {
    await this.assertOwnership(kidId, parentId);

    return this.prisma.kidDownload.findMany({
      where: { kidId },
      include: { story: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async add(kidId: string, storyId: string, parentId: string) {
    await this.assertOwnership(kidId, parentId);

    try {
      return await this.prisma.kidDownload.create({
        data: { kidId, storyId },
      });
    } catch {
      throw new ConflictException('Download already exists');
    }
  }

  async remove(kidId: string, storyId: string, parentId: string) {
    await this.assertOwnership(kidId, parentId);

    return this.prisma.kidDownload.delete({
      where: { kidId_storyId: { kidId, storyId } },
    });
  }
}


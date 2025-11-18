import { Injectable, NotFoundException } from '@nestjs/common';
import PrismaService from 'src/prisma/prisma.service';
import { updateProfileDto } from './dto/updateProfile.dto';
import { kidDto } from './dto/kid.dto';
import { updateKidDto } from './dto/updateKid.dto';

@Injectable()
export class UserService {
  constructor(private prisma: PrismaService) {}

  // -----------------------------
  // UPDATE PROFILE
  // -----------------------------
  async updateProfile(userId: string, data: updateProfileDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { profile: true },
    });

    if (!user) throw new NotFoundException('User not found');

    if (!user.profile) {
      await this.prisma.profile.create({ data: { userId } });
    }

    const updateData = {
      ...(data.country && { country: data.country.toLowerCase() }),
      ...(data.language && { language: data.language.toLowerCase() }),
      ...(data.explicitContent !== undefined && {
        explicitContent: data.explicitContent,
      }),
      ...(data.maxScreenTimeMins && {
        maxScreenTimeMins: data.maxScreenTimeMins,
      }),
    };

    return this.prisma.profile.update({
      where: { userId },
      data: updateData,
    });
  }

  // -----------------------------
  // KIDS CRUD
  // -----------------------------
  async addKids(userId: string, kids: kidDto[]) {
    return this.prisma.$transaction(
      kids.map((kid) =>
        this.prisma.kid.create({
          data: {
            name: kid.name,
            avatarUrl: kid.avatarUrl,
            parentId: userId,
          },
        }),
      ),
    );
  }

  async getKids(userId: string) {
    return this.prisma.kid.findMany({
      where: { parentId: userId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async updateKids(userId: string, updates: updateKidDto[]) {
    const results = [];

    for (const update of updates) {
      const kid = await this.prisma.kid.findFirst({
        where: { id: update.id, parentId: userId },
      });

      if (!kid) {
        throw new NotFoundException(
          `Kid with ID ${update.id} not found or does not belong to user`,
        );
      }

      const data = {
        ...(update.name && { name: update.name }),
        ...(update.avatarUrl && { avatarUrl: update.avatarUrl }),
      };

      const updated = await this.prisma.kid.update({
        where: { id: update.id },
        data,
      });

      results.push(updated);
    }

    return results;
  }

  async deleteKids(userId: string, kidIds: string[]) {
    const results = [];

    for (const id of kidIds) {
      const kid = await this.prisma.kid.findFirst({
        where: { id, parentId: userId },
      });

      if (!kid) {
        throw new NotFoundException(
          `Kid with ID ${id} not found or does not belong to user`,
        );
      }

      const deleted = await this.prisma.kid.delete({ where: { id } });
      results.push(deleted);
    }

    return results;
  }
}

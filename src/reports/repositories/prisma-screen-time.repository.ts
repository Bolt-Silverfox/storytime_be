import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import type {
  IScreenTimeRepository,
  KidWithParentProfile,
} from './screen-time.repository.interface';
import type { ScreenTimeSession, Kid } from '@prisma/client';

@Injectable()
export class PrismaScreenTimeRepository implements IScreenTimeRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findActiveSession(kidId: string): Promise<ScreenTimeSession | null> {
    return this.prisma.screenTimeSession.findFirst({
      where: {
        kidId,
        endTime: null,
      },
    });
  }

  async createSession(kidId: string, date: Date): Promise<ScreenTimeSession> {
    return this.prisma.screenTimeSession.create({
      data: {
        kidId,
        date,
      },
    });
  }

  async findSessionById(id: string): Promise<ScreenTimeSession | null> {
    return this.prisma.screenTimeSession.findUnique({
      where: { id },
    });
  }

  async updateSession(
    id: string,
    data: { endTime: Date; duration: number },
  ): Promise<ScreenTimeSession> {
    return this.prisma.screenTimeSession.update({
      where: { id },
      data,
    });
  }

  async findSessionsByDateRange(
    kidId: string,
    startDate: Date,
    endDate: Date,
    includeActive = false,
  ): Promise<ScreenTimeSession[]> {
    return this.prisma.screenTimeSession.findMany({
      where: {
        kidId,
        date: {
          gte: startDate,
          lt: endDate,
        },
        ...(includeActive ? {} : { endTime: { not: null } }),
      },
    });
  }

  async findKidWithParentProfile(
    kidId: string,
  ): Promise<KidWithParentProfile | null> {
    return this.prisma.kid.findUnique({
      where: { id: kidId },
      include: {
        parent: {
          include: {
            profile: true,
          },
        },
      },
    });
  }

  async findKidById(kidId: string): Promise<Kid | null> {
    return this.prisma.kid.findUnique({
      where: { id: kidId },
    });
  }
}

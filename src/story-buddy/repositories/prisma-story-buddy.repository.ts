import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  IStoryBuddyRepository,
  StoryBuddyWithCounts,
} from './story-buddy.repository.interface';
import { Prisma, StoryBuddy } from '@prisma/client';

@Injectable()
export class PrismaStoryBuddyRepository implements IStoryBuddyRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findActiveBuddies(): Promise<StoryBuddy[]> {
    return this.prisma.storyBuddy.findMany({
      where: {
        isActive: true,
        isDeleted: false,
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findAllBuddies(): Promise<StoryBuddyWithCounts[]> {
    return this.prisma.storyBuddy.findMany({
      where: {
        isDeleted: false,
      },
      orderBy: { createdAt: 'asc' },
      include: {
        _count: {
          select: {
            kids: true,
            buddyInteractions: true,
          },
        },
      },
    });
  }

  async findBuddyById(
    id: string,
    includeDeleted: boolean = false,
  ): Promise<StoryBuddyWithCounts | null> {
    return this.prisma.storyBuddy.findUnique({
      where: {
        id,
        ...(includeDeleted ? {} : { isDeleted: false }),
      },
      include: {
        _count: {
          select: {
            kids: true,
            buddyInteractions: true,
          },
        },
      },
    });
  }

  async findBuddyByName(
    name: string,
    includeDeleted: boolean = false,
  ): Promise<StoryBuddy | null> {
    return this.prisma.storyBuddy.findFirst({
      where: {
        name,
        ...(includeDeleted ? {} : { isDeleted: false }),
      },
    });
  }

  async createBuddy(data: Prisma.StoryBuddyCreateInput): Promise<StoryBuddy> {
    return this.prisma.storyBuddy.create({ data });
  }

  async updateBuddy(
    id: string,
    data: Prisma.StoryBuddyUpdateInput,
  ): Promise<StoryBuddy> {
    return this.prisma.storyBuddy.update({
      where: { id },
      data,
    });
  }

  async deleteBuddy(id: string): Promise<StoryBuddy> {
    return this.prisma.storyBuddy.delete({
      where: { id },
    });
  }

  async countBuddies(where?: Prisma.StoryBuddyWhereInput): Promise<number> {
    return this.prisma.storyBuddy.count({ where });
  }

  async countInteractions(
    where?: Prisma.BuddyInteractionWhereInput,
  ): Promise<number> {
    return this.prisma.buddyInteraction.count({ where });
  }

  async countKidsWithBuddies(where?: Prisma.KidWhereInput): Promise<number> {
    return this.prisma.kid.count({ where });
  }

  async deleteInteractionsByBuddyId(
    buddyId: string,
  ): Promise<Prisma.BatchPayload> {
    return this.prisma.buddyInteraction.deleteMany({
      where: { buddyId },
    });
  }

  async getBuddyStats() {
    const [totalBuddies, activeBuddies, totalInteractions, kidsWithBuddies] =
      await Promise.all([
        this.countBuddies({ isDeleted: false }),
        this.countBuddies({ isActive: true, isDeleted: false }),
        this.countInteractions(),
        this.countKidsWithBuddies({ storyBuddyId: { not: null } }),
      ]);

    return {
      totalBuddies,
      activeBuddies,
      totalInteractions,
      kidsWithBuddies,
    };
  }
}

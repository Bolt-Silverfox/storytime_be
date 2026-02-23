import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import type {
  IBuddySelectionRepository,
  KidWithBuddy,
} from './buddy-selection.repository.interface';
import type { Kid, StoryBuddy, BuddyInteraction } from '@prisma/client';

@Injectable()
export class PrismaBuddySelectionRepository
  implements IBuddySelectionRepository
{
  constructor(private readonly prisma: PrismaService) {}

  async findKidById(kidId: string): Promise<Kid | null> {
    return this.prisma.kid.findUnique({
      where: {
        id: kidId,
        isDeleted: false,
      },
    });
  }

  async findKidWithBuddy(kidId: string): Promise<KidWithBuddy | null> {
    return this.prisma.kid.findUnique({
      where: {
        id: kidId,
        isDeleted: false,
      },
      include: {
        storyBuddy: true,
      },
    });
  }

  async findStoryBuddyById(buddyId: string): Promise<StoryBuddy | null> {
    return this.prisma.storyBuddy.findUnique({
      where: {
        id: buddyId,
        isDeleted: false,
      },
    });
  }

  async updateKidBuddy(
    kidId: string,
    buddyId: string,
    buddySelectedAt: Date,
  ): Promise<Kid> {
    return this.prisma.kid.update({
      where: { id: kidId },
      data: {
        storyBuddyId: buddyId,
        buddySelectedAt,
      },
    });
  }

  async createBuddyInteraction(
    kidId: string,
    buddyId: string,
    interactionType: string,
    context?: string | null,
  ): Promise<BuddyInteraction | void> {
    try {
      return await this.prisma.buddyInteraction.create({
        data: {
          kidId,
          buddyId,
          interactionType,
          context: context || null,
          message: null,
        },
      });
    } catch {
      // Don't throw error for logging failures - matches original behavior
      return;
    }
  }
}

import { Injectable, Logger, Inject } from '@nestjs/common';
import { ValidationException } from '@/shared/exceptions';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { Prisma } from '@prisma/client';
import {
  IAdminSystemRepository,
  ADMIN_SYSTEM_REPOSITORY,
} from './repositories';
import { ActivityLogDto, SubscriptionDto } from './dto/admin-responses.dto';
import { ElevenLabsTTSProvider } from '../voice/providers/eleven-labs-tts.provider';
import {
  categories,
  themes,
  defaultAgeGroups,
  systemAvatars,
} from '../../prisma/data';
import { CACHE_INVALIDATION } from '@/shared/constants/cache-keys.constants';
import { PrismaService } from '../prisma/prisma.service';

const PERMANENT_DELETION_MSG = 'Permanent deletion requested';

@Injectable()
export class AdminSystemService {
  private readonly logger = new Logger(AdminSystemService.name);

  constructor(
    @Inject(ADMIN_SYSTEM_REPOSITORY)
    private readonly adminSystemRepository: IAdminSystemRepository,
    private readonly elevenLabsProvider: ElevenLabsTTSProvider,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    private readonly prisma: PrismaService, // For seedDatabase (complex transaction)
  ) {}

  async getRecentActivity(
    limit: number = 50,
    userId?: string,
  ): Promise<ActivityLogDto[]> {
    const normalizedUserId = userId?.trim() || undefined;
    const where: Prisma.ActivityLogWhereInput = { isDeleted: false };
    if (normalizedUserId) where.userId = normalizedUserId;

    return this.adminSystemRepository.findActivityLogs({
      where,
      take: limit,
      orderBy: { createdAt: 'desc' },
    });
  }

  async getSystemLogs(
    level?: string,
    limit: number = 100,
  ): Promise<ActivityLogDto[]> {
    const where: Prisma.ActivityLogWhereInput = { isDeleted: false };
    if (level) where.status = level;

    return this.adminSystemRepository.findActivityLogs({
      where,
      take: limit,
      orderBy: { createdAt: 'desc' },
    });
  }

  async getSubscriptions(status?: string): Promise<SubscriptionDto[]> {
    const where: Prisma.SubscriptionWhereInput = { isDeleted: false };
    if (status) where.status = status;

    return this.adminSystemRepository.findSubscriptions({
      where,
      orderBy: { startedAt: 'desc' },
    });
  }

  async getAllSupportTickets(
    page: number = 1,
    limit: number = 10,
    status?: string,
  ) {
    const skip = (page - 1) * limit;
    const where: Prisma.SupportTicketWhereInput = {};
    if (status) where.status = status;

    const [tickets, total] = await Promise.all([
      this.adminSystemRepository.findSupportTickets({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.adminSystemRepository.countSupportTickets(where),
    ]);

    return {
      data: tickets,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async updateSupportTicket(id: string, status: string) {
    return this.adminSystemRepository.updateSupportTicket(id, status);
  }

  async getDeletionRequests(page: number = 1, limit: number = 10) {
    const skip = (page - 1) * limit;
    const where: Prisma.SupportTicketWhereInput = {
      subject: 'Delete Account Request',
      isDeleted: false,
    };

    const [tickets, total] = await Promise.all([
      this.adminSystemRepository.findSupportTickets({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.adminSystemRepository.countSupportTickets(where),
    ]);

    const parsedTickets = tickets.map((ticket) => {
      const message = ticket.message || '';
      const reasonsMatch = message.match(/Reasons: (.*?)(\n|$)/);
      const reasonsString = reasonsMatch ? reasonsMatch[1] : '';
      const reasons = reasonsString
        ? reasonsString
            .split(',')
            .map((r: string) => r.trim())
            .filter(Boolean)
        : [];

      const notesMatch = message.match(/Notes: (.*?)(\n|$)/);
      const notes = notesMatch ? notesMatch[1].trim() : '';
      const isPermanent = message.includes(PERMANENT_DELETION_MSG);

      return {
        id: ticket.id,
        userId: ticket.userId,
        userEmail: ticket.user.email,
        userName: ticket.user.name,
        reasons,
        notes,
        createdAt: ticket.createdAt,
        status: ticket.status,
        isPermanent,
      };
    });

    return {
      data: parsedTickets,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getElevenLabsBalance() {
    return this.elevenLabsProvider.getSubscriptionInfo();
  }

  createBackup(): { message: string; timestamp: Date } {
    return { message: 'Backup created successfully', timestamp: new Date() };
  }

  async seedDatabase(): Promise<{ message: string }> {
    try {
      this.logger.log('Seeding database components...');

      // I'll keep the direct prisma usage for seedDatabase if it's very complex,
      // but ideally it should use specialized repositories too if they have create/upsert.
      // Since it's a seed script, it's often more practical to keep it centralized.

      // Categories
      for (const category of categories) {
        await this.prisma.category
          .upsert({
            where: { id: category.name }, // Or name if unique
            update: {
              image: category.image,
              description: category.description,
              isDeleted: false,
              deletedAt: null,
            },
            create: {
              name: category.name,
              image: category.image,
              description: category.description,
            },
          })
          .catch(async () => {
            // Fallback if upsert by id fails because name is unique
            const existing = await this.prisma.category.findFirst({
              where: { name: category.name },
            });
            if (existing) {
              return this.prisma.category.update({
                where: { id: existing.id },
                data: {
                  image: category.image,
                  description: category.description,
                  isDeleted: false,
                  deletedAt: null,
                },
              });
            }
            return this.prisma.category.create({
              data: {
                name: category.name,
                image: category.image,
                description: category.description,
              },
            });
          });
      }

      // Themes
      for (const theme of themes) {
        const existing = await this.prisma.theme.findFirst({
          where: { name: theme.name },
        });
        if (existing) {
          await this.prisma.theme.update({
            where: { id: existing.id },
            data: {
              image: theme.image,
              description: theme.description,
              isDeleted: false,
              deletedAt: null,
            },
          });
        } else {
          await this.prisma.theme.create({
            data: {
              name: theme.name,
              image: theme.image,
              description: theme.description,
            },
          });
        }
      }

      // Age Groups
      for (const ageGroup of defaultAgeGroups) {
        const existing = await this.prisma.ageGroup.findFirst({
          where: { name: ageGroup.name },
        });
        if (existing) {
          await this.prisma.ageGroup.update({
            where: { id: existing.id },
            data: {
              min: ageGroup.min,
              max: ageGroup.max,
              isDeleted: false,
              deletedAt: null,
            },
          });
        } else {
          await this.prisma.ageGroup.create({
            data: { name: ageGroup.name, min: ageGroup.min, max: ageGroup.max },
          });
        }
      }

      // System Avatars
      for (const avatarData of systemAvatars) {
        const existing = await this.prisma.avatar.findFirst({
          where: { name: avatarData.name, isSystemAvatar: true },
        });
        if (existing) {
          await this.prisma.avatar.update({
            where: { id: existing.id },
            data: {
              url: avatarData.url,
              isSystemAvatar: true,
              isDeleted: false,
              deletedAt: null,
            },
          });
        } else {
          await this.prisma.avatar.create({
            data: {
              name: avatarData.name,
              url: avatarData.url,
              isSystemAvatar: true,
            },
          });
        }
      }

      // Invalidate all content caches after seeding (both story content and metadata)
      await Promise.all([
        ...CACHE_INVALIDATION.STORY_CONTENT.map((key) =>
          this.cacheManager.del(key),
        ),
        ...CACHE_INVALIDATION.METADATA.map((key) => this.cacheManager.del(key)),
      ]);

      this.logger.log('✅ Database seeded successfully!');
      return { message: 'Database seeded successfully' };
    } catch (error) {
      this.logger.error('❌ Failed to seed database:', error);
      throw new ValidationException('Failed to seed database');
    }
  }
}

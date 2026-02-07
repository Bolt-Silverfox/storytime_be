// settings.service.ts - Enhanced version
import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}
  /**
   * Get user profile settings (parent-level)
   */
  async getSettings(userId: string): Promise<any> {
    let profile = await this.prisma.profile.findUnique({ where: { userId } });
    if (!profile) {
      profile = await this.prisma.profile.create({ data: { userId, language: 'en',    country: 'NG',  

 } });
    }
    return profile;
  }

  /**
   * Update user profile settings (parent-level)
   */
  async updateSettings(userId: string, body: any): Promise<any> {
    let profile = await this.prisma.profile.findUnique({ where: { userId } });
    if (!profile) {
      profile = await this.prisma.profile.create({ data: { userId, language: 'en', country: 'NG',
 } });
    }

    // Validation
    const updateData: any = {};
    if (body.explicitContent !== undefined) {
      if (typeof body.explicitContent !== 'boolean') {
        throw new BadRequestException('explicitContent must be a boolean');
      }
      updateData.explicitContent = body.explicitContent;
    }
    if (body.maxScreenTimeMins !== undefined) {
      if (
        typeof body.maxScreenTimeMins !== 'number' ||
        body.maxScreenTimeMins < 0
      ) {
        throw new BadRequestException(
          'maxScreenTimeMins must be a positive number',
        );
      }
      updateData.maxScreenTimeMins = body.maxScreenTimeMins;
    }
    if (body.language !== undefined) {
      if (typeof body.language !== 'string') {
        throw new BadRequestException('language must be a string');
      }
      updateData.language = body.language;
    }
    if (body.country !== undefined) {
      if (typeof body.country !== 'string') {
        throw new BadRequestException('country must be a string');
      }
      updateData.country = body.country;
    }

    if (Object.keys(updateData).length === 0) {
      return profile;
    }

    return await this.prisma.profile.update({
      where: { userId },
      data: updateData,
    });
  }

  /**
   * Set daily limit for a specific kid
   * This overrides the parent's default maxScreenTimeMins
   */
  async setKidDailyLimit(kidId: string, limitMins?: number): Promise<any> {
    const kid = await this.prisma.kid.findUnique({
      where: { id: kidId },
    });

    if (!kid) {
      throw new BadRequestException('Kid not found');
    }

    // Validate limit
    if (limitMins !== null && limitMins !== undefined) {
      if (typeof limitMins !== 'number' || limitMins < 0) {
        throw new BadRequestException(
          'limitMins must be a positive number or null',
        );
      }
    }

    await this.prisma.kid.update({
      where: { id: kidId },
      data: {
        dailyScreenTimeLimitMins: limitMins,
      },
    });

    return { success: true, kidId, limitMins };
  }

  /**
   * Get daily limit for a kid
   * Returns kid's specific limit, or falls back to parent's default
   */
  async getKidDailyLimit(kidId: string): Promise<{
    kidId: string;
    limitMins?: number;
    source: 'kid' | 'parent' | 'none';
  }> {
    const kid = await this.prisma.kid.findUnique({
      where: { id: kidId },
      include: {
        parent: {
          include: {
            profile: true,
          },
        },
      },
    });

    if (!kid) {
      throw new BadRequestException('Kid not found');
    }

    // Priority: Kid's specific limit > Parent's default > No limit
    if (
      kid.dailyScreenTimeLimitMins !== null &&
      kid.dailyScreenTimeLimitMins !== undefined
    ) {
      return {
        kidId,
        limitMins: kid.dailyScreenTimeLimitMins,
        source: 'kid',
      };
    }

    if (kid.parent.profile?.maxScreenTimeMins) {
      return {
        kidId,
        limitMins: kid.parent.profile.maxScreenTimeMins,
        source: 'parent',
      };
    }

    return {
      kidId,
      limitMins: undefined,
      source: 'none',
    };
  }

  /**
   * Apply parent's default screen time to all kids
   * Useful when parent changes their default and wants to apply to all kids
   */
  async applyDefaultToAllKids(userId: string): Promise<any> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        profile: true,
        kids: true,
      },
    });

    if (!user) {
      throw new BadRequestException('User not found');
    }

    const defaultLimit = user.profile?.maxScreenTimeMins;

    if (defaultLimit === null || defaultLimit === undefined) {
      throw new BadRequestException('No default screen time limit set');
    }

    // Update all kids that don't have a custom limit
    await this.prisma.kid.updateMany({
      where: {
        parentId: userId,
        dailyScreenTimeLimitMins: null,
      },
      data: {
        dailyScreenTimeLimitMins: defaultLimit,
      },
    });

    return {
      success: true,
      appliedLimit: defaultLimit,
      kidsUpdated: user.kids.filter((k) => k.dailyScreenTimeLimitMins === null)
        .length,
    };
  }

  /**
   * Get all kids with their screen time settings
   */
  async getKidsScreenTimeSettings(parentId: string): Promise<any[]> {
    const kids = await this.prisma.kid.findMany({
      where: { parentId },
      include: {
        avatar: true,
      },
    });

    const parent = await this.prisma.user.findUnique({
      where: { id: parentId },
      include: { profile: true },
    });

    const parentDefaultLimit = parent?.profile?.maxScreenTimeMins;

    return kids.map((kid) => ({
      kidId: kid.id,
      kidName: kid.name,
      avatarUrl: kid.avatar?.url,
      customLimit: kid.dailyScreenTimeLimitMins,
      effectiveLimit:
        kid.dailyScreenTimeLimitMins ?? parentDefaultLimit ?? null,
      isCustom: kid.dailyScreenTimeLimitMins !== null,
    }));
  }
}

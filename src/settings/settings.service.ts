// settings.service.ts - Enhanced version with caching and repository pattern
import { Injectable, Inject, BadRequestException } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { Profile } from '@prisma/client';
import { ISettingsRepository, SETTINGS_REPOSITORY } from './repositories';
import {
  CACHE_KEYS,
  CACHE_TTL_MS,
} from '@/shared/constants/cache-keys.constants';

export interface UpdateSettingsBody {
  explicitContent?: boolean;
  maxScreenTimeMins?: number;
  language?: string;
  country?: string;
}

@Injectable()
export class SettingsService {
  constructor(
    @Inject(SETTINGS_REPOSITORY)
    private readonly settingsRepository: ISettingsRepository,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {}

  /**
   * Invalidate user preferences cache
   */
  private async invalidateUserPreferencesCache(userId: string): Promise<void> {
    await this.cacheManager.del(CACHE_KEYS.USER_PREFERENCES(userId));
  }

  /**
   * Get user profile settings (parent-level)
   * Uses caching for improved performance (5-minute TTL)
   */
  async getSettings(userId: string): Promise<Profile> {
    // Check cache first
    const cacheKey = CACHE_KEYS.USER_PREFERENCES(userId);
    const cached = await this.cacheManager.get<Profile>(cacheKey);
    if (cached) {
      return cached;
    }

    let profile = await this.settingsRepository.findProfileByUserId(userId);
    if (!profile) {
      profile = await this.settingsRepository.createProfile(userId, {
        language: 'en',
        country: 'NG',
      });
    }

    // Cache for 5 minutes
    await this.cacheManager.set(cacheKey, profile, CACHE_TTL_MS.USER_DATA);

    return profile;
  }

  /**
   * Update user profile settings (parent-level)
   */
  async updateSettings(
    userId: string,
    body: UpdateSettingsBody,
  ): Promise<Profile> {
    let profile = await this.settingsRepository.findProfileByUserId(userId);
    if (!profile) {
      profile = await this.settingsRepository.createProfile(userId, {
        language: 'en',
        country: 'NG',
      });
    }

    // Validation
    const updateData: Partial<
      Pick<
        Profile,
        'explicitContent' | 'maxScreenTimeMins' | 'language' | 'country'
      >
    > = {};
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

    const updatedProfile = await this.settingsRepository.updateProfile(
      userId,
      updateData,
    );

    // Invalidate cache after update
    await this.invalidateUserPreferencesCache(userId);

    return updatedProfile;
  }

  /**
   * Set daily limit for a specific kid
   * This overrides the parent's default maxScreenTimeMins
   */
  async setKidDailyLimit(
    kidId: string,
    limitMins?: number,
  ): Promise<{ success: boolean; kidId: string; limitMins?: number }> {
    const kid = await this.settingsRepository.findKidById(kidId);

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

    await this.settingsRepository.updateKidScreenTimeLimit(
      kidId,
      limitMins ?? null,
    );

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
    const kid = await this.settingsRepository.findKidWithParentProfile(kidId);

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
  async applyDefaultToAllKids(
    userId: string,
  ): Promise<{ success: boolean; appliedLimit: number; kidsUpdated: number }> {
    const user =
      await this.settingsRepository.findUserWithProfileAndKids(userId);

    if (!user) {
      throw new BadRequestException('User not found');
    }

    const defaultLimit = user.profile?.maxScreenTimeMins;

    if (defaultLimit === null || defaultLimit === undefined) {
      throw new BadRequestException('No default screen time limit set');
    }

    // Count kids that will be updated before the update
    const kidsToUpdate = user.kids.filter(
      (k) => k.dailyScreenTimeLimitMins === null,
    ).length;

    // Update all kids that don't have a custom limit
    await this.settingsRepository.updateManyKidsScreenTimeLimit(
      userId,
      null,
      defaultLimit,
    );

    return {
      success: true,
      appliedLimit: defaultLimit,
      kidsUpdated: kidsToUpdate,
    };
  }

  /**
   * Get all kids with their screen time settings
   */
  async getKidsScreenTimeSettings(parentId: string): Promise<
    {
      kidId: string;
      kidName: string | null;
      avatarUrl: string | undefined;
      customLimit: number | null;
      effectiveLimit: number | null;
      isCustom: boolean;
    }[]
  > {
    const kids =
      await this.settingsRepository.findKidsByParentWithAvatar(parentId);
    const parent = await this.settingsRepository.findUserWithProfile(parentId);

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

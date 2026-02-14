import {
  Injectable,
  Logger,
  ConflictException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { DeviceToken, DevicePlatform } from '@prisma/client';

export interface RegisterDeviceDto {
  token: string;
  platform: DevicePlatform;
}

export interface DeviceTokenResponse {
  id: string;
  platform: DevicePlatform;
  isActive: boolean;
  createdAt: Date;
  lastUsed: Date;
}

@Injectable()
export class DeviceTokenService {
  private readonly logger = new Logger(DeviceTokenService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Register a device token for push notifications
   * If the token already exists for another user, it will be reassigned
   */
  async registerDeviceToken(
    userId: string,
    dto: RegisterDeviceDto,
  ): Promise<DeviceTokenResponse> {
    const { token, platform } = dto;

    // Check if token already exists
    const existingToken = await this.prisma.deviceToken.findUnique({
      where: { token },
    });

    if (existingToken) {
      // If same user, just reactivate and update
      if (existingToken.userId === userId) {
        const updated = await this.prisma.deviceToken.update({
          where: { token },
          data: {
            isActive: true,
            platform,
            lastUsed: new Date(),
          },
        });

        this.logger.log(
          `Reactivated device token for user ${userId} (${platform})`,
        );
        return this.toResponse(updated);
      }

      // Token belongs to another user - reassign it
      // (This happens when user logs out and another user logs in on same device)
      const reassigned = await this.prisma.deviceToken.update({
        where: { token },
        data: {
          userId,
          platform,
          isActive: true,
          lastUsed: new Date(),
        },
      });

      this.logger.log(
        `Reassigned device token to user ${userId} (${platform})`,
      );
      return this.toResponse(reassigned);
    }

    // Create new token
    const created = await this.prisma.deviceToken.create({
      data: {
        userId,
        token,
        platform,
        isActive: true,
      },
    });

    this.logger.log(
      `Registered new device token for user ${userId} (${platform})`,
    );
    return this.toResponse(created);
  }

  /**
   * Unregister a device token
   * Only the owner can unregister their token
   */
  async unregisterDeviceToken(
    userId: string,
    token: string,
  ): Promise<{ success: boolean }> {
    const deviceToken = await this.prisma.deviceToken.findUnique({
      where: { token },
    });

    if (!deviceToken) {
      throw new NotFoundException('Device token not found');
    }

    if (deviceToken.userId !== userId) {
      throw new ForbiddenException("Cannot unregister another user's device");
    }

    // Soft delete by marking as inactive
    await this.prisma.deviceToken.update({
      where: { token },
      data: { isActive: false },
    });

    this.logger.log(`Unregistered device token for user ${userId}`);
    return { success: true };
  }

  /**
   * Get all active device tokens for a user
   */
  async getUserDeviceTokens(userId: string): Promise<DeviceTokenResponse[]> {
    const tokens = await this.prisma.deviceToken.findMany({
      where: {
        userId,
        isActive: true,
      },
      orderBy: { lastUsed: 'desc' },
    });

    return tokens.map((t) => this.toResponse(t));
  }

  /**
   * Unregister all device tokens for a user (e.g., on logout from all devices)
   */
  async unregisterAllUserTokens(userId: string): Promise<{ count: number }> {
    const result = await this.prisma.deviceToken.updateMany({
      where: {
        userId,
        isActive: true,
      },
      data: { isActive: false },
    });

    this.logger.log(
      `Unregistered ${result.count} device tokens for user ${userId}`,
    );
    return { count: result.count };
  }

  /**
   * Check if user has any active mobile device tokens
   * (Used to determine if push notifications are available)
   */
  async hasActiveMobileTokens(userId: string): Promise<boolean> {
    const count = await this.prisma.deviceToken.count({
      where: {
        userId,
        isActive: true,
        platform: { in: ['ios', 'android'] },
      },
    });

    return count > 0;
  }

  /**
   * Check if user has web token registered (for SSE preference)
   */
  async hasActiveWebToken(userId: string): Promise<boolean> {
    const count = await this.prisma.deviceToken.count({
      where: {
        userId,
        isActive: true,
        platform: 'web',
      },
    });

    return count > 0;
  }

  /**
   * Clean up stale tokens (not used in last 90 days)
   * Should be run as a scheduled job
   */
  async cleanupStaleTokens(): Promise<{ count: number }> {
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    const result = await this.prisma.deviceToken.deleteMany({
      where: {
        OR: [
          { isActive: false },
          { lastUsed: { lt: ninetyDaysAgo } },
        ],
      },
    });

    this.logger.log(`Cleaned up ${result.count} stale device tokens`);
    return { count: result.count };
  }

  private toResponse(token: DeviceToken): DeviceTokenResponse {
    return {
      id: token.id,
      platform: token.platform,
      isActive: token.isActive,
      createdAt: token.createdAt,
      lastUsed: token.lastUsed,
    };
  }
}

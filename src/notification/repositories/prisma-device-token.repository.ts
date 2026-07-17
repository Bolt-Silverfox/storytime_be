import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import type { IDeviceTokenRepository } from './device-token.repository.interface';
import type { DeviceToken, DevicePlatform, Prisma } from '@prisma/client';

@Injectable()
export class PrismaDeviceTokenRepository implements IDeviceTokenRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findUniqueByToken(token: string): Promise<DeviceToken | null> {
    return this.prisma.deviceToken.findUnique({
      where: { token },
    });
  }

  async findFirstByUserAndTokenNotDeleted(
    userId: string,
    token: string,
  ): Promise<DeviceToken | null> {
    return this.prisma.deviceToken.findFirst({
      where: {
        userId,
        token,
        isDeleted: false,
      },
    });
  }

  async findActiveByUser(userId: string): Promise<DeviceToken[]> {
    return this.prisma.deviceToken.findMany({
      where: {
        userId,
        isActive: true,
      },
      orderBy: { lastUsed: 'desc' },
    });
  }

  async findActiveNotDeletedByUser(userId: string): Promise<DeviceToken[]> {
    return this.prisma.deviceToken.findMany({
      where: {
        userId,
        isActive: true,
        isDeleted: false,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findTokensForDeviceDedup(params: {
    userId: string;
    platform: DevicePlatform;
    deviceName: string;
    token: string;
  }): Promise<{ token: string }[]> {
    return this.prisma.deviceToken.findMany({
      where: {
        userId: params.userId,
        platform: params.platform,
        deviceName: params.deviceName,
        isDeleted: false,
        token: { not: params.token },
      },
      select: { token: true },
    });
  }

  async findActiveMobileTokens(
    userId: string,
  ): Promise<{ token: string }[]> {
    return this.prisma.deviceToken.findMany({
      where: {
        userId,
        isActive: true,
        platform: { in: ['ios', 'android'] },
      },
      select: { token: true },
    });
  }

  async findActiveNotDeletedWithIds(
    userId: string,
  ): Promise<{ id: string; token: string }[]> {
    return this.prisma.deviceToken.findMany({
      where: {
        userId,
        isActive: true,
        isDeleted: false,
      },
      select: { id: true, token: true },
    });
  }

  async findActiveNotDeletedBatch(params: {
    take: number;
    cursor?: string;
  }): Promise<{ id: string; token: string }[]> {
    return this.prisma.deviceToken.findMany({
      where: { isActive: true, isDeleted: false },
      select: { id: true, token: true },
      take: params.take,
      ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
      orderBy: { id: 'asc' },
    });
  }

  async countActiveMobileTokens(userId: string): Promise<number> {
    return this.prisma.deviceToken.count({
      where: {
        userId,
        isActive: true,
        platform: { in: ['ios', 'android'] },
      },
    });
  }

  async countActiveWebTokens(userId: string): Promise<number> {
    return this.prisma.deviceToken.count({
      where: {
        userId,
        isActive: true,
        platform: 'web',
      },
    });
  }

  async createToken(
    data: Prisma.DeviceTokenUncheckedCreateInput,
    tx?: Prisma.TransactionClient,
  ): Promise<DeviceToken> {
    const client = tx ?? this.prisma;
    return client.deviceToken.create({ data });
  }

  async updateByToken(
    token: string,
    data: Prisma.DeviceTokenUncheckedUpdateInput,
  ): Promise<DeviceToken> {
    return this.prisma.deviceToken.update({
      where: { token },
      data,
    });
  }

  async updateById(
    id: string,
    data: Prisma.DeviceTokenUncheckedUpdateInput,
  ): Promise<DeviceToken> {
    return this.prisma.deviceToken.update({
      where: { id },
      data,
    });
  }

  async updateManyTokens(
    where: Prisma.DeviceTokenWhereInput,
    data: Prisma.DeviceTokenUncheckedUpdateManyInput,
    tx?: Prisma.TransactionClient,
  ): Promise<{ count: number }> {
    const client = tx ?? this.prisma;
    return client.deviceToken.updateMany({ where, data });
  }

  async deleteStaleTokens(cutoff: Date): Promise<{ count: number }> {
    return this.prisma.deviceToken.deleteMany({
      where: {
        OR: [{ isActive: false }, { lastUsed: { lt: cutoff } }],
      },
    });
  }

  async executeTransaction<T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(fn);
  }
}

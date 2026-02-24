import { Test, TestingModule } from '@nestjs/testing';
import { DeviceTokenService, RegisterDeviceDto } from './device-token.service';
import {
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { DevicePlatform } from '@prisma/client';

describe('DeviceTokenService', () => {
  let service: DeviceTokenService;
  let prismaService: {
    deviceToken: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
      deleteMany: jest.Mock;
      count: jest.Mock;
    };
    $transaction: jest.Mock;
  };

  const mockDeviceToken = {
    id: 'token-1',
    userId: 'user-1',
    token: 'device-token-abc',
    platform: 'ios' as DevicePlatform,
    deviceName: 'iPhone 15',
    isActive: true,
    isDeleted: false,
    deletedAt: null,
    createdAt: new Date('2026-01-01'),
    lastUsed: new Date('2026-01-15'),
  };

  beforeEach(async () => {
    const mockPrismaService: any = {
      deviceToken: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        deleteMany: jest.fn(),
        count: jest.fn(),
      },
      $transaction: jest.fn((fn) => fn(mockPrismaService)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DeviceTokenService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<DeviceTokenService>(DeviceTokenService);
    prismaService = module.get(PrismaService);
  });

  describe('registerDeviceToken', () => {
    const dto: RegisterDeviceDto = {
      token: 'device-token-abc',
      platform: 'ios' as DevicePlatform,
      deviceName: 'iPhone 15',
    };

    it('should reactivate an existing token for the same user', async () => {
      const existingToken = { ...mockDeviceToken, isActive: false };
      const updatedToken = { ...mockDeviceToken, isActive: true };

      prismaService.deviceToken.findUnique.mockResolvedValue(existingToken);
      prismaService.deviceToken.update.mockResolvedValue(updatedToken);

      const result = await service.registerDeviceToken('user-1', dto);

      expect(result.id).toBe('token-1');
      expect(result.isActive).toBe(true);
      expect(result.platform).toBe('ios');
      expect(prismaService.deviceToken.findUnique).toHaveBeenCalledWith({
        where: { token: 'device-token-abc' },
      });
      expect(prismaService.deviceToken.update).toHaveBeenCalledWith({
        where: { token: 'device-token-abc' },
        data: expect.objectContaining({
          isActive: true,
          platform: 'ios',
          deviceName: 'iPhone 15',
        }),
      });
    });

    it('should reassign token to a different user when token belongs to another user', async () => {
      const existingToken = { ...mockDeviceToken, userId: 'user-2' };
      const reassignedToken = { ...mockDeviceToken, userId: 'user-1' };

      prismaService.deviceToken.findUnique.mockResolvedValue(existingToken);
      prismaService.deviceToken.update.mockResolvedValue(reassignedToken);

      const result = await service.registerDeviceToken('user-1', dto);

      expect(result.id).toBe('token-1');
      expect(prismaService.deviceToken.update).toHaveBeenCalledWith({
        where: { token: 'device-token-abc' },
        data: expect.objectContaining({
          userId: 'user-1',
          platform: 'ios',
          isActive: true,
        }),
      });
    });

    it('should create a new token and deactivate old tokens for same device', async () => {
      const createdToken = { ...mockDeviceToken, token: 'new-device-token' };

      prismaService.deviceToken.findUnique.mockResolvedValue(null);
      prismaService.deviceToken.updateMany.mockResolvedValue({ count: 1 });
      prismaService.deviceToken.create.mockResolvedValue(createdToken);

      const newDto: RegisterDeviceDto = {
        token: 'new-device-token',
        platform: 'ios' as DevicePlatform,
        deviceName: 'iPhone 15',
      };

      const result = await service.registerDeviceToken('user-1', newDto);

      expect(result.id).toBe('token-1');
      expect(prismaService.$transaction).toHaveBeenCalled();
      expect(prismaService.deviceToken.updateMany).toHaveBeenCalledWith({
        where: {
          userId: 'user-1',
          platform: 'ios',
          deviceName: 'iPhone 15',
          isDeleted: false,
          token: { not: 'new-device-token' },
        },
        data: expect.objectContaining({
          isActive: false,
          isDeleted: true,
        }),
      });
      expect(prismaService.deviceToken.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          token: 'new-device-token',
          platform: 'ios',
          isActive: true,
          deviceName: 'iPhone 15',
        },
      });
    });

    it('should create a new token without deduplication when deviceName is not provided', async () => {
      const createdToken = {
        ...mockDeviceToken,
        deviceName: undefined,
        token: 'new-device-token',
      };

      prismaService.deviceToken.findUnique.mockResolvedValue(null);
      prismaService.deviceToken.create.mockResolvedValue(createdToken);

      const noNameDto: RegisterDeviceDto = {
        token: 'new-device-token',
        platform: 'ios' as DevicePlatform,
      };

      await service.registerDeviceToken('user-1', noNameDto);

      expect(prismaService.deviceToken.updateMany).not.toHaveBeenCalled();
      expect(prismaService.deviceToken.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          token: 'new-device-token',
          platform: 'ios',
          isActive: true,
          deviceName: undefined,
        },
      });
    });

    it('should not include deviceName in update when it is undefined on reactivation', async () => {
      const existingToken = { ...mockDeviceToken };
      const updatedToken = { ...mockDeviceToken };

      prismaService.deviceToken.findUnique.mockResolvedValue(existingToken);
      prismaService.deviceToken.update.mockResolvedValue(updatedToken);

      const noNameDto: RegisterDeviceDto = {
        token: 'device-token-abc',
        platform: 'ios' as DevicePlatform,
      };

      await service.registerDeviceToken('user-1', noNameDto);

      expect(prismaService.deviceToken.update).toHaveBeenCalledWith({
        where: { token: 'device-token-abc' },
        data: expect.not.objectContaining({ deviceName: expect.anything() }),
      });
    });
  });

  describe('unregisterDeviceToken', () => {
    it('should unregister a token owned by the user', async () => {
      prismaService.deviceToken.findUnique.mockResolvedValue(mockDeviceToken);
      prismaService.deviceToken.update.mockResolvedValue({
        ...mockDeviceToken,
        isActive: false,
      });

      const result = await service.unregisterDeviceToken(
        'user-1',
        'device-token-abc',
      );

      expect(result).toEqual({ success: true });
      expect(prismaService.deviceToken.update).toHaveBeenCalledWith({
        where: { token: 'device-token-abc' },
        data: { isActive: false },
      });
    });

    it('should throw NotFoundException when token does not exist', async () => {
      prismaService.deviceToken.findUnique.mockResolvedValue(null);

      await expect(
        service.unregisterDeviceToken('user-1', 'nonexistent-token'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException when token belongs to another user', async () => {
      prismaService.deviceToken.findUnique.mockResolvedValue(mockDeviceToken);

      await expect(
        service.unregisterDeviceToken('user-2', 'device-token-abc'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('getUserDeviceTokens', () => {
    it('should return active device tokens for a user', async () => {
      const tokens = [
        mockDeviceToken,
        { ...mockDeviceToken, id: 'token-2', platform: 'android' },
      ];

      prismaService.deviceToken.findMany.mockResolvedValue(tokens);

      const result = await service.getUserDeviceTokens('user-1');

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('token-1');
      expect(result[1].platform).toBe('android');
      expect(prismaService.deviceToken.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', isActive: true },
        orderBy: { lastUsed: 'desc' },
      });
    });

    it('should return empty array when user has no active tokens', async () => {
      prismaService.deviceToken.findMany.mockResolvedValue([]);

      const result = await service.getUserDeviceTokens('user-1');

      expect(result).toEqual([]);
    });
  });

  describe('unregisterAllUserTokens', () => {
    it('should deactivate all active tokens for a user', async () => {
      prismaService.deviceToken.updateMany.mockResolvedValue({ count: 3 });

      const result = await service.unregisterAllUserTokens('user-1');

      expect(result).toEqual({ count: 3 });
      expect(prismaService.deviceToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', isActive: true },
        data: { isActive: false },
      });
    });

    it('should return zero count when user has no active tokens', async () => {
      prismaService.deviceToken.updateMany.mockResolvedValue({ count: 0 });

      const result = await service.unregisterAllUserTokens('user-1');

      expect(result).toEqual({ count: 0 });
    });
  });

  describe('hasActiveMobileTokens', () => {
    it('should return true when user has active mobile tokens', async () => {
      prismaService.deviceToken.count.mockResolvedValue(2);

      const result = await service.hasActiveMobileTokens('user-1');

      expect(result).toBe(true);
      expect(prismaService.deviceToken.count).toHaveBeenCalledWith({
        where: {
          userId: 'user-1',
          isActive: true,
          platform: { in: ['ios', 'android'] },
        },
      });
    });

    it('should return false when user has no active mobile tokens', async () => {
      prismaService.deviceToken.count.mockResolvedValue(0);

      const result = await service.hasActiveMobileTokens('user-1');

      expect(result).toBe(false);
    });
  });

  describe('hasActiveWebToken', () => {
    it('should return true when user has an active web token', async () => {
      prismaService.deviceToken.count.mockResolvedValue(1);

      const result = await service.hasActiveWebToken('user-1');

      expect(result).toBe(true);
      expect(prismaService.deviceToken.count).toHaveBeenCalledWith({
        where: {
          userId: 'user-1',
          isActive: true,
          platform: 'web',
        },
      });
    });

    it('should return false when user has no active web token', async () => {
      prismaService.deviceToken.count.mockResolvedValue(0);

      const result = await service.hasActiveWebToken('user-1');

      expect(result).toBe(false);
    });
  });

  describe('cleanupStaleTokens', () => {
    it('should delete stale and inactive tokens', async () => {
      prismaService.deviceToken.deleteMany.mockResolvedValue({ count: 5 });

      const result = await service.cleanupStaleTokens();

      expect(result).toEqual({ count: 5 });
      expect(prismaService.deviceToken.deleteMany).toHaveBeenCalledWith({
        where: {
          OR: [{ isActive: false }, { lastUsed: { lt: expect.any(Date) } }],
        },
      });
    });

    it('should return zero count when there are no stale tokens', async () => {
      prismaService.deviceToken.deleteMany.mockResolvedValue({ count: 0 });

      const result = await service.cleanupStaleTokens();

      expect(result).toEqual({ count: 0 });
    });
  });
});

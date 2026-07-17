import { Test, TestingModule } from '@nestjs/testing';
import { DeviceTokenService, RegisterDeviceDto } from './device-token.service';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import {
  DEVICE_TOKEN_REPOSITORY,
  IDeviceTokenRepository,
} from '../repositories';
import { DevicePlatform } from '@prisma/client';

describe('DeviceTokenService', () => {
  let service: DeviceTokenService;
  let repository: jest.Mocked<IDeviceTokenRepository>;

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
    updatedAt: new Date('2026-01-15'),
    lastUsed: new Date('2026-01-15'),
  };

  beforeEach(async () => {
    const mockRepository: Record<keyof IDeviceTokenRepository, jest.Mock> = {
      findUniqueByToken: jest.fn(),
      findFirstByUserAndTokenNotDeleted: jest.fn(),
      findActiveByUser: jest.fn(),
      findActiveNotDeletedByUser: jest.fn(),
      findTokensForDeviceDedup: jest.fn(),
      findActiveMobileTokens: jest.fn(),
      findActiveNotDeletedWithIds: jest.fn(),
      findActiveNotDeletedBatch: jest.fn(),
      countActiveMobileTokens: jest.fn(),
      countActiveWebTokens: jest.fn(),
      createToken: jest.fn(),
      updateByToken: jest.fn(),
      updateById: jest.fn(),
      updateManyTokens: jest.fn(),
      deleteStaleTokens: jest.fn(),
      // Execute the transaction callback immediately with a dummy tx client
      executeTransaction: jest.fn((fn) => fn({})),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DeviceTokenService,
        { provide: DEVICE_TOKEN_REPOSITORY, useValue: mockRepository },
      ],
    }).compile();

    service = module.get<DeviceTokenService>(DeviceTokenService);
    repository = module.get(DEVICE_TOKEN_REPOSITORY);
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

      repository.findUniqueByToken.mockResolvedValue(existingToken);
      repository.updateByToken.mockResolvedValue(updatedToken);

      const result = await service.registerDeviceToken('user-1', dto);

      expect(result.id).toBe('token-1');
      expect(result.isActive).toBe(true);
      expect(result.platform).toBe('ios');
      expect(repository.findUniqueByToken).toHaveBeenCalledWith(
        'device-token-abc',
      );
      expect(repository.updateByToken).toHaveBeenCalledWith(
        'device-token-abc',
        expect.objectContaining({
          isActive: true,
          platform: 'ios',
          deviceName: 'iPhone 15',
        }),
      );
    });

    it('should reassign token to a different user when token belongs to another user', async () => {
      const existingToken = { ...mockDeviceToken, userId: 'user-2' };
      const reassignedToken = { ...mockDeviceToken, userId: 'user-1' };

      repository.findUniqueByToken.mockResolvedValue(existingToken);
      repository.updateByToken.mockResolvedValue(reassignedToken);

      const result = await service.registerDeviceToken('user-1', dto);

      expect(result.id).toBe('token-1');
      expect(repository.updateByToken).toHaveBeenCalledWith(
        'device-token-abc',
        expect.objectContaining({
          userId: 'user-1',
          platform: 'ios',
          isActive: true,
        }),
      );
    });

    it('should create a new token and deactivate old tokens for same device', async () => {
      const createdToken = { ...mockDeviceToken, token: 'new-device-token' };

      repository.findUniqueByToken.mockResolvedValue(null);
      repository.updateManyTokens.mockResolvedValue({ count: 1 });
      repository.createToken.mockResolvedValue(createdToken);

      const newDto: RegisterDeviceDto = {
        token: 'new-device-token',
        platform: 'ios' as DevicePlatform,
        deviceName: 'iPhone 15',
      };

      const result = await service.registerDeviceToken('user-1', newDto);

      expect(result.id).toBe('token-1');
      expect(repository.executeTransaction).toHaveBeenCalled();
      expect(repository.updateManyTokens).toHaveBeenCalledWith(
        {
          userId: 'user-1',
          platform: 'ios',
          deviceName: 'iPhone 15',
          isDeleted: false,
          token: { not: 'new-device-token' },
        },
        expect.objectContaining({
          isActive: false,
          isDeleted: true,
        }),
        expect.anything(),
      );
      expect(repository.createToken).toHaveBeenCalledWith(
        {
          userId: 'user-1',
          token: 'new-device-token',
          platform: 'ios',
          isActive: true,
          deviceName: 'iPhone 15',
        },
        expect.anything(),
      );
    });

    it('should create a new token without deduplication when deviceName is not provided', async () => {
      const createdToken = {
        ...mockDeviceToken,
        deviceName: null,
        token: 'new-device-token',
      };

      repository.findUniqueByToken.mockResolvedValue(null);
      repository.createToken.mockResolvedValue(createdToken);

      const noNameDto: RegisterDeviceDto = {
        token: 'new-device-token',
        platform: 'ios' as DevicePlatform,
      };

      await service.registerDeviceToken('user-1', noNameDto);

      expect(repository.updateManyTokens).not.toHaveBeenCalled();
      expect(repository.createToken).toHaveBeenCalledWith(
        {
          userId: 'user-1',
          token: 'new-device-token',
          platform: 'ios',
          isActive: true,
          deviceName: undefined,
        },
        expect.anything(),
      );
    });

    it('should not include deviceName in update when it is undefined on reactivation', async () => {
      const existingToken = { ...mockDeviceToken };
      const updatedToken = { ...mockDeviceToken };

      repository.findUniqueByToken.mockResolvedValue(existingToken);
      repository.updateByToken.mockResolvedValue(updatedToken);

      const noNameDto: RegisterDeviceDto = {
        token: 'device-token-abc',
        platform: 'ios' as DevicePlatform,
      };

      await service.registerDeviceToken('user-1', noNameDto);

      expect(repository.updateByToken).toHaveBeenCalledWith(
        'device-token-abc',
        expect.not.objectContaining({ deviceName: expect.anything() }),
      );
    });
  });

  describe('unregisterDeviceToken', () => {
    it('should unregister a token owned by the user', async () => {
      repository.findUniqueByToken.mockResolvedValue(mockDeviceToken);
      repository.updateByToken.mockResolvedValue({
        ...mockDeviceToken,
        isActive: false,
      });

      const result = await service.unregisterDeviceToken(
        'user-1',
        'device-token-abc',
      );

      expect(result).toEqual({ success: true });
      expect(repository.updateByToken).toHaveBeenCalledWith('device-token-abc', {
        isActive: false,
      });
    });

    it('should throw NotFoundException when token does not exist', async () => {
      repository.findUniqueByToken.mockResolvedValue(null);

      await expect(
        service.unregisterDeviceToken('user-1', 'nonexistent-token'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException when token belongs to another user', async () => {
      repository.findUniqueByToken.mockResolvedValue(mockDeviceToken);

      await expect(
        service.unregisterDeviceToken('user-2', 'device-token-abc'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('getUserDeviceTokens', () => {
    it('should return active device tokens for a user', async () => {
      const tokens = [
        mockDeviceToken,
        {
          ...mockDeviceToken,
          id: 'token-2',
          platform: 'android' as DevicePlatform,
        },
      ];

      repository.findActiveByUser.mockResolvedValue(tokens);

      const result = await service.getUserDeviceTokens('user-1');

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('token-1');
      expect(result[1].platform).toBe('android');
      expect(repository.findActiveByUser).toHaveBeenCalledWith('user-1');
    });

    it('should return empty array when user has no active tokens', async () => {
      repository.findActiveByUser.mockResolvedValue([]);

      const result = await service.getUserDeviceTokens('user-1');

      expect(result).toEqual([]);
    });
  });

  describe('unregisterAllUserTokens', () => {
    it('should deactivate all active tokens for a user', async () => {
      repository.updateManyTokens.mockResolvedValue({ count: 3 });

      const result = await service.unregisterAllUserTokens('user-1');

      expect(result).toEqual({ count: 3 });
      expect(repository.updateManyTokens).toHaveBeenCalledWith(
        { userId: 'user-1', isActive: true },
        { isActive: false },
      );
    });

    it('should return zero count when user has no active tokens', async () => {
      repository.updateManyTokens.mockResolvedValue({ count: 0 });

      const result = await service.unregisterAllUserTokens('user-1');

      expect(result).toEqual({ count: 0 });
    });
  });

  describe('hasActiveMobileTokens', () => {
    it('should return true when user has active mobile tokens', async () => {
      repository.countActiveMobileTokens.mockResolvedValue(2);

      const result = await service.hasActiveMobileTokens('user-1');

      expect(result).toBe(true);
      expect(repository.countActiveMobileTokens).toHaveBeenCalledWith('user-1');
    });

    it('should return false when user has no active mobile tokens', async () => {
      repository.countActiveMobileTokens.mockResolvedValue(0);

      const result = await service.hasActiveMobileTokens('user-1');

      expect(result).toBe(false);
    });
  });

  describe('hasActiveWebToken', () => {
    it('should return true when user has an active web token', async () => {
      repository.countActiveWebTokens.mockResolvedValue(1);

      const result = await service.hasActiveWebToken('user-1');

      expect(result).toBe(true);
      expect(repository.countActiveWebTokens).toHaveBeenCalledWith('user-1');
    });

    it('should return false when user has no active web token', async () => {
      repository.countActiveWebTokens.mockResolvedValue(0);

      const result = await service.hasActiveWebToken('user-1');

      expect(result).toBe(false);
    });
  });

  describe('cleanupStaleTokens', () => {
    it('should delete stale and inactive tokens', async () => {
      repository.deleteStaleTokens.mockResolvedValue({ count: 5 });

      const result = await service.cleanupStaleTokens();

      expect(result).toEqual({ count: 5 });
      expect(repository.deleteStaleTokens).toHaveBeenCalledWith(
        expect.any(Date),
      );
    });

    it('should return zero count when there are no stale tokens', async () => {
      repository.deleteStaleTokens.mockResolvedValue({ count: 0 });

      const result = await service.cleanupStaleTokens();

      expect(result).toEqual({ count: 0 });
    });
  });
});

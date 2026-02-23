import { Test, TestingModule } from '@nestjs/testing';
import { NotificationPreferenceService } from './notification-preference.service';
import {
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import {
  INotificationPreferenceRepository,
  NOTIFICATION_PREFERENCE_REPOSITORY,
} from '../repositories';
import {
  NotificationCategory,
  NotificationType,
  NotificationPreference,
} from '@prisma/client';

describe('NotificationPreferenceService', () => {
  let service: NotificationPreferenceService;
  let repository: jest.Mocked<INotificationPreferenceRepository>;

  const mockPreference: NotificationPreference = {
    id: 'pref-1',
    type: 'push' as NotificationType,
    category: 'NEW_STORY' as NotificationCategory,
    enabled: true,
    userId: 'user-1',
    kidId: null,
    isDeleted: false,
    deletedAt: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-15'),
  };

  const mockUser = {
    id: 'user-1',
    email: 'test@example.com',
  };

  const mockKid = {
    id: 'kid-1',
    name: 'Test Kid',
  };

  beforeEach(async () => {
    const mockRepository: Record<
      keyof INotificationPreferenceRepository,
      jest.Mock
    > = {
      findUser: jest.fn(),
      findKid: jest.fn(),
      createNotificationPreference: jest.fn(),
      updateNotificationPreference: jest.fn(),
      findManyNotificationPreferences: jest.fn(),
      findUniqueNotificationPreference: jest.fn(),
      upsertNotificationPreference: jest.fn(),
      executeTransaction: jest.fn((fn) => fn({})),
      createManyNotificationPreferences: jest.fn(),
      findManyNotificationPreferencesByIds: jest.fn(),
      deleteNotificationPreference: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationPreferenceService,
        {
          provide: NOTIFICATION_PREFERENCE_REPOSITORY,
          useValue: mockRepository,
        },
      ],
    }).compile();

    service = module.get<NotificationPreferenceService>(
      NotificationPreferenceService,
    );
    repository = module.get(NOTIFICATION_PREFERENCE_REPOSITORY);
  });

  describe('create', () => {
    it('should create a notification preference for a user', async () => {
      repository.findUser.mockResolvedValue(mockUser as any);
      repository.createNotificationPreference.mockResolvedValue(
        mockPreference,
      );

      const result = await service.create({
        type: 'push' as NotificationType,
        category: 'NEW_STORY' as NotificationCategory,
        enabled: true,
        userId: 'user-1',
      });

      expect(result.id).toBe('pref-1');
      expect(result.enabled).toBe(true);
      expect(repository.findUser).toHaveBeenCalledWith('user-1');
      expect(
        repository.createNotificationPreference,
      ).toHaveBeenCalledWith({
        type: 'push',
        category: 'NEW_STORY',
        enabled: true,
        userId: 'user-1',
        kidId: undefined,
      });
    });

    it('should create a notification preference for a kid', async () => {
      repository.findKid.mockResolvedValue(mockKid as any);
      repository.createNotificationPreference.mockResolvedValue({
        ...mockPreference,
        userId: null,
        kidId: 'kid-1',
      });

      const result = await service.create({
        type: 'push' as NotificationType,
        category: 'NEW_STORY' as NotificationCategory,
        enabled: true,
        kidId: 'kid-1',
      });

      expect(result.kidId).toBe('kid-1');
      expect(repository.findKid).toHaveBeenCalledWith('kid-1');
    });

    it('should throw NotFoundException when user does not exist', async () => {
      repository.findUser.mockResolvedValue(null);

      await expect(
        service.create({
          type: 'push' as NotificationType,
          category: 'NEW_STORY' as NotificationCategory,
          enabled: true,
          userId: 'nonexistent-user',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when kid does not exist', async () => {
      repository.findKid.mockResolvedValue(null);

      await expect(
        service.create({
          type: 'push' as NotificationType,
          category: 'NEW_STORY' as NotificationCategory,
          enabled: true,
          kidId: 'nonexistent-kid',
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('should update a notification preference', async () => {
      const updatedPref = { ...mockPreference, enabled: false };
      repository.updateNotificationPreference.mockResolvedValue(updatedPref);

      const result = await service.update('pref-1', { enabled: false });

      expect(result.enabled).toBe(false);
      expect(
        repository.updateNotificationPreference,
      ).toHaveBeenCalledWith('pref-1', { enabled: false });
    });
  });

  describe('bulkUpdate', () => {
    it('should bulk update preferences belonging to the user', async () => {
      const dtos = [
        { id: 'pref-1', enabled: false },
        { id: 'pref-2', enabled: true },
      ];
      const existingPrefs = [
        mockPreference,
        { ...mockPreference, id: 'pref-2' },
      ];
      const updatedPrefs = [
        { ...mockPreference, enabled: false },
        { ...mockPreference, id: 'pref-2', enabled: true },
      ];

      repository.findManyNotificationPreferencesByIds.mockResolvedValue(
        existingPrefs,
      );
      repository.updateNotificationPreference
        .mockResolvedValueOnce(updatedPrefs[0])
        .mockResolvedValueOnce(updatedPrefs[1]);

      const result = await service.bulkUpdate('user-1', dtos);

      expect(result).toHaveLength(2);
      expect(result[0].enabled).toBe(false);
      expect(result[1].enabled).toBe(true);
      expect(
        repository.findManyNotificationPreferencesByIds,
      ).toHaveBeenCalledWith(['pref-1', 'pref-2'], 'user-1');
      expect(repository.executeTransaction).toHaveBeenCalled();
    });

    it('should throw NotFoundException when some preferences do not belong to user', async () => {
      const dtos = [
        { id: 'pref-1', enabled: false },
        { id: 'pref-2', enabled: true },
      ];

      // Only one of two preferences found for user
      repository.findManyNotificationPreferencesByIds.mockResolvedValue([
        mockPreference,
      ]);

      await expect(service.bulkUpdate('user-1', dtos)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should handle empty array of updates', async () => {
      repository.findManyNotificationPreferencesByIds.mockResolvedValue([]);

      const result = await service.bulkUpdate('user-1', []);

      expect(result).toEqual([]);
      expect(repository.executeTransaction).toHaveBeenCalled();
    });
  });

  describe('getForUser', () => {
    it('should return preferences for a user', async () => {
      repository.findUser.mockResolvedValue(mockUser as any);
      repository.findManyNotificationPreferences.mockResolvedValue([
        mockPreference,
      ]);

      const result = await service.getForUser('user-1');

      expect(result).toHaveLength(1);
      expect(result[0].userId).toBe('user-1');
      expect(
        repository.findManyNotificationPreferences,
      ).toHaveBeenCalledWith({ userId: 'user-1', isDeleted: false });
    });

    it('should throw NotFoundException when user does not exist', async () => {
      repository.findUser.mockResolvedValue(null);

      await expect(service.getForUser('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getForKid', () => {
    it('should return preferences for a kid', async () => {
      const kidPref = { ...mockPreference, userId: null, kidId: 'kid-1' };
      repository.findKid.mockResolvedValue(mockKid as any);
      repository.findManyNotificationPreferences.mockResolvedValue([kidPref]);

      const result = await service.getForKid('kid-1');

      expect(result).toHaveLength(1);
      expect(result[0].kidId).toBe('kid-1');
      expect(
        repository.findManyNotificationPreferences,
      ).toHaveBeenCalledWith({ kidId: 'kid-1', isDeleted: false });
    });

    it('should throw NotFoundException when kid does not exist', async () => {
      repository.findKid.mockResolvedValue(null);

      await expect(service.getForKid('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getById', () => {
    it('should return a notification preference by ID', async () => {
      repository.findUniqueNotificationPreference.mockResolvedValue(
        mockPreference,
      );

      const result = await service.getById('pref-1');

      expect(result.id).toBe('pref-1');
      expect(
        repository.findUniqueNotificationPreference,
      ).toHaveBeenCalledWith('pref-1', false);
    });

    it('should throw NotFoundException when preference does not exist', async () => {
      repository.findUniqueNotificationPreference.mockResolvedValue(null);

      await expect(service.getById('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('toggleCategoryPreference', () => {
    it('should toggle both push and in_app channels for a category', async () => {
      const pushPref = { ...mockPreference, type: 'push' as NotificationType };
      const inAppPref = {
        ...mockPreference,
        id: 'pref-2',
        type: 'in_app' as NotificationType,
      };

      repository.upsertNotificationPreference
        .mockResolvedValueOnce(pushPref)
        .mockResolvedValueOnce(inAppPref);

      const result = await service.toggleCategoryPreference(
        'user-1',
        'NEW_STORY' as NotificationCategory,
        true,
      );

      expect(result).toHaveLength(2);
      expect(repository.executeTransaction).toHaveBeenCalled();
      expect(repository.upsertNotificationPreference).toHaveBeenCalledTimes(2);
    });
  });

  describe('getUserPreferencesGrouped', () => {
    it('should return preferences grouped by category', async () => {
      const prefs = [
        {
          ...mockPreference,
          category: 'NEW_STORY' as NotificationCategory,
          type: 'push' as NotificationType,
          enabled: true,
        },
        {
          ...mockPreference,
          id: 'pref-2',
          category: 'NEW_STORY' as NotificationCategory,
          type: 'in_app' as NotificationType,
          enabled: false,
        },
        {
          ...mockPreference,
          id: 'pref-3',
          category: 'STORY_FINISHED' as NotificationCategory,
          type: 'push' as NotificationType,
          enabled: false,
        },
      ];

      repository.findManyNotificationPreferences.mockResolvedValue(prefs);

      const result = await service.getUserPreferencesGrouped('user-1');

      expect(result['NEW_STORY']).toEqual({ push: true, in_app: false });
      expect(result['STORY_FINISHED']).toEqual({ push: false, in_app: true });
    });

    it('should return empty object when user has no preferences', async () => {
      repository.findManyNotificationPreferences.mockResolvedValue([]);

      const result = await service.getUserPreferencesGrouped('user-1');

      expect(result).toEqual({});
    });
  });

  describe('updateUserPreferences', () => {
    it('should update preferences for multiple categories', async () => {
      repository.upsertNotificationPreference.mockResolvedValue(mockPreference);
      repository.findManyNotificationPreferences.mockResolvedValue([]);

      const preferences = {
        NEW_STORY: true,
        STORY_FINISHED: false,
      };

      const result = await service.updateUserPreferences('user-1', preferences);

      expect(repository.executeTransaction).toHaveBeenCalled();
      // 2 categories x 2 channels = 4 upsert calls
      expect(repository.upsertNotificationPreference).toHaveBeenCalledTimes(4);
      expect(result).toBeDefined();
    });
  });

  describe('seedDefaultPreferences', () => {
    it('should create default preferences for a new user', async () => {
      repository.createManyNotificationPreferences.mockResolvedValue(undefined);

      await service.seedDefaultPreferences('user-1');

      expect(
        repository.createManyNotificationPreferences,
      ).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            userId: 'user-1',
            enabled: true,
          }),
        ]),
      );

      // 6 categories x 2 channels = 12 preferences
      const callArg =
        repository.createManyNotificationPreferences.mock.calls[0][0];
      expect(callArg).toHaveLength(12);
    });
  });

  describe('delete', () => {
    it('should soft delete a notification preference by default', async () => {
      repository.findUniqueNotificationPreference.mockResolvedValue(
        mockPreference,
      );
      repository.updateNotificationPreference.mockResolvedValue({
        ...mockPreference,
        isDeleted: true,
      });

      await service.delete('pref-1');

      expect(
        repository.updateNotificationPreference,
      ).toHaveBeenCalledWith('pref-1', {
        isDeleted: true,
        deletedAt: expect.any(Date),
      });
      expect(
        repository.deleteNotificationPreference,
      ).not.toHaveBeenCalled();
    });

    it('should permanently delete when permanent flag is true', async () => {
      repository.findUniqueNotificationPreference.mockResolvedValue(
        mockPreference,
      );
      repository.deleteNotificationPreference.mockResolvedValue(undefined);

      await service.delete('pref-1', true);

      expect(
        repository.deleteNotificationPreference,
      ).toHaveBeenCalledWith('pref-1');
      expect(
        repository.updateNotificationPreference,
      ).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when preference does not exist', async () => {
      repository.findUniqueNotificationPreference.mockResolvedValue(null);

      await expect(service.delete('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('undoDelete', () => {
    it('should restore a soft-deleted preference', async () => {
      const deletedPref = {
        ...mockPreference,
        isDeleted: true,
        deletedAt: new Date(),
      };
      const restoredPref = {
        ...mockPreference,
        isDeleted: false,
        deletedAt: null,
      };

      repository.findUniqueNotificationPreference.mockResolvedValue(
        deletedPref,
      );
      repository.updateNotificationPreference.mockResolvedValue(restoredPref);

      const result = await service.undoDelete('pref-1');

      expect(result.id).toBe('pref-1');
      expect(
        repository.updateNotificationPreference,
      ).toHaveBeenCalledWith('pref-1', {
        isDeleted: false,
        deletedAt: null,
      });
    });

    it('should throw NotFoundException when preference does not exist', async () => {
      repository.findUniqueNotificationPreference.mockResolvedValue(null);

      await expect(service.undoDelete('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException when preference is not deleted', async () => {
      repository.findUniqueNotificationPreference.mockResolvedValue(
        mockPreference,
      );

      await expect(service.undoDelete('pref-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});

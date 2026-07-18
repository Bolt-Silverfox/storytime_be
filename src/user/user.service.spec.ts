import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { UserService } from './user.service';
import type { SafeUser } from './user.service';
import { UserRole } from './user.controller';
import { NotificationService } from '@/notification/notification.service';
import { USER_REPOSITORY } from './repositories';

// Type-safe mock for the user repository
type MockUserRepository = {
  findUserById: jest.Mock;
  findUserByIdWithRelations: jest.Mock;
  findAllUsers: jest.Mock;
  findActiveUsers: jest.Mock;
  createAvatar: jest.Mock;
  updateUserWithProfileUpsert: jest.Mock;
  updateParentProfile: jest.Mock;
  updateUserRole: jest.Mock;
  updateParentAvatar: jest.Mock;
};

const createMockUserRepository = (): MockUserRepository => ({
  findUserById: jest.fn(),
  findUserByIdWithRelations: jest.fn(),
  findAllUsers: jest.fn(),
  findActiveUsers: jest.fn(),
  createAvatar: jest.fn(),
  updateUserWithProfileUpsert: jest.fn(),
  updateParentProfile: jest.fn(),
  updateUserRole: jest.fn(),
  updateParentAvatar: jest.fn(),
});

describe('UserService', () => {
  let service: UserService;
  let mockRepo: MockUserRepository;

  const mockUser = {
    id: 'user-1',
    email: 'test@example.com',
    name: 'Test User',
    isEmailVerified: true,
    isDeleted: false,
    deletedAt: null,
    role: 'parent',
    onboardingStatus: 'pin_setup',
    biometricsEnabled: false,
    profile: { language: 'en', country: 'US' },
    avatar: null,
    kids: [{ id: 'kid-1' }, { id: 'kid-2' }],
    subscription: [],
  };

  beforeEach(async () => {
    mockRepo = createMockUserRepository();

    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        { provide: USER_REPOSITORY, useValue: mockRepo },
        {
          provide: NotificationService,
          useValue: {
            seedDefaultPreferences: jest.fn(),
            sendNotification: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<UserService>(UserService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ==================== GET USER TESTS ====================

  describe('getUser', () => {
    it('should return user with numberOfKids', async () => {
      mockRepo.findUserByIdWithRelations.mockResolvedValue(mockUser);

      const result = await service.getUser('user-1');

      expect(result).toBeDefined();
      expect(result?.numberOfKids).toBe(2);
      expect(mockRepo.findUserByIdWithRelations).toHaveBeenCalledWith('user-1');
    });

    it('should return null for non-existent user', async () => {
      mockRepo.findUserByIdWithRelations.mockResolvedValue(null);

      const result = await service.getUser('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('getUserIncludingDeleted', () => {
    it('should return deleted user', async () => {
      const deletedUser = { ...mockUser, isDeleted: true };
      mockRepo.findUserByIdWithRelations.mockResolvedValue(deletedUser);

      const result = await service.getUserIncludingDeleted('user-1');

      expect(result).toBeDefined();
      expect(mockRepo.findUserByIdWithRelations).toHaveBeenCalledWith(
        'user-1',
        true,
      );
    });
  });

  // ==================== GET ALL USERS TESTS ====================

  describe('getAllUsers', () => {
    it('should return all users without sensitive fields', async () => {
      mockRepo.findAllUsers.mockResolvedValue([mockUser]);

      const result = await service.getAllUsers();

      expect(result).toHaveLength(1);
      expect(
        (result[0] as SafeUser & { passwordHash?: string }).passwordHash,
      ).toBeUndefined();
      expect(
        (result[0] as SafeUser & { pinHash?: string }).pinHash,
      ).toBeUndefined();
    });
  });

  describe('getActiveUsers', () => {
    it('should return only active (non-deleted) users', async () => {
      mockRepo.findActiveUsers.mockResolvedValue([mockUser]);

      const result = await service.getActiveUsers();

      expect(result).toHaveLength(1);
      expect(mockRepo.findActiveUsers).toHaveBeenCalledWith();
    });
  });

  // ==================== UPDATE USER TESTS ====================

  describe('updateUser', () => {
    it('should update user name', async () => {
      mockRepo.findUserById.mockResolvedValueOnce(mockUser);
      mockRepo.updateUserWithProfileUpsert.mockResolvedValue({
        ...mockUser,
        name: 'Updated Name',
      });

      const result = await service.updateUser('user-1', {
        name: 'Updated Name',
      });

      expect(result).toBeDefined();
      expect(mockRepo.updateUserWithProfileUpsert).toHaveBeenCalled();
    });

    it('should throw NotFoundException for non-existent user', async () => {
      mockRepo.findUserById.mockResolvedValue(null);

      await expect(
        service.updateUser('nonexistent', { name: 'Test' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should return existing user when no updates provided', async () => {
      mockRepo.findUserById.mockResolvedValueOnce(mockUser);
      mockRepo.findUserByIdWithRelations.mockResolvedValueOnce(mockUser);

      const result = await service.updateUser('user-1', {});

      expect(result).toBeDefined();
    });

    it('should create new avatar when avatarUrl is provided', async () => {
      mockRepo.findUserById.mockResolvedValueOnce(mockUser);
      mockRepo.createAvatar.mockResolvedValue({
        id: 'new-avatar-id',
        url: 'https://example.com/avatar.jpg',
      });
      mockRepo.updateUserWithProfileUpsert.mockResolvedValue({
        ...mockUser,
        avatarId: 'new-avatar-id',
      });

      await service.updateUser('user-1', {
        avatarUrl: 'https://example.com/avatar.jpg',
      });

      expect(mockRepo.createAvatar).toHaveBeenCalled();
    });
  });

  // ==================== USER ROLE TESTS ====================

  describe('getUserRole', () => {
    it('should return user role', async () => {
      mockRepo.findUserById.mockResolvedValue(mockUser);

      const result = await service.getUserRole('user-1');

      expect(result.role).toBe('parent');
    });
  });

  describe('updateUserRole', () => {
    it('should update user role', async () => {
      mockRepo.updateUserRole.mockResolvedValue({
        ...mockUser,
        role: 'admin',
      });

      const result = await service.updateUserRole('user-1', UserRole.ADMIN);

      expect(result.role).toBe('admin');
    });

    it('should throw error for invalid role', async () => {
      await expect(
        service.updateUserRole('user-1', 'invalid' as UserRole),
      ).rejects.toThrow(Error);
    });
  });

  // ==================== PARENT PROFILE TESTS ====================

  describe('updateParentProfile', () => {
    it('should update parent profile', async () => {
      mockRepo.findUserById.mockResolvedValue(mockUser);
      mockRepo.updateParentProfile.mockResolvedValue({
        ...mockUser,
        name: 'Updated Name',
      });

      const result = await service.updateParentProfile('user-1', {
        name: 'Updated Name',
      });

      expect(result).toBeDefined();
    });

    it('should throw NotFoundException for non-existent user', async () => {
      mockRepo.findUserById.mockResolvedValue(null);

      await expect(
        service.updateParentProfile('nonexistent', { name: 'Test' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateAvatarForParent', () => {
    it('should update avatar for parent', async () => {
      mockRepo.updateParentAvatar.mockResolvedValue({
        ...mockUser,
        avatarId: 'new-avatar-id',
        avatar: { id: 'new-avatar-id', url: 'https://example.com/avatar.jpg' },
      });

      const result = await service.updateAvatarForParent('user-1', {
        avatarId: 'new-avatar-id',
      });

      expect(result.avatarId).toBe('new-avatar-id');
    });
  });
});

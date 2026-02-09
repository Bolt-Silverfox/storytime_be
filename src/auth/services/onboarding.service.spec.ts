import { Test, TestingModule } from '@nestjs/testing';
import { OnboardingService } from './onboarding.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { UserDto } from '../dto/auth.dto';

// Type-safe mock for PrismaService
type MockPrismaService = {
  user: {
    findFirst: jest.Mock;
    findUnique: jest.Mock;
    update: jest.Mock;
  };
  profile: {
    update: jest.Mock;
    upsert: jest.Mock;
    create: jest.Mock;
  };
  avatar: {
    findFirst: jest.Mock;
    create: jest.Mock;
  };
  learningExpectation: {
    findMany: jest.Mock;
  };
  userLearningExpectation: {
    createMany: jest.Mock;
  };
  kid: {
    count: jest.Mock;
  };
};

const createMockPrismaService = (): MockPrismaService => ({
  user: {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  profile: {
    update: jest.fn(),
    upsert: jest.fn(),
    create: jest.fn(),
  },
  avatar: {
    findFirst: jest.fn(),
    create: jest.fn(),
  },
  learningExpectation: {
    findMany: jest.fn(),
  },
  userLearningExpectation: {
    createMany: jest.fn(),
  },
  kid: {
    count: jest.fn(),
  },
});

describe('OnboardingService', () => {
  let service: OnboardingService;
  let mockPrisma: MockPrismaService;

  const mockUser = {
    id: 'user-1',
    email: 'test@example.com',
    name: 'Test User',
    isEmailVerified: true,
    role: 'parent',
    onboardingStatus: 'email_verified',
    profile: {
      userId: 'user-1',
      language: null,
      languageCode: null,
      country: 'NG',
    },
    avatar: null,
    learningExpectations: [],
  };

  const mockProfile = {
    userId: 'user-1',
    language: 'English',
    languageCode: 'en',
    country: 'NG',
  };

  beforeEach(async () => {
    mockPrisma = createMockPrismaService();

    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OnboardingService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<OnboardingService>(OnboardingService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ==================== COMPLETE PROFILE TESTS ====================

  describe('completeProfile', () => {
    it('should complete profile successfully with language settings', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(mockUser);
      mockPrisma.profile.update.mockResolvedValue(mockProfile);
      mockPrisma.user.update.mockResolvedValue({
        ...mockUser,
        onboardingStatus: 'profile_setup',
      });
      mockPrisma.user.findUnique.mockResolvedValue({
        ...mockUser,
        onboardingStatus: 'profile_setup',
        profile: mockProfile,
        learningExpectations: [],
      });
      mockPrisma.kid.count.mockResolvedValue(2);

      const result = await service.completeProfile('user-1', {
        language: 'English',
        languageCode: 'en',
      });

      expect(result).toBeDefined();
      expect(result.id).toBe('user-1');
      expect(mockPrisma.profile.update).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        data: {
          language: 'English',
          languageCode: 'en',
        },
      });
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { onboardingStatus: 'profile_setup' },
      });
    });

    it('should throw NotFoundException when user does not exist', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);

      await expect(
        service.completeProfile('nonexistent-user', { language: 'en' }),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.completeProfile('nonexistent-user', { language: 'en' }),
      ).rejects.toThrow('User not found');
    });

    it('should throw BadRequestException when onboarding already completed', async () => {
      const completedUser = {
        ...mockUser,
        onboardingStatus: 'pin_setup',
      };
      mockPrisma.user.findFirst.mockResolvedValue(completedUser);

      await expect(
        service.completeProfile('user-1', { language: 'en' }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.completeProfile('user-1', { language: 'en' }),
      ).rejects.toThrow('Onboarding already completed');
    });

    it('should add learning expectations when provided', async () => {
      const expectations = [
        { id: 'exp-1', name: 'Reading', isActive: true, isDeleted: false },
        { id: 'exp-2', name: 'Writing', isActive: true, isDeleted: false },
      ];

      mockPrisma.user.findFirst.mockResolvedValue(mockUser);
      mockPrisma.learningExpectation.findMany.mockResolvedValue(expectations);
      mockPrisma.userLearningExpectation.createMany.mockResolvedValue({
        count: 2,
      });
      mockPrisma.profile.update.mockResolvedValue(mockProfile);
      mockPrisma.user.update.mockResolvedValue({
        ...mockUser,
        onboardingStatus: 'profile_setup',
      });
      mockPrisma.user.findUnique.mockResolvedValue({
        ...mockUser,
        onboardingStatus: 'profile_setup',
        learningExpectations: [
          { learningExpectation: expectations[0] },
          { learningExpectation: expectations[1] },
        ],
      });
      mockPrisma.kid.count.mockResolvedValue(0);

      const result = await service.completeProfile('user-1', {
        learningExpectationIds: ['exp-1', 'exp-2'],
      });

      expect(result).toBeDefined();
      expect(mockPrisma.learningExpectation.findMany).toHaveBeenCalledWith({
        where: {
          id: { in: ['exp-1', 'exp-2'] },
          isActive: true,
          isDeleted: false,
        },
      });
      expect(mockPrisma.userLearningExpectation.createMany).toHaveBeenCalledWith(
        {
          data: [
            { userId: 'user-1', learningExpectationId: 'exp-1' },
            { userId: 'user-1', learningExpectationId: 'exp-2' },
          ],
          skipDuplicates: true,
        },
      );
    });

    it('should throw BadRequestException when some learning expectations do not exist', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(mockUser);
      // Only one expectation found when two were requested
      mockPrisma.learningExpectation.findMany.mockResolvedValue([
        { id: 'exp-1', name: 'Reading', isActive: true, isDeleted: false },
      ]);

      await expect(
        service.completeProfile('user-1', {
          learningExpectationIds: ['exp-1', 'exp-2'],
        }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.completeProfile('user-1', {
          learningExpectationIds: ['exp-1', 'exp-2'],
        }),
      ).rejects.toThrow(
        'Some selected learning expectations do not exist or are inactive',
      );
    });

    it('should set preferred categories when provided', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(mockUser);
      mockPrisma.user.update.mockResolvedValue({
        ...mockUser,
        onboardingStatus: 'profile_setup',
      });
      mockPrisma.profile.update.mockResolvedValue(mockProfile);
      mockPrisma.user.findUnique.mockResolvedValue({
        ...mockUser,
        onboardingStatus: 'profile_setup',
        learningExpectations: [],
      });
      mockPrisma.kid.count.mockResolvedValue(0);

      await service.completeProfile('user-1', {
        preferredCategories: ['cat-1', 'cat-2'],
      });

      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: {
          preferredCategories: {
            set: [{ id: 'cat-1' }, { id: 'cat-2' }],
          },
        },
      });
    });

    it('should create and assign avatar when profileImageUrl is provided', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(mockUser);
      mockPrisma.avatar.findFirst.mockResolvedValue(null);

      const newAvatar = {
        id: 'avatar-1',
        url: 'https://example.com/profile.jpg',
        name: 'user_user-1',
        isSystemAvatar: false,
      };
      mockPrisma.avatar.create.mockResolvedValue(newAvatar);
      mockPrisma.user.update.mockResolvedValue({
        ...mockUser,
        avatarId: 'avatar-1',
        onboardingStatus: 'profile_setup',
      });
      mockPrisma.profile.update.mockResolvedValue(mockProfile);
      mockPrisma.user.findUnique.mockResolvedValue({
        ...mockUser,
        avatarId: 'avatar-1',
        avatar: newAvatar,
        onboardingStatus: 'profile_setup',
        learningExpectations: [],
      });
      mockPrisma.kid.count.mockResolvedValue(0);

      await service.completeProfile('user-1', {
        profileImageUrl: 'https://example.com/profile.jpg',
      });

      expect(mockPrisma.avatar.create).toHaveBeenCalledWith({
        data: {
          url: 'https://example.com/profile.jpg',
          name: 'user_user-1',
          isSystemAvatar: false,
        },
      });
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { avatarId: 'avatar-1' },
      });
    });

    it('should reuse existing avatar when profileImageUrl matches', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(mockUser);

      const existingAvatar = {
        id: 'existing-avatar',
        url: 'https://example.com/existing.jpg',
        name: 'existing',
        isSystemAvatar: false,
      };
      mockPrisma.avatar.findFirst.mockResolvedValue(existingAvatar);
      mockPrisma.user.update.mockResolvedValue({
        ...mockUser,
        avatarId: 'existing-avatar',
        onboardingStatus: 'profile_setup',
      });
      mockPrisma.profile.update.mockResolvedValue(mockProfile);
      mockPrisma.user.findUnique.mockResolvedValue({
        ...mockUser,
        avatarId: 'existing-avatar',
        avatar: existingAvatar,
        onboardingStatus: 'profile_setup',
        learningExpectations: [],
      });
      mockPrisma.kid.count.mockResolvedValue(0);

      await service.completeProfile('user-1', {
        profileImageUrl: 'https://example.com/existing.jpg',
      });

      expect(mockPrisma.avatar.create).not.toHaveBeenCalled();
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { avatarId: 'existing-avatar' },
      });
    });

    it('should return user with numberOfKids count', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(mockUser);
      mockPrisma.profile.update.mockResolvedValue(mockProfile);
      mockPrisma.user.update.mockResolvedValue({
        ...mockUser,
        onboardingStatus: 'profile_setup',
      });
      mockPrisma.user.findUnique.mockResolvedValue({
        ...mockUser,
        onboardingStatus: 'profile_setup',
        learningExpectations: [],
      });
      mockPrisma.kid.count.mockResolvedValue(3);

      const result = await service.completeProfile('user-1', {
        language: 'English',
      });

      expect(result.numberOfKids).toBe(3);
      expect(mockPrisma.kid.count).toHaveBeenCalledWith({
        where: { parentId: 'user-1' },
      });
    });

    it('should throw NotFoundException when user not found after update', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(mockUser);
      mockPrisma.profile.update.mockResolvedValue(mockProfile);
      mockPrisma.user.update.mockResolvedValue({
        ...mockUser,
        onboardingStatus: 'profile_setup',
      });
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.completeProfile('user-1', { language: 'English' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should skip learning expectations when empty array is provided', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(mockUser);
      mockPrisma.profile.update.mockResolvedValue(mockProfile);
      mockPrisma.user.update.mockResolvedValue({
        ...mockUser,
        onboardingStatus: 'profile_setup',
      });
      mockPrisma.user.findUnique.mockResolvedValue({
        ...mockUser,
        onboardingStatus: 'profile_setup',
        learningExpectations: [],
      });
      mockPrisma.kid.count.mockResolvedValue(0);

      await service.completeProfile('user-1', {
        learningExpectationIds: [],
      });

      expect(mockPrisma.learningExpectation.findMany).not.toHaveBeenCalled();
      expect(
        mockPrisma.userLearningExpectation.createMany,
      ).not.toHaveBeenCalled();
    });
  });

  // ==================== GET LEARNING EXPECTATIONS TESTS ====================

  describe('getLearningExpectations', () => {
    it('should return active learning expectations ordered by name', async () => {
      const expectations = [
        {
          id: 'exp-1',
          name: 'Communication',
          description: 'Communication skills',
          category: 'social',
        },
        {
          id: 'exp-2',
          name: 'Reading',
          description: 'Reading comprehension',
          category: 'literacy',
        },
        {
          id: 'exp-3',
          name: 'Writing',
          description: 'Writing skills',
          category: 'literacy',
        },
      ];
      mockPrisma.learningExpectation.findMany.mockResolvedValue(expectations);

      const result = await service.getLearningExpectations();

      expect(result).toEqual(expectations);
      expect(mockPrisma.learningExpectation.findMany).toHaveBeenCalledWith({
        where: {
          isActive: true,
          isDeleted: false,
        },
        select: {
          id: true,
          name: true,
          description: true,
          category: true,
        },
        orderBy: {
          name: 'asc',
        },
      });
    });

    it('should return empty array when no active expectations exist', async () => {
      mockPrisma.learningExpectation.findMany.mockResolvedValue([]);

      const result = await service.getLearningExpectations();

      expect(result).toEqual([]);
    });
  });

  // ==================== UPDATE PROFILE TESTS ====================

  describe('updateProfile', () => {
    it('should update profile successfully with all fields', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(mockUser);

      const updatedProfile = {
        userId: 'user-1',
        country: 'US',
        language: 'English',
        languageCode: 'en-US',
        explicitContent: false,
        maxScreenTimeMins: 60,
      };
      mockPrisma.profile.upsert.mockResolvedValue(updatedProfile);
      mockPrisma.user.findUnique.mockResolvedValue({
        ...mockUser,
        profile: updatedProfile,
        learningExpectations: [],
      });
      mockPrisma.kid.count.mockResolvedValue(2);

      const result = await service.updateProfile('user-1', {
        country: 'US',
        language: 'English',
        languageCode: 'en-US',
        explicitContent: false,
        maxScreenTimeMins: 60,
      });

      expect(result).toBeDefined();
      // Result is UserDto when update data is provided
      expect((result as UserDto).profile).toEqual(
        expect.objectContaining(updatedProfile),
      );
      expect(mockPrisma.profile.upsert).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        update: {
          country: 'US',
          language: 'English',
          languageCode: 'en-US',
          explicitContent: false,
          maxScreenTimeMins: 60,
        },
        create: expect.objectContaining({
          userId: 'user-1',
          country: 'US',
        }),
      });
    });

    it('should throw NotFoundException when user does not exist', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);

      await expect(
        service.updateProfile('nonexistent', { country: 'US' }),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.updateProfile('nonexistent', { country: 'US' }),
      ).rejects.toThrow('User not found');
    });

    it('should create profile if user has no profile and no update data', async () => {
      const userWithoutProfile = {
        ...mockUser,
        profile: null,
      };
      mockPrisma.user.findFirst.mockResolvedValue(userWithoutProfile);
      mockPrisma.profile.create.mockResolvedValue({
        userId: 'user-1',
        country: 'NG',
      });

      await service.updateProfile('user-1', {});

      expect(mockPrisma.profile.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          country: 'NG',
        },
      });
    });

    it('should update only provided fields', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(mockUser);
      mockPrisma.profile.upsert.mockResolvedValue({
        ...mockProfile,
        country: 'UK',
      });
      mockPrisma.user.findUnique.mockResolvedValue({
        ...mockUser,
        profile: { ...mockProfile, country: 'UK' },
        learningExpectations: [],
      });
      mockPrisma.kid.count.mockResolvedValue(0);

      await service.updateProfile('user-1', { country: 'UK' });

      expect(mockPrisma.profile.upsert).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        update: { country: 'UK' },
        create: expect.objectContaining({
          userId: 'user-1',
          country: 'UK',
        }),
      });
    });

    it('should return user with numberOfKids count', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(mockUser);
      mockPrisma.profile.upsert.mockResolvedValue(mockProfile);
      mockPrisma.user.findUnique.mockResolvedValue({
        ...mockUser,
        profile: mockProfile,
        learningExpectations: [],
      });
      mockPrisma.kid.count.mockResolvedValue(5);

      const result = await service.updateProfile('user-1', {
        language: 'French',
      });

      expect((result as UserDto).numberOfKids).toBe(5);
    });

    it('should throw NotFoundException when user not found after update', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(mockUser);
      mockPrisma.profile.upsert.mockResolvedValue(mockProfile);
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.updateProfile('user-1', { country: 'US' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should handle undefined fields correctly', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(mockUser);
      mockPrisma.profile.upsert.mockResolvedValue(mockProfile);
      mockPrisma.user.findUnique.mockResolvedValue({
        ...mockUser,
        profile: mockProfile,
        learningExpectations: [],
      });
      mockPrisma.kid.count.mockResolvedValue(0);

      await service.updateProfile('user-1', {
        country: 'CA',
        language: undefined,
        languageCode: undefined,
      });

      expect(mockPrisma.profile.upsert).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        update: { country: 'CA' },
        create: expect.objectContaining({
          userId: 'user-1',
          country: 'CA',
        }),
      });
    });

    it('should update explicitContent setting', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(mockUser);
      mockPrisma.profile.upsert.mockResolvedValue({
        ...mockProfile,
        explicitContent: true,
      });
      mockPrisma.user.findUnique.mockResolvedValue({
        ...mockUser,
        profile: { ...mockProfile, explicitContent: true },
        learningExpectations: [],
      });
      mockPrisma.kid.count.mockResolvedValue(0);

      await service.updateProfile('user-1', { explicitContent: true });

      expect(mockPrisma.profile.upsert).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        update: { explicitContent: true },
        create: expect.objectContaining({
          userId: 'user-1',
        }),
      });
    });

    it('should update maxScreenTimeMins setting', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(mockUser);
      mockPrisma.profile.upsert.mockResolvedValue({
        ...mockProfile,
        maxScreenTimeMins: 120,
      });
      mockPrisma.user.findUnique.mockResolvedValue({
        ...mockUser,
        profile: { ...mockProfile, maxScreenTimeMins: 120 },
        learningExpectations: [],
      });
      mockPrisma.kid.count.mockResolvedValue(0);

      await service.updateProfile('user-1', { maxScreenTimeMins: 120 });

      expect(mockPrisma.profile.upsert).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        update: { maxScreenTimeMins: 120 },
        create: expect.objectContaining({
          userId: 'user-1',
        }),
      });
    });
  });
});

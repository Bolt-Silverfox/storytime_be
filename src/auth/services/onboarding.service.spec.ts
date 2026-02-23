import { Test, TestingModule } from '@nestjs/testing';
import { OnboardingService } from './onboarding.service';
import { NotFoundException } from '@nestjs/common';
import { AUTH_REPOSITORY, IAuthRepository } from '../repositories';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ConfigService } from '@nestjs/config';
import { Role, OnboardingStatus } from '@prisma/client';

describe('OnboardingService', () => {
  let service: OnboardingService;
  let authRepository: jest.Mocked<IAuthRepository>;
  let passwordService: jest.Mocked<PasswordService>;
  let tokenService: jest.Mocked<TokenService>;
  let eventEmitter: jest.Mocked<EventEmitter2>;

  const mockUser = {
    id: 'user-1',
    email: 'test@example.com',
    name: 'Test User',
    isEmailVerified: true,
    role: Role.parent,
    onboardingStatus: OnboardingStatus.email_verified,
    createdAt: new Date(),
    updatedAt: new Date(),
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
    const mockAuthRepository = {
      findUserByEmail: jest.fn(),
      findUserByIdWithProfile: jest.fn(),
      findUserByIdWithLearningExpectations: jest.fn(),
      findLearningExpectationsByIds: jest.fn(),
      createUserLearningExpectations: jest.fn(),
      updateUserPreferredCategories: jest.fn(),
      updateProfile: jest.fn(),
      findAvatarByUrl: jest.fn(),
      createAvatar: jest.fn(),
      updateUser: jest.fn(),
      countKidsByParentId: jest.fn(),
      findActiveLearningExpectations: jest.fn(),
      upsertProfile: jest.fn(),
      createProfile: jest.fn(),
      createUser: jest.fn(),
    };

    const mockPasswordService = {
      hashPassword: jest.fn(),
    };

    const mockTokenService = {
      createTokenPair: jest.fn(),
    };

    const mockEventEmitter = {
      emit: jest.fn(),
    };

    const mockConfigService = {
      get: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OnboardingService,
        { provide: AUTH_REPOSITORY, useValue: mockAuthRepository },
        { provide: PasswordService, useValue: mockPasswordService },
        { provide: TokenService, useValue: mockTokenService },
        { provide: EventEmitter2, useValue: mockEventEmitter },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<OnboardingService>(OnboardingService);
    authRepository = module.get(AUTH_REPOSITORY);
    passwordService = module.get(PasswordService);
    tokenService = module.get(TokenService);
    eventEmitter = module.get(EventEmitter2);
  });

  describe('register', () => {
    it('should register a new user successfully', async () => {
      authRepository.findUserByEmail.mockResolvedValue(null);
      passwordService.hashPassword.mockResolvedValue('hashed_password');
      authRepository.createUser.mockResolvedValue(mockUser as any);
      tokenService.createTokenPair.mockResolvedValue({
        jwt: 'jwt-token',
        refreshToken: 'refresh-token',
      });

      const result = await service.register({
        fullName: 'Test User',
        email: 'test@example.com',
        password: 'password123',
      });

      expect(result).toBeDefined();
      expect(authRepository.createUser).toHaveBeenCalled();
      expect(eventEmitter.emit).toHaveBeenCalled();
    });
  });

  describe('completeProfile', () => {
    it('should complete profile successfully', async () => {
      authRepository.findUserByIdWithProfile.mockResolvedValue(mockUser as any);
      authRepository.updateProfile.mockResolvedValue(mockProfile as any);
      authRepository.findUserByIdWithLearningExpectations.mockResolvedValue(
        mockUser as any,
      );
      authRepository.countKidsByParentId.mockResolvedValue(2);

      const result = await service.completeProfile('user-1', {
        language: 'English',
        languageCode: 'en',
      });

      expect(result).toBeDefined();
      expect(authRepository.updateProfile).toHaveBeenCalled();
    });

    it('should throw NotFoundException when user does not exist', async () => {
      authRepository.findUserByIdWithProfile.mockResolvedValue(null);

      await expect(
        service.completeProfile('nonexistent-user', { language: 'en' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateProfile', () => {
    it('should update profile successfully', async () => {
      authRepository.findUserByIdWithProfile.mockResolvedValue(mockUser as any);
      authRepository.upsertProfile.mockResolvedValue(mockProfile as any);
      authRepository.findUserByIdWithLearningExpectations.mockResolvedValue(
        mockUser as any,
      );
      authRepository.countKidsByParentId.mockResolvedValue(2);

      const result = await service.updateProfile('user-1', {
        country: 'US',
        language: 'English',
      });

      expect(result).toBeDefined();
      expect(authRepository.upsertProfile).toHaveBeenCalled();
    });
  });
});

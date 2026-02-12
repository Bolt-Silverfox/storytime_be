import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { AdminUserService } from '../admin-user.service';
import { ADMIN_USER_REPOSITORY, IAdminUserRepository } from '../repositories/admin-user.repository.interface';
import { Role } from '@prisma/client';
import { PasswordService } from '../../auth/services/password.service';

describe('AdminUserService', () => {
  let service: AdminUserService;
  let adminUserRepository: jest.Mocked<IAdminUserRepository>;
  let passwordService: jest.Mocked<PasswordService>;

  const mockUser = {
    id: 'user-123',
    email: 'test@example.com',
    name: 'Test User',
    passwordHash: 'hashedPassword123',
    role: 'parent',
    isDeleted: false,
    deletedAt: null,
    isEmailVerified: true,
    onboardingStatus: 'completed',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-02'),
  };

  const mockUserWithRelations = {
    ...mockUser,
    profile: { id: 'profile-1', country: 'NG' },
    avatar: { id: 'avatar-1', url: 'https://example.com/avatar.jpg' },
    kids: [{ id: 'kid-1', name: 'Kid 1' }],
    subscriptions: [],
    _count: {
      kids: 1,
      auth: 10,
      parentFavorites: 5,
      voices: 2,
      subscriptions: 0,
      supportTickets: 3,
      paymentTransactions: 4,
    },
    creditUsed: 0,
    activityLength: 0,
    amountSpent: 0,
    isPaidUser: false,
    kidsCount: 1,
    sessionsCount: 0,
  };

  beforeEach(async () => {
    const mockAdminUserRepository = {
      findUsers: jest.fn(),
      countUsers: jest.fn(),
      findUserById: jest.fn(),
      findUserByIdSimple: jest.fn(),
      createUser: jest.fn(),
      updateUser: jest.fn(),
      softDeleteUser: jest.fn(),
      hardDeleteUser: jest.fn(),
      restoreUser: jest.fn(),
      bulkSoftDeleteUsers: jest.fn(),
      bulkRestoreUsers: jest.fn(),
      bulkVerifyUsers: jest.fn(),
      findUserByEmail: jest.fn(),
      userExistsByEmail: jest.fn(),
      aggregatePaymentTransactions: jest.fn(),
    };

    const mockPasswordService = {
      hashPassword: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminUserService,
        {
          provide: ADMIN_USER_REPOSITORY,
          useValue: mockAdminUserRepository,
        },
        {
          provide: PasswordService,
          useValue: mockPasswordService,
        },
      ],
    }).compile();

    service = module.get<AdminUserService>(AdminUserService);
    adminUserRepository = module.get(ADMIN_USER_REPOSITORY);
    passwordService = module.get(PasswordService);
    jest.clearAllMocks();
  });

  describe('getUserById', () => {
    it('should return user details', async () => {
      adminUserRepository.findUserById.mockResolvedValue(mockUserWithRelations as any);
      adminUserRepository.aggregatePaymentTransactions.mockResolvedValue({ _sum: { amount: 100 } });

      const result = await service.getUserById('user-123');

      expect(result.id).toBe('user-123');
      expect(result.totalSpent).toBe(100);
    });

    it('should throw NotFoundException if user not found', async () => {
      adminUserRepository.findUserById.mockResolvedValue(null);

      await expect(service.getUserById('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('createAdmin', () => {
    it('should create admin successfully', async () => {
      adminUserRepository.findUserByEmail.mockResolvedValue(null); // Return null for existing user check
      passwordService.hashPassword.mockResolvedValue('hashedPassword');
      adminUserRepository.createUser.mockResolvedValue(mockUser as any);

      const result = await service.createAdmin({
        email: 'admin@example.com',
        password: 'password123',
        name: 'Admin User',
      });

      expect(result.id).toBe('user-123');
      expect(passwordService.hashPassword).toHaveBeenCalled();
    });
  });
});

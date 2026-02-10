import { Test, TestingModule } from '@nestjs/testing';
import { NotificationService } from './notification.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { InAppProvider } from './providers/in-app.provider';
import { EmailProvider } from './providers/email.provider';
import { EmailQueueService } from './queue/email-queue.service';
import {
  NotificationCategory as PrismaCategory,
  NotificationType as PrismaNotificationType,
} from '@prisma/client';

// Mock nodemailer
jest.mock('nodemailer', () => ({
  createTransport: jest.fn().mockReturnValue({
    sendMail: jest.fn(),
  }),
}));

// Type-safe mock for PrismaService
type MockPrismaService = {
  user: {
    findUnique: jest.Mock;
  };
  kid: {
    findUnique: jest.Mock;
  };
  notificationPreference: {
    findMany: jest.Mock;
    findUnique: jest.Mock;
    create: jest.Mock;
    createMany: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
    upsert: jest.Mock;
  };
  notification: {
    findMany: jest.Mock;
    count: jest.Mock;
    updateMany: jest.Mock;
  };
};

const createMockPrismaService = (): MockPrismaService => ({
  user: {
    findUnique: jest.fn(),
  },
  kid: {
    findUnique: jest.fn(),
  },
  notificationPreference: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    createMany: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    upsert: jest.fn(),
  },
  notification: {
    findMany: jest.fn(),
    count: jest.fn(),
    updateMany: jest.fn(),
  },
});

type MockConfigService = {
  get: jest.Mock;
};

const createMockConfigService = (): MockConfigService => ({
  get: jest.fn((key: string) => {
    const config: Record<string, string | number | boolean> = {
      SMTP_HOST: 'smtp.test.com',
      SMTP_PORT: 587,
      SMTP_SECURE: false,
      SMTP_USER: 'test@test.com',
      SMTP_PASS: 'password',
      NODE_ENV: 'test',
      DEFAULT_SENDER_NAME: 'Test',
      DEFAULT_SENDER_EMAIL: 'noreply@test.com',
    };
    return config[key];
  }),
});

type MockInAppProvider = {
  send: jest.Mock;
};

const createMockInAppProvider = (): MockInAppProvider => ({
  send: jest.fn(),
});

type MockEmailProvider = {
  send: jest.Mock;
};

const createMockEmailProvider = (): MockEmailProvider => ({
  send: jest.fn(),
});

type MockEmailQueueService = {
  queueEmail: jest.Mock;
};

const createMockEmailQueueService = (): MockEmailQueueService => ({
  queueEmail: jest.fn(),
});

describe('NotificationService', () => {
  let service: NotificationService;
  let mockPrisma: MockPrismaService;
  let mockConfigService: MockConfigService;
  let mockInAppProvider: MockInAppProvider;
  let mockEmailProvider: MockEmailProvider;
  let mockEmailQueueService: MockEmailQueueService;

  const mockUser = {
    id: 'user-1',
    email: 'test@example.com',
    name: 'Test User',
    isDeleted: false,
  };

  const mockKid = {
    id: 'kid-1',
    name: 'Test Kid',
    isDeleted: false,
  };

  const mockPreference = {
    id: 'pref-1',
    userId: 'user-1',
    kidId: null,
    type: PrismaNotificationType.in_app,
    category: PrismaCategory.NEW_STORY,
    enabled: true,
    isDeleted: false,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    mockPrisma = createMockPrismaService();
    mockConfigService = createMockConfigService();
    mockInAppProvider = createMockInAppProvider();
    mockEmailProvider = createMockEmailProvider();
    mockEmailQueueService = createMockEmailQueueService();

    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: InAppProvider, useValue: mockInAppProvider },
        { provide: EmailProvider, useValue: mockEmailProvider },
        { provide: EmailQueueService, useValue: mockEmailQueueService },
      ],
    }).compile();

    service = module.get<NotificationService>(NotificationService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ==================== QUEUE EMAIL TESTS ====================

  describe('queueEmail', () => {
    it('should queue email successfully', async () => {
      mockEmailQueueService.queueEmail.mockResolvedValue({
        queued: true,
        jobId: 'job-1',
      });

      const result = await service.queueEmail(
        'test@example.com',
        'Test Subject',
        '<p>Test content</p>',
      );

      expect(result.queued).toBe(true);
      expect(result.jobId).toBe('job-1');
      expect(mockEmailQueueService.queueEmail).toHaveBeenCalledWith({
        userId: 'system',
        category: PrismaCategory.SYSTEM_ALERT,
        to: 'test@example.com',
        subject: 'Test Subject',
        html: '<p>Test content</p>',
        metadata: undefined,
      });
    });

    it('should queue email with options', async () => {
      mockEmailQueueService.queueEmail.mockResolvedValue({
        queued: true,
        jobId: 'job-2',
      });

      const result = await service.queueEmail(
        'test@example.com',
        'Test Subject',
        '<p>Test content</p>',
        {
          userId: 'user-1',
          category: PrismaCategory.NEW_STORY,
          templateName: 'welcome',
        },
      );

      expect(result.queued).toBe(true);
      expect(mockEmailQueueService.queueEmail).toHaveBeenCalledWith({
        userId: 'user-1',
        category: PrismaCategory.NEW_STORY,
        to: 'test@example.com',
        subject: 'Test Subject',
        html: '<p>Test content</p>',
        metadata: { templateName: 'welcome' },
      });
    });
  });

  // ==================== SEND EMAIL TESTS ====================

  describe('sendEmail', () => {
    it('should queue email by default', async () => {
      mockEmailQueueService.queueEmail.mockResolvedValue({
        queued: true,
        jobId: 'job-1',
      });

      const result = await service.sendEmail(
        'test@example.com',
        'Test Subject',
        '<p>Test</p>',
      );

      expect(result.success).toBe(true);
      expect(result.jobId).toBe('job-1');
    });
  });

  // ==================== SEND VIA PROVIDER TESTS ====================

  describe('sendViaProvider', () => {
    it('should send notification via in_app provider', async () => {
      mockInAppProvider.send.mockResolvedValue({
        success: true,
        messageId: 'msg-1',
      });

      const result = await service.sendViaProvider(
        {
          userId: 'user-1',
          category: PrismaCategory.NEW_STORY,
          title: 'Test',
          body: 'Test body',
          data: {},
        },
        ['in_app'],
      );

      expect(result).toHaveLength(1);
      expect(result[0].success).toBe(true);
    });

    it('should handle provider not found', async () => {
      const result = await service.sendViaProvider(
        {
          userId: 'user-1',
          category: PrismaCategory.NEW_STORY,
          title: 'Test',
          body: 'Test body',
          data: {},
        },
        ['unknown_provider'],
      );

      expect(result).toHaveLength(1);
      expect(result[0].success).toBe(false);
      expect(result[0].error).toContain('not found');
    });

    it('should handle provider errors', async () => {
      mockInAppProvider.send.mockRejectedValue(new Error('Provider error'));

      const result = await service.sendViaProvider(
        {
          userId: 'user-1',
          category: PrismaCategory.NEW_STORY,
          title: 'Test',
          body: 'Test body',
          data: {},
        },
        ['in_app'],
      );

      expect(result).toHaveLength(1);
      expect(result[0].success).toBe(false);
      expect(result[0].error).toBe('Provider error');
    });

    it('should send to multiple channels', async () => {
      mockInAppProvider.send.mockResolvedValue({ success: true });
      mockEmailProvider.send.mockResolvedValue({ success: true });

      const result = await service.sendViaProvider(
        {
          userId: 'user-1',
          category: PrismaCategory.NEW_STORY,
          title: 'Test',
          body: 'Test body',
          data: {},
        },
        ['in_app', 'email'],
      );

      expect(result).toHaveLength(2);
      expect(result.every((r) => r.success)).toBe(true);
    });
  });

  // ==================== NOTIFICATION PREFERENCE CRUD TESTS ====================

  describe('create', () => {
    it('should create notification preference for user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockPrisma.notificationPreference.create.mockResolvedValue(
        mockPreference,
      );

      const result = await service.create({
        userId: 'user-1',
        type: PrismaNotificationType.in_app,
        category: PrismaCategory.NEW_STORY,
        enabled: true,
      });

      expect(result.id).toBe('pref-1');
      expect(mockPrisma.notificationPreference.create).toHaveBeenCalled();
    });

    it('should throw NotFoundException for non-existent user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.create({
          userId: 'nonexistent',
          type: PrismaNotificationType.in_app,
          category: PrismaCategory.NEW_STORY,
          enabled: true,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should create notification preference for kid', async () => {
      mockPrisma.kid.findUnique.mockResolvedValue(mockKid);
      mockPrisma.notificationPreference.create.mockResolvedValue({
        ...mockPreference,
        userId: null,
        kidId: 'kid-1',
      });

      const result = await service.create({
        kidId: 'kid-1',
        type: PrismaNotificationType.in_app,
        category: PrismaCategory.NEW_STORY,
        enabled: true,
      });

      expect(result.kidId).toBe('kid-1');
    });

    it('should throw NotFoundException for non-existent kid', async () => {
      mockPrisma.kid.findUnique.mockResolvedValue(null);

      await expect(
        service.create({
          kidId: 'nonexistent',
          type: PrismaNotificationType.in_app,
          category: PrismaCategory.NEW_STORY,
          enabled: true,
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('should update notification preference', async () => {
      mockPrisma.notificationPreference.update.mockResolvedValue({
        ...mockPreference,
        enabled: false,
      });

      const result = await service.update('pref-1', { enabled: false });

      expect(result.enabled).toBe(false);
    });
  });

  describe('getForUser', () => {
    it('should return user preferences', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockPrisma.notificationPreference.findMany.mockResolvedValue([
        mockPreference,
      ]);

      const result = await service.getForUser('user-1');

      expect(result).toHaveLength(1);
      expect(result[0].userId).toBe('user-1');
    });

    it('should throw NotFoundException for non-existent user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(service.getForUser('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getForKid', () => {
    it('should return kid preferences', async () => {
      mockPrisma.kid.findUnique.mockResolvedValue(mockKid);
      mockPrisma.notificationPreference.findMany.mockResolvedValue([
        { ...mockPreference, userId: null, kidId: 'kid-1' },
      ]);

      const result = await service.getForKid('kid-1');

      expect(result).toHaveLength(1);
    });

    it('should throw NotFoundException for non-existent kid', async () => {
      mockPrisma.kid.findUnique.mockResolvedValue(null);

      await expect(service.getForKid('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getById', () => {
    it('should return preference by id', async () => {
      mockPrisma.notificationPreference.findUnique.mockResolvedValue(
        mockPreference,
      );

      const result = await service.getById('pref-1');

      expect(result.id).toBe('pref-1');
    });

    it('should throw NotFoundException for non-existent preference', async () => {
      mockPrisma.notificationPreference.findUnique.mockResolvedValue(null);

      await expect(service.getById('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('delete', () => {
    it('should soft delete preference by default', async () => {
      mockPrisma.notificationPreference.findUnique.mockResolvedValue(
        mockPreference,
      );
      mockPrisma.notificationPreference.update.mockResolvedValue({
        ...mockPreference,
        isDeleted: true,
      });

      await service.delete('pref-1');

      expect(mockPrisma.notificationPreference.update).toHaveBeenCalledWith({
        where: { id: 'pref-1' },
        data: expect.objectContaining({
          isDeleted: true,
        }),
      });
    });

    it('should permanently delete when permanent=true', async () => {
      mockPrisma.notificationPreference.findUnique.mockResolvedValue(
        mockPreference,
      );
      mockPrisma.notificationPreference.delete.mockResolvedValue(
        mockPreference,
      );

      await service.delete('pref-1', true);

      expect(mockPrisma.notificationPreference.delete).toHaveBeenCalledWith({
        where: { id: 'pref-1' },
      });
    });

    it('should throw NotFoundException for non-existent preference', async () => {
      mockPrisma.notificationPreference.findUnique.mockResolvedValue(null);

      await expect(service.delete('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('undoDelete', () => {
    it('should restore soft deleted preference', async () => {
      mockPrisma.notificationPreference.findUnique.mockResolvedValue({
        ...mockPreference,
        isDeleted: true,
      });
      mockPrisma.notificationPreference.update.mockResolvedValue({
        ...mockPreference,
        isDeleted: false,
        deletedAt: null,
      });

      const result = await service.undoDelete('pref-1');

      expect(result.id).toBe('pref-1');
      expect(mockPrisma.notificationPreference.update).toHaveBeenCalledWith({
        where: { id: 'pref-1' },
        data: {
          isDeleted: false,
          deletedAt: null,
        },
      });
    });

    it('should throw NotFoundException for non-existent preference', async () => {
      mockPrisma.notificationPreference.findUnique.mockResolvedValue(null);

      await expect(service.undoDelete('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException if preference is not deleted', async () => {
      mockPrisma.notificationPreference.findUnique.mockResolvedValue(
        mockPreference,
      );

      await expect(service.undoDelete('pref-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ==================== TOGGLE CATEGORY PREFERENCE TESTS ====================

  describe('toggleCategoryPreference', () => {
    it('should toggle category preference for all channels', async () => {
      mockPrisma.notificationPreference.upsert.mockResolvedValue(
        mockPreference,
      );

      const result = await service.toggleCategoryPreference(
        'user-1',
        PrismaCategory.NEW_STORY,
        true,
      );

      expect(result).toHaveLength(2); // in_app and push
      expect(mockPrisma.notificationPreference.upsert).toHaveBeenCalledTimes(2);
    });
  });

  // ==================== GET USER PREFERENCES GROUPED TESTS ====================

  describe('getUserPreferencesGrouped', () => {
    it('should return grouped preferences', async () => {
      mockPrisma.notificationPreference.findMany.mockResolvedValue([
        {
          ...mockPreference,
          type: PrismaNotificationType.push,
          category: PrismaCategory.NEW_STORY,
          enabled: true,
        },
        {
          ...mockPreference,
          id: 'pref-2',
          type: PrismaNotificationType.in_app,
          category: PrismaCategory.NEW_STORY,
          enabled: false,
        },
      ]);

      const result = await service.getUserPreferencesGrouped('user-1');

      expect(result[PrismaCategory.NEW_STORY]).toBeDefined();
      expect(result[PrismaCategory.NEW_STORY].push).toBe(true);
      expect(result[PrismaCategory.NEW_STORY].in_app).toBe(false);
    });

    it('should return empty object if no preferences', async () => {
      mockPrisma.notificationPreference.findMany.mockResolvedValue([]);

      const result = await service.getUserPreferencesGrouped('user-1');

      expect(result).toEqual({});
    });
  });

  // ==================== UPDATE USER PREFERENCES TESTS ====================

  describe('updateUserPreferences', () => {
    it('should update multiple category preferences', async () => {
      mockPrisma.notificationPreference.upsert.mockResolvedValue(
        mockPreference,
      );
      mockPrisma.notificationPreference.findMany.mockResolvedValue([]);

      await service.updateUserPreferences('user-1', {
        [PrismaCategory.NEW_STORY]: true,
        [PrismaCategory.STORY_FINISHED]: false,
      });

      expect(mockPrisma.notificationPreference.upsert).toHaveBeenCalledTimes(4); // 2 categories * 2 channels
    });
  });

  // ==================== SEED DEFAULT PREFERENCES TESTS ====================

  describe('seedDefaultPreferences', () => {
    it('should seed default preferences for new user', async () => {
      mockPrisma.notificationPreference.createMany.mockResolvedValue({
        count: 12,
      });

      await service.seedDefaultPreferences('user-1');

      expect(mockPrisma.notificationPreference.createMany).toHaveBeenCalledWith(
        {
          data: expect.arrayContaining([
            expect.objectContaining({
              userId: 'user-1',
              enabled: true,
            }),
          ]),
          skipDuplicates: true,
        },
      );
    });
  });

  // ==================== IN-APP NOTIFICATIONS TESTS ====================

  describe('getInAppNotifications', () => {
    it('should return paginated notifications', async () => {
      const mockNotifications = [
        {
          id: 'notif-1',
          userId: 'user-1',
          title: 'Test',
          body: 'Test body',
          isRead: false,
          category: PrismaCategory.NEW_STORY,
          createdAt: new Date(),
        },
      ];
      mockPrisma.notification.findMany.mockResolvedValue(mockNotifications);
      mockPrisma.notification.count.mockResolvedValue(1);

      const result = await service.getInAppNotifications('user-1', 20, 0);

      expect(result.notifications).toHaveLength(1);
      expect(result.total).toBe(1);
    });

    it('should filter unread only notifications', async () => {
      mockPrisma.notification.findMany.mockResolvedValue([]);
      mockPrisma.notification.count.mockResolvedValue(0);

      await service.getInAppNotifications('user-1', 20, 0, true);

      expect(mockPrisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            isRead: false,
          }),
        }),
      );
    });
  });

  describe('markAsRead', () => {
    it('should mark specific notifications as read', async () => {
      mockPrisma.notification.updateMany.mockResolvedValue({ count: 2 });

      await service.markAsRead('user-1', ['notif-1', 'notif-2']);

      expect(mockPrisma.notification.updateMany).toHaveBeenCalledWith({
        where: {
          id: { in: ['notif-1', 'notif-2'] },
          userId: 'user-1',
        },
        data: { isRead: true },
      });
    });
  });

  describe('markAllAsRead', () => {
    it('should mark all notifications as read', async () => {
      mockPrisma.notification.updateMany.mockResolvedValue({ count: 5 });

      await service.markAllAsRead('user-1');

      expect(mockPrisma.notification.updateMany).toHaveBeenCalledWith({
        where: {
          userId: 'user-1',
          isRead: false,
        },
        data: { isRead: true },
      });
    });
  });
});

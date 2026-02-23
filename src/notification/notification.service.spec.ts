import { Test, TestingModule } from '@nestjs/testing';
import { NotificationService } from './notification.service';
import { PrismaService } from '@/prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { InAppProvider } from './providers/in-app.provider';
import { EmailProvider } from './providers/email.provider';
import { PushProvider } from './providers/push.provider';
import { EmailQueueService } from './queue/email-queue.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { NotificationCategory as PrismaCategory } from '@prisma/client';

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
        { provide: PushProvider, useValue: { send: jest.fn() } },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
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
});

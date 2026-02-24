import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import request from 'supertest';
import { Server } from 'http';
import { ConfigModule } from '@nestjs/config';
import { CacheModule } from '@nestjs/cache-manager';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { SuccessResponseInterceptor } from '../src/shared/interceptors/success-response.interceptor';
import { HttpExceptionFilter } from '../src/shared/filters/http-exception.filter';
import { PrismaExceptionFilter } from '../src/shared/filters/prisma-exception.filter';
import { AuthThrottleGuard } from '../src/shared/guards/auth-throttle.guard';
import { AuthSessionGuard } from '../src/shared/guards/auth.guard';
import { KidController } from '../src/kid/kid.controller';
import { KidService } from '../src/kid/kid.service';
import { AnalyticsService } from '../src/analytics/analytics.service';

/**
 * E2E Tests for Kid Profile Management
 *
 * These tests cover:
 * - Listing kids (empty, with kids)
 * - Creating kid(s) (valid, missing fields, multiple)
 * - Getting kid by ID (found, not found)
 * - Updating kid profile
 * - Deleting kid (soft delete)
 * - Restoring deleted kid
 * - Unauthenticated access rejection
 */

const TEST_USER_ID = 'test-user-id';
const TEST_USER_EMAIL = 'test@example.com';
const TEST_USER_ROLE = 'parent';

const mockKid = {
  id: 'kid-1',
  name: 'Test Kid',
  ageRange: '4-6',
  avatarId: null,
  parentId: TEST_USER_ID,
  preferredVoiceId: null,
  preferredVoice: null,
  preferredCategoryIds: [],
  excludedTags: [],
  isBedtimeEnabled: false,
  bedtimeStart: null,
  bedtimeEnd: null,
  bedtimeDays: [],
  bedtimeLockApp: false,
  bedtimeDimScreen: false,
  bedtimeReminder: false,
  bedtimeStoriesOnly: false,
  dailyScreenTimeLimitMins: null,
  isDeleted: false,
  deletedAt: null,
  createdAt: new Date('2025-01-01'),
  updatedAt: new Date('2025-01-01'),
};

describe('Kid Profile Management (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let mockKidService: Record<string, jest.Mock>;
  let mockAnalyticsService: Record<string, jest.Mock>;

  beforeAll(async () => {
    mockKidService = {
      findAllByUser: jest.fn(),
      createKids: jest.fn(),
      findOne: jest.fn(),
      updateKid: jest.fn(),
      deleteKid: jest.fn(),
      undoDeleteKid: jest.fn(),
    };

    mockAnalyticsService = {
      logActivity: jest.fn().mockResolvedValue(undefined),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          envFilePath: '.env.test',
        }),
        CacheModule.register({ isGlobal: true }),
        ThrottlerModule.forRoot([
          { name: 'short', ttl: 1000, limit: 100 },
          { name: 'long', ttl: 60000, limit: 1000 },
        ]),
        EventEmitterModule.forRoot(),
      ],
      controllers: [KidController],
      providers: [
        {
          provide: KidService,
          useValue: mockKidService,
        },
        {
          provide: AnalyticsService,
          useValue: mockAnalyticsService,
        },
      ],
    })
      .overrideGuard(AuthThrottleGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(AuthSessionGuard)
      .useValue({
        canActivate: (context: {
          switchToHttp: () => {
            getRequest: () => Record<string, unknown>;
          };
        }) => {
          const req = context.switchToHttp().getRequest();
          const authHeader = (req.headers as Record<string, string>)
            ?.authorization;
          if (authHeader && authHeader.startsWith('Bearer ')) {
            req.authUserData = {
              userId: TEST_USER_ID,
              email: TEST_USER_EMAIL,
              role: TEST_USER_ROLE,
            };
            return true;
          }
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const { UnauthorizedException } = require('@nestjs/common');
          throw new UnauthorizedException(
            'Missing or invalid authorization header',
          );
        },
      })
      .compile();

    app = moduleFixture.createNestApplication();

    app.useGlobalInterceptors(new SuccessResponseInterceptor());
    const { httpAdapter } = app.get(HttpAdapterHost);
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalFilters(new PrismaExceptionFilter(httpAdapter));

    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );

    app.setGlobalPrefix('api/v1');
    await app.init();
    server = app.getHttpServer() as Server;
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ==================== HELPER FUNCTIONS ====================

  const expectSuccessResponse = (res: request.Response, statusCode: number) => {
    expect(res.status).toBe(statusCode);
    expect(res.body.success).toBe(true);
    expect(res.body.statusCode).toBe(statusCode);
    expect(res.body).toHaveProperty('data');
  };

  const expectErrorResponse = (
    res: request.Response,
    statusCode: number,
    errorType: string,
  ) => {
    expect(res.status).toBe(statusCode);
    expect(res.body.success).toBe(false);
    expect(res.body.statusCode).toBe(statusCode);
    expect(res.body.error).toBe(errorType);
    expect(res.body).toHaveProperty('message');
  };

  const authenticatedGet = (url: string) =>
    request(server).get(url).set('Authorization', 'Bearer mock-valid-token');

  const authenticatedPost = (url: string) =>
    request(server).post(url).set('Authorization', 'Bearer mock-valid-token');

  const authenticatedPut = (url: string) =>
    request(server).put(url).set('Authorization', 'Bearer mock-valid-token');

  const authenticatedDelete = (url: string) =>
    request(server).delete(url).set('Authorization', 'Bearer mock-valid-token');

  // ==================== GET ALL KIDS TESTS ====================

  describe('GET /auth/kids', () => {
    it('should return empty array when user has no kids', async () => {
      mockKidService.findAllByUser.mockResolvedValue([]);

      const res = await authenticatedGet('/api/v1/auth/kids');

      expectSuccessResponse(res, 200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data).toHaveLength(0);
      expect(mockKidService.findAllByUser).toHaveBeenCalledWith(TEST_USER_ID);
    });

    it('should return list of kids when user has kids', async () => {
      mockKidService.findAllByUser.mockResolvedValue([mockKid]);

      const res = await authenticatedGet('/api/v1/auth/kids');

      expectSuccessResponse(res, 200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].id).toBe('kid-1');
      expect(res.body.data[0].name).toBe('Test Kid');
      expect(res.body.data[0].ageRange).toBe('4-6');
    });

    it('should reject unauthenticated request', async () => {
      const res = await request(server).get('/api/v1/auth/kids');

      expectErrorResponse(res, 401, 'Unauthorized');
    });
  });

  // ==================== CREATE KIDS TESTS ====================

  describe('POST /auth/kids', () => {
    it('should create a single kid successfully', async () => {
      const newKid = { ...mockKid, id: 'kid-new' };
      mockKidService.createKids.mockResolvedValue([newKid]);

      const res = await authenticatedPost('/api/v1/auth/kids').send([
        { name: 'New Kid', ageRange: '4-6' },
      ]);

      expectSuccessResponse(res, 201);
      expect(mockKidService.createKids).toHaveBeenCalledWith(TEST_USER_ID, [
        expect.objectContaining({ name: 'New Kid', ageRange: '4-6' }),
      ]);
    });

    it('should create multiple kids at once', async () => {
      const kids = [
        { ...mockKid, id: 'kid-a', name: 'Kid A' },
        { ...mockKid, id: 'kid-b', name: 'Kid B' },
      ];
      mockKidService.createKids.mockResolvedValue(kids);

      const res = await authenticatedPost('/api/v1/auth/kids').send([
        { name: 'Kid A', ageRange: '4-6' },
        { name: 'Kid B', ageRange: '7-9' },
      ]);

      expectSuccessResponse(res, 201);
      expect(mockKidService.createKids).toHaveBeenCalledWith(
        TEST_USER_ID,
        expect.arrayContaining([
          expect.objectContaining({ name: 'Kid A' }),
          expect.objectContaining({ name: 'Kid B' }),
        ]),
      );
    });

    it('should reject when name is missing', async () => {
      const res = await authenticatedPost('/api/v1/auth/kids').send([
        { ageRange: '4-6' },
      ]);

      expectErrorResponse(res, 400, 'Bad Request');
    });

    it('should reject when ageRange is missing', async () => {
      const res = await authenticatedPost('/api/v1/auth/kids').send([
        { name: 'Test Kid' },
      ]);

      expectErrorResponse(res, 400, 'Bad Request');
    });

    it('should reject unauthenticated request', async () => {
      const res = await request(server)
        .post('/api/v1/auth/kids')
        .send([{ name: 'Test', ageRange: '4-6' }]);

      expectErrorResponse(res, 401, 'Unauthorized');
    });
  });

  // ==================== GET KID BY ID TESTS ====================

  describe('GET /user/kids/:kidId', () => {
    it('should return kid details when found', async () => {
      const kidWithStats = {
        ...mockKid,
        recommendationStats: { total: 5 },
      };
      mockKidService.findOne.mockResolvedValue(kidWithStats);

      const res = await authenticatedGet('/api/v1/user/kids/kid-1');

      expectSuccessResponse(res, 200);
      expect(res.body.data.id).toBe('kid-1');
      expect(res.body.data.name).toBe('Test Kid');
      expect(mockKidService.findOne).toHaveBeenCalledWith(
        'kid-1',
        TEST_USER_ID,
      );
    });

    it('should return 404 when kid is not found', async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { NotFoundException } = require('@nestjs/common');
      mockKidService.findOne.mockRejectedValue(
        new NotFoundException('Kid not found'),
      );

      const res = await authenticatedGet('/api/v1/user/kids/nonexistent');

      expectErrorResponse(res, 404, 'Not Found');
    });

    it('should reject unauthenticated request', async () => {
      const res = await request(server).get('/api/v1/user/kids/kid-1');

      expectErrorResponse(res, 401, 'Unauthorized');
    });
  });

  // ==================== UPDATE KID TESTS ====================

  describe('PUT /auth/kids/:kidId', () => {
    it('should update kid profile successfully', async () => {
      const updatedKid = { ...mockKid, name: 'Updated Name', ageRange: '7-9' };
      mockKidService.updateKid.mockResolvedValue(updatedKid);

      const res = await authenticatedPut('/api/v1/auth/kids/kid-1').send({
        name: 'Updated Name',
        ageRange: '7-9',
      });

      expectSuccessResponse(res, 200);
      expect(mockKidService.updateKid).toHaveBeenCalledWith(
        'kid-1',
        TEST_USER_ID,
        expect.objectContaining({ name: 'Updated Name', ageRange: '7-9' }),
      );
    });

    it('should reject unauthenticated request', async () => {
      const res = await request(server)
        .put('/api/v1/auth/kids/kid-1')
        .send({ name: 'Updated' });

      expectErrorResponse(res, 401, 'Unauthorized');
    });
  });

  // ==================== DELETE KID TESTS ====================

  describe('DELETE /auth/kids/:kidId', () => {
    it('should soft delete a kid successfully', async () => {
      const deletedKid = {
        ...mockKid,
        isDeleted: true,
        deletedAt: new Date(),
      };
      mockKidService.deleteKid.mockResolvedValue(deletedKid);

      const res = await authenticatedDelete('/api/v1/auth/kids/kid-1');

      expectSuccessResponse(res, 200);
      expect(mockKidService.deleteKid).toHaveBeenCalledWith(
        'kid-1',
        TEST_USER_ID,
        false,
      );
    });

    it('should reject unauthenticated request', async () => {
      const res = await request(server).delete('/api/v1/auth/kids/kid-1');

      expectErrorResponse(res, 401, 'Unauthorized');
    });
  });

  // ==================== RESTORE KID TESTS ====================

  describe('POST /auth/kids/:kidId/undo-delete', () => {
    it('should restore a soft-deleted kid successfully', async () => {
      const restoredKid = {
        ...mockKid,
        isDeleted: false,
        deletedAt: null,
      };
      mockKidService.undoDeleteKid.mockResolvedValue(restoredKid);

      const res = await authenticatedPost(
        '/api/v1/auth/kids/kid-1/undo-delete',
      );

      expectSuccessResponse(res, 201);
      expect(mockKidService.undoDeleteKid).toHaveBeenCalledWith(
        'kid-1',
        TEST_USER_ID,
      );
    });

    it('should reject unauthenticated request', async () => {
      const res = await request(server).post(
        '/api/v1/auth/kids/kid-1/undo-delete',
      );

      expectErrorResponse(res, 401, 'Unauthorized');
    });
  });
});

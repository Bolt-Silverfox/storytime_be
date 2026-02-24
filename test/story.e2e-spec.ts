import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import request from 'supertest';
import { Server } from 'http';
import { StoryController } from '../src/story/story.controller';
import { StoryService } from '../src/story/story.service';
import { StoryGenerationService } from '../src/story/story-generation.service';
import { StoryProgressService } from '../src/story/story-progress.service';
import { StoryRecommendationService } from '../src/story/story-recommendation.service';
import { DailyChallengeService } from '../src/story/daily-challenge.service';
import { StoryQuotaService } from '../src/story/story-quota.service';
import { StoryQueueService } from '../src/story/queue';
import { ConfigModule } from '@nestjs/config';
import { CacheModule } from '@nestjs/cache-manager';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { SuccessResponseInterceptor } from '../src/shared/interceptors/success-response.interceptor';
import { HttpExceptionFilter } from '../src/shared/filters/http-exception.filter';
import { PrismaExceptionFilter } from '../src/shared/filters/prisma-exception.filter';
import { AuthThrottleGuard } from '../src/shared/guards/auth-throttle.guard';
import { AuthSessionGuard } from '../src/shared/guards/auth.guard';
import { StoryAccessGuard } from '../src/shared/guards/story-access.guard';
import { SubscriptionThrottleGuard } from '../src/shared/guards/subscription-throttle.guard';

/**
 * E2E Tests for Story Operations
 *
 * These tests cover:
 * - Listing stories (public)
 * - Getting categories, themes, seasons (public)
 * - Creating a story (authenticated)
 * - Getting a story by ID (authenticated)
 * - Updating a story (authenticated)
 * - Deleting a story (authenticated)
 * - Adding a favorite (authenticated)
 * - Setting story progress (authenticated)
 * - Input validation
 * - Unauthenticated access rejection
 */

const TEST_USER_ID = 'test-user-id';
const TEST_USER_EMAIL = 'test@example.com';
const TEST_USER_ROLE = 'parent';

const MOCK_STORY = {
  id: 'story-1',
  title: 'Test Story',
  description: 'A wonderful test story',
  language: 'English',
  themeIds: ['theme-1'],
  categoryIds: ['category-1'],
  coverImageUrl: 'https://example.com/cover.jpg',
  textContent: 'Once upon a time...',
  isInteractive: false,
  ageMin: 4,
  ageMax: 8,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const MOCK_PAGINATED_STORIES = {
  stories: [MOCK_STORY],
  total: 1,
  page: 1,
  limit: 12,
  totalPages: 1,
};

const MOCK_CATEGORIES = [
  { id: 'cat-1', name: 'Bedtime Stories' },
  { id: 'cat-2', name: 'Adventure' },
];

const MOCK_THEMES = [
  { id: 'theme-1', name: 'Friendship' },
  { id: 'theme-2', name: 'Courage' },
];

const MOCK_SEASONS = [
  { id: 'season-1', name: 'Winter' },
  { id: 'season-2', name: 'Summer' },
];

const MOCK_FAVORITE = {
  id: 'fav-1',
  kidId: '550e8400-e29b-41d4-a716-446655440000',
  storyId: '550e8400-e29b-41d4-a716-446655440001',
  createdAt: new Date().toISOString(),
};

const MOCK_PROGRESS = {
  id: 'progress-1',
  kidId: '550e8400-e29b-41d4-a716-446655440000',
  storyId: '550e8400-e29b-41d4-a716-446655440001',
  progress: 50,
  completed: false,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe('Story (e2e)', () => {
  let app: INestApplication;
  let server: Server;

  // Mock services
  const mockStoryService = {
    getStories: jest.fn().mockResolvedValue(MOCK_PAGINATED_STORIES),
    getCategories: jest.fn().mockResolvedValue(MOCK_CATEGORIES),
    getThemes: jest.fn().mockResolvedValue(MOCK_THEMES),
    getSeasons: jest.fn().mockResolvedValue(MOCK_SEASONS),
    createStory: jest.fn().mockResolvedValue(MOCK_STORY),
    getStoryById: jest.fn().mockResolvedValue(MOCK_STORY),
    updateStory: jest
      .fn()
      .mockResolvedValue({ ...MOCK_STORY, title: 'Updated Title' }),
    deleteStory: jest.fn().mockResolvedValue({ message: 'Story deleted' }),
    undoDeleteStory: jest.fn().mockResolvedValue(MOCK_STORY),
    addImage: jest
      .fn()
      .mockResolvedValue({ id: 'img-1', url: 'https://example.com/img.jpg' }),
    addBranch: jest
      .fn()
      .mockResolvedValue({ id: 'branch-1', prompt: 'What next?' }),
    addFavorite: jest.fn().mockResolvedValue(MOCK_FAVORITE),
    removeFavorite: jest
      .fn()
      .mockResolvedValue({ message: 'Favorite removed' }),
    getFavorites: jest.fn().mockResolvedValue([MOCK_FAVORITE]),
    startStoryPath: jest.fn().mockResolvedValue({ id: 'path-1' }),
    updateStoryPath: jest.fn().mockResolvedValue({ id: 'path-1' }),
    getStoryPathsForKid: jest.fn().mockResolvedValue([]),
    getStoryPathById: jest.fn().mockResolvedValue({ id: 'path-1' }),
    getCreatedStories: jest.fn().mockResolvedValue([]),
    getDownloads: jest.fn().mockResolvedValue([]),
    addDownload: jest.fn().mockResolvedValue({ id: 'dl-1' }),
    removeDownload: jest
      .fn()
      .mockResolvedValue({ message: 'Download removed' }),
    removeFromLibrary: jest.fn().mockResolvedValue(undefined),
  };

  const mockStoryGenerationService = {
    generateStoryWithAI: jest.fn().mockResolvedValue(MOCK_STORY),
    generateStoryForKid: jest.fn().mockResolvedValue(MOCK_STORY),
  };

  const mockStoryProgressService = {
    setProgress: jest.fn().mockResolvedValue(MOCK_PROGRESS),
    getProgress: jest.fn().mockResolvedValue(MOCK_PROGRESS),
    setUserProgress: jest.fn().mockResolvedValue(MOCK_PROGRESS),
    getUserProgress: jest.fn().mockResolvedValue(MOCK_PROGRESS),
    getUserContinueReading: jest.fn().mockResolvedValue([]),
    getUserCompletedStories: jest.fn().mockResolvedValue([]),
    removeFromUserLibrary: jest.fn().mockResolvedValue(undefined),
    getContinueReading: jest.fn().mockResolvedValue([]),
    getCompletedStories: jest.fn().mockResolvedValue([]),
  };

  const mockStoryRecommendationService = {
    recommendStoryToKid: jest.fn().mockResolvedValue({ id: 'rec-1' }),
    getKidRecommendations: jest.fn().mockResolvedValue([]),
    deleteRecommendation: jest.fn().mockResolvedValue({ message: 'Deleted' }),
    getRecommendationStats: jest.fn().mockResolvedValue({ total: 0 }),
    getTopPicksFromParents: jest.fn().mockResolvedValue([]),
    getTopPicksFromUs: jest.fn().mockResolvedValue([]),
    getHomePageStories: jest.fn().mockResolvedValue({}),
    restrictStory: jest.fn().mockResolvedValue({ message: 'Restricted' }),
    unrestrictStory: jest.fn().mockResolvedValue({ message: 'Unrestricted' }),
    getRestrictedStories: jest.fn().mockResolvedValue([]),
  };

  const mockDailyChallengeService = {
    setDailyChallenge: jest.fn().mockResolvedValue({ id: 'dc-1' }),
    getDailyChallenge: jest.fn().mockResolvedValue({ id: 'dc-1' }),
    assignDailyChallenge: jest.fn().mockResolvedValue({ id: 'dca-1' }),
    completeDailyChallenge: jest.fn().mockResolvedValue({ id: 'dca-1' }),
    getAssignmentsForKid: jest.fn().mockResolvedValue([]),
    getAssignmentById: jest.fn().mockResolvedValue({ id: 'dca-1' }),
    assignDailyChallengeToAllKids: jest.fn().mockResolvedValue(undefined),
    getTodaysDailyChallengeAssignment: jest
      .fn()
      .mockResolvedValue({ id: 'dca-1' }),
    getWeeklyDailyChallengeAssignments: jest.fn().mockResolvedValue([]),
  };

  const mockStoryQuotaService = {
    getQuotaStatus: jest.fn().mockResolvedValue({
      isPremium: false,
      unlimited: false,
      used: 0,
      baseLimit: 5,
      bonusStories: 0,
      totalAllowed: 5,
      remaining: 5,
    }),
    recordNewStoryAccess: jest.fn().mockResolvedValue(undefined),
    checkAccess: jest
      .fn()
      .mockResolvedValue({ allowed: true, reason: 'within_quota' }),
  };

  const mockStoryQueueService = {
    queueStoryGeneration: jest
      .fn()
      .mockResolvedValue({ queued: true, jobId: 'job-1' }),
    queueStoryForKid: jest
      .fn()
      .mockResolvedValue({ queued: true, jobId: 'job-1' }),
    getJobStatus: jest
      .fn()
      .mockResolvedValue({ jobId: 'job-1', status: 'completed' }),
    getJobResult: jest
      .fn()
      .mockResolvedValue({ success: true, storyId: 'story-1' }),
    cancelJob: jest.fn().mockResolvedValue({ cancelled: true }),
    getUserPendingJobs: jest.fn().mockResolvedValue([]),
    getQueueStats: jest
      .fn()
      .mockResolvedValue({ waiting: 0, active: 0, completed: 0, failed: 0 }),
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          envFilePath: '.env.test',
        }),
        CacheModule.register({ isGlobal: true }),
        ThrottlerModule.forRoot([
          { name: 'short', ttl: 1000, limit: 100 },
          { name: 'medium', ttl: 10000, limit: 100 },
          { name: 'long', ttl: 60000, limit: 1000 },
        ]),
        EventEmitterModule.forRoot(),
      ],
      controllers: [StoryController],
      providers: [
        { provide: StoryService, useValue: mockStoryService },
        {
          provide: StoryGenerationService,
          useValue: mockStoryGenerationService,
        },
        { provide: StoryProgressService, useValue: mockStoryProgressService },
        {
          provide: StoryRecommendationService,
          useValue: mockStoryRecommendationService,
        },
        { provide: DailyChallengeService, useValue: mockDailyChallengeService },
        { provide: StoryQuotaService, useValue: mockStoryQuotaService },
        { provide: StoryQueueService, useValue: mockStoryQueueService },
      ],
    })
      .overrideGuard(AuthThrottleGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(StoryAccessGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(SubscriptionThrottleGuard)
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

    // Apply global interceptors and filters
    app.useGlobalInterceptors(new SuccessResponseInterceptor());
    const { httpAdapter } = app.get(HttpAdapterHost);
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalFilters(new PrismaExceptionFilter(httpAdapter));

    // Apply validation pipe
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

  const authenticatedPatch = (url: string) =>
    request(server).patch(url).set('Authorization', 'Bearer mock-valid-token');

  const authenticatedDelete = (url: string) =>
    request(server).delete(url).set('Authorization', 'Bearer mock-valid-token');

  // ==================== GET STORIES TESTS ====================

  describe('GET /stories', () => {
    it('should return paginated stories without authentication', async () => {
      const res = await request(server).get('/api/v1/stories');

      expectSuccessResponse(res, 200);
      expect(res.body.data).toHaveProperty('stories');
      expect(res.body.data).toHaveProperty('total');
      expect(res.body.data).toHaveProperty('page');
      expect(res.body.data).toHaveProperty('limit');
      expect(res.body.data).toHaveProperty('totalPages');
      expect(Array.isArray(res.body.data.stories)).toBe(true);
    });

    it('should pass query parameters to the service', async () => {
      await request(server).get(
        '/api/v1/stories?theme=Adventure&category=Bedtime&page=2&limit=5',
      );

      expect(mockStoryService.getStories).toHaveBeenCalledWith(
        expect.objectContaining({
          theme: 'Adventure',
          category: 'Bedtime',
          page: 2,
          limit: 5,
        }),
      );
    });
  });

  // ==================== GET CATEGORIES TESTS ====================

  describe('GET /stories/categories', () => {
    it('should return categories without authentication', async () => {
      const res = await request(server).get('/api/v1/stories/categories');

      expectSuccessResponse(res, 200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.data[0]).toHaveProperty('id');
      expect(res.body.data[0]).toHaveProperty('name');
    });
  });

  // ==================== GET THEMES TESTS ====================

  describe('GET /stories/themes', () => {
    it('should return themes without authentication', async () => {
      const res = await request(server).get('/api/v1/stories/themes');

      expectSuccessResponse(res, 200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.data[0]).toHaveProperty('id');
      expect(res.body.data[0]).toHaveProperty('name');
    });
  });

  // ==================== GET SEASONS TESTS ====================

  describe('GET /stories/seasons', () => {
    it('should return seasons without authentication', async () => {
      const res = await request(server).get('/api/v1/stories/seasons');

      expectSuccessResponse(res, 200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.data[0]).toHaveProperty('id');
      expect(res.body.data[0]).toHaveProperty('name');
    });
  });

  // ==================== CREATE STORY TESTS ====================

  describe('POST /stories', () => {
    const validCreateBody = {
      title: 'My New Story',
      description: 'A story about adventures',
      language: 'English',
      themeIds: ['theme-1'],
      categoryIds: ['category-1'],
    };

    it('should create a story when authenticated with valid data', async () => {
      const res =
        await authenticatedPost('/api/v1/stories').send(validCreateBody);

      expectSuccessResponse(res, 201);
      expect(res.body.data).toHaveProperty('id');
      expect(res.body.data).toHaveProperty('title');
      expect(mockStoryService.createStory).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'My New Story',
          description: 'A story about adventures',
          language: 'English',
        }),
      );
    });

    it('should reject unauthenticated request', async () => {
      const res = await request(server)
        .post('/api/v1/stories')
        .send(validCreateBody);

      expectErrorResponse(res, 401, 'Unauthorized');
    });

    it('should reject request with missing required title', async () => {
      const res = await authenticatedPost('/api/v1/stories').send({
        description: 'A story',
        language: 'English',
        themeIds: ['theme-1'],
        categoryIds: ['category-1'],
      });

      expectErrorResponse(res, 400, 'Bad Request');
    });

    it('should reject request with missing required description', async () => {
      const res = await authenticatedPost('/api/v1/stories').send({
        title: 'My Story',
        language: 'English',
        themeIds: ['theme-1'],
        categoryIds: ['category-1'],
      });

      expectErrorResponse(res, 400, 'Bad Request');
    });

    it('should reject request with unexpected fields', async () => {
      const res = await authenticatedPost('/api/v1/stories').send({
        ...validCreateBody,
        unknownField: 'should be rejected',
      });

      expectErrorResponse(res, 400, 'Bad Request');
    });

    it('should reject request with empty title', async () => {
      const res = await authenticatedPost('/api/v1/stories').send({
        ...validCreateBody,
        title: '',
      });

      expectErrorResponse(res, 400, 'Bad Request');
    });
  });

  // ==================== GET STORY BY ID TESTS ====================

  describe('GET /stories/:id', () => {
    it('should return a story by ID when authenticated', async () => {
      const res = await authenticatedGet('/api/v1/stories/story-1');

      expectSuccessResponse(res, 200);
      expect(res.body.data).toHaveProperty('id', 'story-1');
      expect(res.body.data).toHaveProperty('title', 'Test Story');
      expect(mockStoryService.getStoryById).toHaveBeenCalledWith('story-1');
    });

    it('should reject unauthenticated request', async () => {
      const res = await request(server).get('/api/v1/stories/story-1');

      expectErrorResponse(res, 401, 'Unauthorized');
    });
  });

  // ==================== UPDATE STORY TESTS ====================

  describe('PATCH /stories/:id', () => {
    it('should update a story when authenticated', async () => {
      const res = await authenticatedPatch('/api/v1/stories/story-1').send({
        title: 'Updated Title',
      });

      expectSuccessResponse(res, 200);
      expect(mockStoryService.updateStory).toHaveBeenCalledWith(
        'story-1',
        expect.objectContaining({ title: 'Updated Title' }),
      );
    });

    it('should reject unauthenticated request', async () => {
      const res = await request(server)
        .patch('/api/v1/stories/story-1')
        .send({ title: 'Updated Title' });

      expectErrorResponse(res, 401, 'Unauthorized');
    });

    it('should reject request with unexpected fields', async () => {
      const res = await authenticatedPatch('/api/v1/stories/story-1').send({
        title: 'Updated Title',
        unknownField: 'value',
      });

      expectErrorResponse(res, 400, 'Bad Request');
    });
  });

  // ==================== DELETE STORY TESTS ====================

  describe('DELETE /stories/:id', () => {
    it('should delete a story when authenticated', async () => {
      const res = await authenticatedDelete('/api/v1/stories/story-1');

      expectSuccessResponse(res, 200);
      expect(mockStoryService.deleteStory).toHaveBeenCalledWith(
        'story-1',
        expect.anything(),
      );
    });

    it('should reject unauthenticated request', async () => {
      const res = await request(server).delete('/api/v1/stories/story-1');

      expectErrorResponse(res, 401, 'Unauthorized');
    });
  });

  // ==================== FAVORITES TESTS ====================

  describe('POST /stories/favorites', () => {
    const validFavoriteBody = {
      kidId: '550e8400-e29b-41d4-a716-446655440000',
      storyId: '550e8400-e29b-41d4-a716-446655440001',
    };

    it('should add a favorite when authenticated with valid data', async () => {
      const res = await authenticatedPost('/api/v1/stories/favorites').send(
        validFavoriteBody,
      );

      expectSuccessResponse(res, 201);
      expect(mockStoryService.addFavorite).toHaveBeenCalledWith(
        expect.objectContaining({
          kidId: validFavoriteBody.kidId,
          storyId: validFavoriteBody.storyId,
        }),
      );
    });

    it('should reject unauthenticated request', async () => {
      const res = await request(server)
        .post('/api/v1/stories/favorites')
        .send(validFavoriteBody);

      expectErrorResponse(res, 401, 'Unauthorized');
    });

    it('should reject request with invalid UUID for kidId', async () => {
      const res = await authenticatedPost('/api/v1/stories/favorites').send({
        kidId: 'not-a-uuid',
        storyId: '550e8400-e29b-41d4-a716-446655440001',
      });

      expectErrorResponse(res, 400, 'Bad Request');
    });

    it('should reject request with missing storyId', async () => {
      const res = await authenticatedPost('/api/v1/stories/favorites').send({
        kidId: '550e8400-e29b-41d4-a716-446655440000',
      });

      expectErrorResponse(res, 400, 'Bad Request');
    });
  });

  // ==================== PROGRESS TESTS ====================

  describe('POST /stories/progress', () => {
    const validProgressBody = {
      kidId: '550e8400-e29b-41d4-a716-446655440000',
      storyId: '550e8400-e29b-41d4-a716-446655440001',
      progress: 50,
    };

    it('should set progress when authenticated with valid data', async () => {
      const res = await authenticatedPost('/api/v1/stories/progress').send(
        validProgressBody,
      );

      expectSuccessResponse(res, 201);
      expect(mockStoryProgressService.setProgress).toHaveBeenCalledWith(
        expect.objectContaining({
          kidId: validProgressBody.kidId,
          storyId: validProgressBody.storyId,
          progress: 50,
        }),
      );
    });

    it('should reject unauthenticated request', async () => {
      const res = await request(server)
        .post('/api/v1/stories/progress')
        .send(validProgressBody);

      expectErrorResponse(res, 401, 'Unauthorized');
    });

    it('should reject progress value above 100', async () => {
      const res = await authenticatedPost('/api/v1/stories/progress').send({
        ...validProgressBody,
        progress: 150,
      });

      expectErrorResponse(res, 400, 'Bad Request');
    });

    it('should reject progress value below 0', async () => {
      const res = await authenticatedPost('/api/v1/stories/progress').send({
        ...validProgressBody,
        progress: -5,
      });

      expectErrorResponse(res, 400, 'Bad Request');
    });

    it('should reject request with non-UUID kidId', async () => {
      const res = await authenticatedPost('/api/v1/stories/progress').send({
        kidId: 'not-a-uuid',
        storyId: '550e8400-e29b-41d4-a716-446655440001',
        progress: 50,
      });

      expectErrorResponse(res, 400, 'Bad Request');
    });
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { ProgressService } from './progress.service';
import { StreakService } from './streak.service';
import { BadgeService } from './badge.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  CACHE_KEYS,
  CACHE_TTL_MS,
} from '@/shared/constants/cache-keys.constants';

const mockCacheManager = {
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
};

const mockStreakService = {
  getStreakSummary: jest.fn(),
};

const mockBadgeService = {
  getBadgePreview: jest.fn(),
};

const mockPrismaService = {
  kid: {
    findMany: jest.fn(),
  },
  storyProgress: {
    count: jest.fn(),
  },
  dailyChallengeAssignment: {
    count: jest.fn(),
  },
  screenTimeSession: {
    aggregate: jest.fn(),
  },
};

// --- Test fixtures ---

const TEST_USER_ID = 'user-123';

const mockStreakData = {
  currentStreak: 5,
  longestStreak: 10,
  lastActiveDate: '2026-02-23',
};

const mockBadgePreviewData = [
  { id: 'badge-1', name: 'First Story', iconUrl: 'https://example.com/badge1.png', earned: true },
  { id: 'badge-2', name: 'Bookworm', iconUrl: 'https://example.com/badge2.png', earned: false },
];

const mockKids = [
  { id: 'kid-1' },
  { id: 'kid-2' },
];

const mockProgressStats = {
  storiesCompleted: 12,
  challengesCompleted: 8,
  totalReadingTimeMins: 45,
};

const mockHomeScreenData = {
  streak: mockStreakData,
  badgesPreview: mockBadgePreviewData,
  progressStats: mockProgressStats,
};

const mockOverviewData = {
  streak: mockStreakData,
  badgesPreview: mockBadgePreviewData,
  storiesCompleted: 12,
  challengesCompleted: 8,
};

describe('ProgressService', () => {
  let service: ProgressService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProgressService,
        { provide: CACHE_MANAGER, useValue: mockCacheManager },
        { provide: StreakService, useValue: mockStreakService },
        { provide: BadgeService, useValue: mockBadgeService },
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<ProgressService>(ProgressService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ---------- getHomeScreenData ----------

  describe('getHomeScreenData', () => {
    it('should return cached data when cache hit occurs', async () => {
      mockCacheManager.get.mockResolvedValue(mockHomeScreenData);

      const result = await service.getHomeScreenData(TEST_USER_ID);

      expect(result).toEqual(mockHomeScreenData);
      expect(mockCacheManager.get).toHaveBeenCalledWith(
        CACHE_KEYS.PROGRESS_HOME(TEST_USER_ID),
      );
      expect(mockStreakService.getStreakSummary).not.toHaveBeenCalled();
      expect(mockBadgeService.getBadgePreview).not.toHaveBeenCalled();
    });

    it('should fetch fresh data on cache miss, cache it, and return it', async () => {
      mockCacheManager.get.mockResolvedValue(null);
      mockStreakService.getStreakSummary.mockResolvedValue(mockStreakData);
      mockBadgeService.getBadgePreview.mockResolvedValue(mockBadgePreviewData);
      mockPrismaService.kid.findMany.mockResolvedValue(mockKids);
      mockPrismaService.storyProgress.count.mockResolvedValue(12);
      mockPrismaService.dailyChallengeAssignment.count.mockResolvedValue(8);
      mockPrismaService.screenTimeSession.aggregate.mockResolvedValue({
        _sum: { duration: 2700 }, // 2700 seconds = 45 minutes
      });

      const result = await service.getHomeScreenData(TEST_USER_ID);

      expect(result).toEqual(mockHomeScreenData);
      expect(mockStreakService.getStreakSummary).toHaveBeenCalledWith(TEST_USER_ID);
      expect(mockBadgeService.getBadgePreview).toHaveBeenCalledWith(TEST_USER_ID);
      expect(mockCacheManager.set).toHaveBeenCalledWith(
        CACHE_KEYS.PROGRESS_HOME(TEST_USER_ID),
        mockHomeScreenData,
        CACHE_TTL_MS.USER_DATA,
      );
    });

    it('should throw when a dependency service throws', async () => {
      mockCacheManager.get.mockResolvedValue(null);
      mockStreakService.getStreakSummary.mockRejectedValue(
        new Error('Streak service unavailable'),
      );
      mockBadgeService.getBadgePreview.mockResolvedValue(mockBadgePreviewData);
      mockPrismaService.kid.findMany.mockResolvedValue(mockKids);
      mockPrismaService.storyProgress.count.mockResolvedValue(0);
      mockPrismaService.dailyChallengeAssignment.count.mockResolvedValue(0);
      mockPrismaService.screenTimeSession.aggregate.mockResolvedValue({
        _sum: { duration: null },
      });

      await expect(service.getHomeScreenData(TEST_USER_ID)).rejects.toThrow(
        'Streak service unavailable',
      );
    });
  });

  // ---------- getOverview ----------

  describe('getOverview', () => {
    it('should return cached data when cache hit occurs', async () => {
      mockCacheManager.get.mockResolvedValue(mockOverviewData);

      const result = await service.getOverview(TEST_USER_ID);

      expect(result).toEqual(mockOverviewData);
      expect(mockCacheManager.get).toHaveBeenCalledWith(
        CACHE_KEYS.PROGRESS_OVERVIEW(TEST_USER_ID),
      );
      expect(mockStreakService.getStreakSummary).not.toHaveBeenCalled();
      expect(mockBadgeService.getBadgePreview).not.toHaveBeenCalled();
    });

    it('should fetch fresh data on cache miss, cache it, and return it', async () => {
      mockCacheManager.get.mockResolvedValue(null);
      mockStreakService.getStreakSummary.mockResolvedValue(mockStreakData);
      mockBadgeService.getBadgePreview.mockResolvedValue(mockBadgePreviewData);
      mockPrismaService.kid.findMany.mockResolvedValue(mockKids);
      mockPrismaService.storyProgress.count.mockResolvedValue(12);
      mockPrismaService.dailyChallengeAssignment.count.mockResolvedValue(8);
      mockPrismaService.screenTimeSession.aggregate.mockResolvedValue({
        _sum: { duration: 2700 },
      });

      const result = await service.getOverview(TEST_USER_ID);

      expect(result).toEqual(mockOverviewData);
      expect(mockStreakService.getStreakSummary).toHaveBeenCalledWith(TEST_USER_ID);
      expect(mockBadgeService.getBadgePreview).toHaveBeenCalledWith(TEST_USER_ID);
      expect(mockCacheManager.set).toHaveBeenCalledWith(
        CACHE_KEYS.PROGRESS_OVERVIEW(TEST_USER_ID),
        mockOverviewData,
        CACHE_TTL_MS.USER_DATA,
      );
    });

    it('should flatten stats into top-level storiesCompleted and challengesCompleted', async () => {
      mockCacheManager.get.mockResolvedValue(null);
      mockStreakService.getStreakSummary.mockResolvedValue(mockStreakData);
      mockBadgeService.getBadgePreview.mockResolvedValue(mockBadgePreviewData);
      mockPrismaService.kid.findMany.mockResolvedValue(mockKids);
      mockPrismaService.storyProgress.count.mockResolvedValue(25);
      mockPrismaService.dailyChallengeAssignment.count.mockResolvedValue(15);
      mockPrismaService.screenTimeSession.aggregate.mockResolvedValue({
        _sum: { duration: 600 },
      });

      const result = await service.getOverview(TEST_USER_ID);

      expect(result.storiesCompleted).toBe(25);
      expect(result.challengesCompleted).toBe(15);
      // progressStats should not exist on overview
      expect((result as any).progressStats).toBeUndefined();
    });

    it('should throw when a dependency service throws', async () => {
      mockCacheManager.get.mockResolvedValue(null);
      mockStreakService.getStreakSummary.mockResolvedValue(mockStreakData);
      mockBadgeService.getBadgePreview.mockRejectedValue(
        new Error('Badge service down'),
      );
      mockPrismaService.kid.findMany.mockResolvedValue([]);
      mockPrismaService.storyProgress.count.mockResolvedValue(0);
      mockPrismaService.dailyChallengeAssignment.count.mockResolvedValue(0);
      mockPrismaService.screenTimeSession.aggregate.mockResolvedValue({
        _sum: { duration: null },
      });

      await expect(service.getOverview(TEST_USER_ID)).rejects.toThrow(
        'Badge service down',
      );
    });
  });

  // ---------- invalidateCache ----------

  describe('invalidateCache', () => {
    it('should delete both home and overview cache keys', async () => {
      mockCacheManager.del.mockResolvedValue(undefined);

      await service.invalidateCache(TEST_USER_ID);

      expect(mockCacheManager.del).toHaveBeenCalledTimes(2);
      expect(mockCacheManager.del).toHaveBeenCalledWith(
        `progress:home:${TEST_USER_ID}`,
      );
      expect(mockCacheManager.del).toHaveBeenCalledWith(
        `progress:overview:${TEST_USER_ID}`,
      );
    });

    it('should use the correct user-specific cache keys', async () => {
      mockCacheManager.del.mockResolvedValue(undefined);

      const otherUserId = 'user-456';
      await service.invalidateCache(otherUserId);

      expect(mockCacheManager.del).toHaveBeenCalledWith(
        `progress:home:${otherUserId}`,
      );
      expect(mockCacheManager.del).toHaveBeenCalledWith(
        `progress:overview:${otherUserId}`,
      );
    });
  });

  // ---------- getProgressStats (tested indirectly via public methods) ----------

  describe('getProgressStats (via getHomeScreenData)', () => {
    beforeEach(() => {
      mockCacheManager.get.mockResolvedValue(null);
      mockStreakService.getStreakSummary.mockResolvedValue(mockStreakData);
      mockBadgeService.getBadgePreview.mockResolvedValue(mockBadgePreviewData);
    });

    it('should query kids by parentId and aggregate stats', async () => {
      mockPrismaService.kid.findMany.mockResolvedValue(mockKids);
      mockPrismaService.storyProgress.count.mockResolvedValue(5);
      mockPrismaService.dailyChallengeAssignment.count.mockResolvedValue(3);
      mockPrismaService.screenTimeSession.aggregate.mockResolvedValue({
        _sum: { duration: 1800 },
      });

      const result = await service.getHomeScreenData(TEST_USER_ID);

      expect(mockPrismaService.kid.findMany).toHaveBeenCalledWith({
        where: { parentId: TEST_USER_ID },
        select: { id: true },
      });
      expect(mockPrismaService.storyProgress.count).toHaveBeenCalledWith({
        where: {
          kidId: { in: ['kid-1', 'kid-2'] },
          completed: true,
        },
      });
      expect(mockPrismaService.dailyChallengeAssignment.count).toHaveBeenCalledWith({
        where: {
          kidId: { in: ['kid-1', 'kid-2'] },
          completed: true,
        },
      });
      expect(mockPrismaService.screenTimeSession.aggregate).toHaveBeenCalledWith({
        where: {
          kidId: { in: ['kid-1', 'kid-2'] },
          endTime: { not: null },
        },
        _sum: { duration: true },
      });
      expect(result.progressStats).toEqual({
        storiesCompleted: 5,
        challengesCompleted: 3,
        totalReadingTimeMins: 30, // 1800 / 60
      });
    });

    it('should handle null duration sum gracefully (0 minutes)', async () => {
      mockPrismaService.kid.findMany.mockResolvedValue(mockKids);
      mockPrismaService.storyProgress.count.mockResolvedValue(0);
      mockPrismaService.dailyChallengeAssignment.count.mockResolvedValue(0);
      mockPrismaService.screenTimeSession.aggregate.mockResolvedValue({
        _sum: { duration: null },
      });

      const result = await service.getHomeScreenData(TEST_USER_ID);

      expect(result.progressStats.totalReadingTimeMins).toBe(0);
    });

    it('should floor reading time minutes (not round)', async () => {
      mockPrismaService.kid.findMany.mockResolvedValue(mockKids);
      mockPrismaService.storyProgress.count.mockResolvedValue(1);
      mockPrismaService.dailyChallengeAssignment.count.mockResolvedValue(0);
      mockPrismaService.screenTimeSession.aggregate.mockResolvedValue({
        _sum: { duration: 150 }, // 150 seconds = 2.5 minutes -> floors to 2
      });

      const result = await service.getHomeScreenData(TEST_USER_ID);

      expect(result.progressStats.totalReadingTimeMins).toBe(2);
    });

    it('should handle user with no kids', async () => {
      mockPrismaService.kid.findMany.mockResolvedValue([]);
      mockPrismaService.storyProgress.count.mockResolvedValue(0);
      mockPrismaService.dailyChallengeAssignment.count.mockResolvedValue(0);
      mockPrismaService.screenTimeSession.aggregate.mockResolvedValue({
        _sum: { duration: null },
      });

      const result = await service.getHomeScreenData(TEST_USER_ID);

      expect(result.progressStats).toEqual({
        storiesCompleted: 0,
        challengesCompleted: 0,
        totalReadingTimeMins: 0,
      });
    });

    it('should return default stats {0,0,0} when prisma throws', async () => {
      mockPrismaService.kid.findMany.mockRejectedValue(
        new Error('Database connection lost'),
      );

      const result = await service.getHomeScreenData(TEST_USER_ID);

      expect(result.progressStats).toEqual({
        storiesCompleted: 0,
        challengesCompleted: 0,
        totalReadingTimeMins: 0,
      });
    });
  });
});

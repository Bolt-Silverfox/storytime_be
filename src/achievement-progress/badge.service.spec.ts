import { Test, TestingModule } from '@nestjs/testing';
import { BadgeService } from './badge.service';
import { PrismaService } from '../prisma/prisma.service';
import { BadgeConstants } from './badge.constants';
import { EventEmitter2 } from '@nestjs/event-emitter';

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

const mockPrismaService = {
  badge: {
    findMany: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
  },
  userBadge: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  kid: {
    findMany: jest.fn(),
  },
  $transaction: jest.fn(),
};

const mockBadgeConstants = {
  CATALOG: [
    {
      title: 'First Story',
      description: 'Read your first story',
      iconUrl: 'https://cdn.storytime.com/badges/first-story.png',
      unlockCondition: 'Read 1 story',
      badgeType: 'count',
      requiredAmount: 1,
      priority: 10,
      metadata: { eventType: 'story_read' },
    },
    {
      title: 'Story Explorer',
      description: 'Read 10 stories',
      iconUrl: 'https://cdn.storytime.com/badges/story-explorer.png',
      unlockCondition: 'Read 10 stories',
      badgeType: 'count',
      requiredAmount: 10,
      priority: 20,
      metadata: { eventType: 'story_read' },
    },
    {
      title: 'Quiz Whiz',
      description: 'Answer 20 quiz questions correctly',
      iconUrl: 'https://cdn.storytime.com/badges/quiz-whiz.png',
      unlockCondition: '20 correct answers',
      badgeType: 'count',
      requiredAmount: 20,
      priority: 20,
      metadata: { eventType: 'quiz_answered', correctOnly: true },
    },
  ],
  BADGE_DEFS_BY_TYPE: {
    story_read: [
      {
        title: 'First Story',
        description: 'Read your first story',
        iconUrl: 'https://cdn.storytime.com/badges/first-story.png',
        unlockCondition: 'Read 1 story',
        badgeType: 'count',
        requiredAmount: 1,
        priority: 10,
        metadata: { eventType: 'story_read' },
      },
      {
        title: 'Story Explorer',
        description: 'Read 10 stories',
        iconUrl: 'https://cdn.storytime.com/badges/story-explorer.png',
        unlockCondition: 'Read 10 stories',
        badgeType: 'count',
        requiredAmount: 10,
        priority: 20,
        metadata: { eventType: 'story_read' },
      },
    ],
    quiz_answered: [
      {
        title: 'Quiz Whiz',
        description: 'Answer 20 quiz questions correctly',
        iconUrl: 'https://cdn.storytime.com/badges/quiz-whiz.png',
        unlockCondition: '20 correct answers',
        badgeType: 'count',
        requiredAmount: 20,
        priority: 20,
        metadata: { eventType: 'quiz_answered', correctOnly: true },
      },
    ],
  },
};

const mockEventEmitter = {
  emit: jest.fn(),
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBadge(overrides: Record<string, unknown> = {}) {
  return {
    id: 'badge-1',
    title: 'First Story',
    description: 'Read your first story',
    iconUrl: 'https://cdn.storytime.com/badges/first-story.png',
    unlockCondition: 'Read 1 story',
    badgeType: 'count',
    requiredAmount: 1,
    priority: 10,
    metadata: { eventType: 'story_read' },
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
    ...overrides,
  };
}

function makeUserBadge(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ub-1',
    userId: 'user-1',
    kidId: null,
    badgeId: 'badge-1',
    count: 0,
    unlocked: false,
    unlockedAt: null,
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
    badge: makeBadge(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BadgeService', () => {
  let service: BadgeService;
  let prisma: jest.Mocked<typeof mockPrismaService>;
  let eventEmitter: jest.Mocked<typeof mockEventEmitter>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BadgeService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: BadgeConstants, useValue: mockBadgeConstants },
        { provide: EventEmitter2, useValue: mockEventEmitter },
      ],
    }).compile();

    service = module.get<BadgeService>(BadgeService);
    prisma = module.get(PrismaService);
    eventEmitter = module.get(EventEmitter2);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // -----------------------------------------------------------------------
  // initializeUserBadges
  // -----------------------------------------------------------------------

  describe('initializeUserBadges', () => {
    const userId = 'user-1';

    it('should return early when no badges exist in catalog', async () => {
      prisma.badge.findMany.mockResolvedValue([]);

      await service.initializeUserBadges(userId);

      expect(prisma.badge.findMany).toHaveBeenCalled();
      expect(prisma.kid.findMany).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('should create parent-level userBadge records when user has no kids', async () => {
      const badges = [makeBadge(), makeBadge({ id: 'badge-2', title: 'Story Explorer' })];
      prisma.badge.findMany.mockResolvedValue(badges);
      prisma.kid.findMany.mockResolvedValue([]);
      prisma.userBadge.create.mockResolvedValue(makeUserBadge());
      prisma.$transaction.mockResolvedValue([]);

      await service.initializeUserBadges(userId);

      expect(prisma.kid.findMany).toHaveBeenCalledWith({
        where: { parentId: userId },
        select: { id: true },
      });
      // 2 badges, 0 kids = 2 parent-level create operations
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      const txOps = prisma.$transaction.mock.calls[0][0];
      expect(txOps).toHaveLength(2);
    });

    it('should create parent-level + per-kid userBadge records', async () => {
      const badges = [makeBadge()];
      const kids = [{ id: 'kid-1' }, { id: 'kid-2' }];
      prisma.badge.findMany.mockResolvedValue(badges);
      prisma.kid.findMany.mockResolvedValue(kids);
      prisma.userBadge.create.mockResolvedValue(makeUserBadge());
      prisma.$transaction.mockResolvedValue([]);

      await service.initializeUserBadges(userId);

      // 1 badge * (1 parent + 2 kids) = 3 create operations
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      const txOps = prisma.$transaction.mock.calls[0][0];
      expect(txOps).toHaveLength(3);
    });

    it('should create correct number of records for multiple badges and kids', async () => {
      const badges = [
        makeBadge({ id: 'badge-1' }),
        makeBadge({ id: 'badge-2', title: 'Story Explorer' }),
      ];
      const kids = [{ id: 'kid-1' }, { id: 'kid-2' }, { id: 'kid-3' }];
      prisma.badge.findMany.mockResolvedValue(badges);
      prisma.kid.findMany.mockResolvedValue(kids);
      prisma.userBadge.create.mockResolvedValue(makeUserBadge());
      prisma.$transaction.mockResolvedValue([]);

      await service.initializeUserBadges(userId);

      // 2 badges * (1 parent + 3 kids) = 8 create operations
      const txOps = prisma.$transaction.mock.calls[0][0];
      expect(txOps).toHaveLength(8);
    });
  });

  // -----------------------------------------------------------------------
  // getBadgePreview
  // -----------------------------------------------------------------------

  describe('getBadgePreview', () => {
    const userId = 'user-1';

    it('should return top 3 badge previews', async () => {
      const userBadges = [
        makeUserBadge({ id: 'ub-1', unlocked: true, count: 1 }),
        makeUserBadge({ id: 'ub-2', unlocked: true, count: 5, badge: makeBadge({ id: 'badge-2', title: 'Story Explorer' }) }),
        makeUserBadge({ id: 'ub-3', unlocked: false, count: 0, badge: makeBadge({ id: 'badge-3', title: 'Story Master' }) }),
      ];
      prisma.userBadge.findMany.mockResolvedValue(userBadges);

      const result = await service.getBadgePreview(userId);

      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({
        badgeId: 'badge-1',
        title: 'First Story',
        iconUrl: 'https://cdn.storytime.com/badges/first-story.png',
        locked: false,
        count: 1,
      });
      expect(prisma.userBadge.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId, kidId: null },
          take: 3,
        }),
      );
    });

    it('should fill remaining slots with locked badges when fewer than 3 are found', async () => {
      const firstBatch = [
        makeUserBadge({ id: 'ub-1', unlocked: true, count: 1 }),
      ];
      const remaining = [
        makeUserBadge({ id: 'ub-2', unlocked: false, count: 0, badge: makeBadge({ id: 'badge-2', title: 'Story Explorer' }) }),
        makeUserBadge({ id: 'ub-3', unlocked: false, count: 0, badge: makeBadge({ id: 'badge-3', title: 'Story Master' }) }),
      ];
      prisma.userBadge.findMany
        .mockResolvedValueOnce(firstBatch)
        .mockResolvedValueOnce(remaining);

      const result = await service.getBadgePreview(userId);

      expect(result).toHaveLength(3);
      // Second query should ask for 2 more (3 - 1)
      expect(prisma.userBadge.findMany).toHaveBeenCalledTimes(2);
      const secondCall = prisma.userBadge.findMany.mock.calls[1][0];
      expect(secondCall.take).toBe(2);
    });

    it('should pass kidId in where clause when provided', async () => {
      prisma.userBadge.findMany.mockResolvedValue([
        makeUserBadge({ id: 'ub-1', kidId: 'kid-1' }),
        makeUserBadge({ id: 'ub-2', kidId: 'kid-1' }),
        makeUserBadge({ id: 'ub-3', kidId: 'kid-1' }),
      ]);

      await service.getBadgePreview(userId, 'kid-1');

      expect(prisma.userBadge.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId, kidId: 'kid-1' },
        }),
      );
    });

    it('should return empty array on error', async () => {
      prisma.userBadge.findMany.mockRejectedValue(new Error('DB failure'));

      const result = await service.getBadgePreview(userId);

      expect(result).toEqual([]);
    });

    it('should return empty array when no badges exist at all', async () => {
      prisma.userBadge.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const result = await service.getBadgePreview(userId);

      expect(result).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // getFullBadgeList
  // -----------------------------------------------------------------------

  describe('getFullBadgeList', () => {
    const userId = 'user-1';

    it('should return all user badges mapped to BadgeDetailDto', async () => {
      const badge = makeBadge();
      const userBadges = [
        makeUserBadge({
          id: 'ub-1',
          unlocked: true,
          count: 1,
          unlockedAt: new Date('2025-06-01'),
          badge,
        }),
        makeUserBadge({
          id: 'ub-2',
          unlocked: false,
          count: 3,
          badge: makeBadge({ id: 'badge-2', title: 'Story Explorer', description: 'Read 10 stories', requiredAmount: 10 }),
        }),
      ];
      prisma.userBadge.findMany.mockResolvedValue(userBadges);

      const result = await service.getFullBadgeList(userId);

      expect(result.badges).toHaveLength(2);
      expect(result.badges[0]).toEqual({
        badgeId: badge.id,
        title: badge.title,
        description: badge.description,
        iconUrl: badge.iconUrl,
        locked: false,
        count: 1,
        unlockCondition: badge.unlockCondition,
        unlockedAt: new Date('2025-06-01'),
      });
      expect(result.badges[1].locked).toBe(true);
    });

    it('should set kidId to null when kidId is not provided', async () => {
      prisma.userBadge.findMany.mockResolvedValue([]);

      await service.getFullBadgeList(userId);

      expect(prisma.userBadge.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId, kidId: null },
        }),
      );
    });

    it('should use kidId when provided', async () => {
      prisma.userBadge.findMany.mockResolvedValue([]);

      await service.getFullBadgeList(userId, 'kid-1');

      expect(prisma.userBadge.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId, kidId: 'kid-1' },
        }),
      );
    });

    it('should return empty badges array when user has no badges', async () => {
      prisma.userBadge.findMany.mockResolvedValue([]);

      const result = await service.getFullBadgeList(userId);

      expect(result).toEqual({ badges: [] });
    });
  });

  // -----------------------------------------------------------------------
  // getUserBadge
  // -----------------------------------------------------------------------

  describe('getUserBadge', () => {
    const userId = 'user-1';
    const badgeId = 'badge-1';

    it('should find a user badge by compound key without kidId', async () => {
      const expected = makeUserBadge();
      prisma.userBadge.findUnique.mockResolvedValue(expected);

      const result = await service.getUserBadge(userId, badgeId);

      expect(result).toEqual(expected);
      expect(prisma.userBadge.findUnique).toHaveBeenCalledWith({
        where: {
          userId_kidId_badgeId: {
            userId,
            kidId: null,
            badgeId,
          },
        },
        include: { badge: true },
      });
    });

    it('should find a user badge by compound key with kidId', async () => {
      const expected = makeUserBadge({ kidId: 'kid-1' });
      prisma.userBadge.findUnique.mockResolvedValue(expected);

      const result = await service.getUserBadge(userId, badgeId, 'kid-1');

      expect(result).toEqual(expected);
      expect(prisma.userBadge.findUnique).toHaveBeenCalledWith({
        where: {
          userId_kidId_badgeId: {
            userId,
            kidId: 'kid-1',
            badgeId,
          },
        },
        include: { badge: true },
      });
    });

    it('should return null when no matching user badge exists', async () => {
      prisma.userBadge.findUnique.mockResolvedValue(null);

      const result = await service.getUserBadge(userId, 'nonexistent-badge');

      expect(result).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // updateBadgeProgress
  // -----------------------------------------------------------------------

  describe('updateBadgeProgress', () => {
    const userId = 'user-1';

    it('should return early when no badge defs exist for the given type', async () => {
      await service.updateBadgeProgress(userId, 'nonexistent_type');

      expect(prisma.badge.findMany).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('should increment badge count without unlocking when threshold not met', async () => {
      const badge = makeBadge({ id: 'badge-1', title: 'First Story', requiredAmount: 5 });
      const userBadge = makeUserBadge({ count: 2, unlocked: false });

      prisma.badge.findMany.mockResolvedValue([badge]);

      // The interactive transaction receives a callback
      prisma.$transaction.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => {
        const tx = {
          userBadge: {
            findUnique: jest.fn().mockResolvedValue(userBadge),
            update: jest.fn().mockResolvedValue({ ...userBadge, count: 3 }),
          },
        };
        return cb(tx);
      });

      await service.updateBadgeProgress(userId, 'story_read', 1);

      expect(prisma.badge.findMany).toHaveBeenCalledWith({
        where: { title: { in: ['First Story', 'Story Explorer'] } },
      });
      // Should NOT emit badge.unlocked since threshold not met
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it('should unlock badge and emit event when threshold is met', async () => {
      const badge = makeBadge({ id: 'badge-1', title: 'First Story', requiredAmount: 1 });
      const userBadge = makeUserBadge({ count: 0, unlocked: false });

      prisma.badge.findMany.mockResolvedValue([badge]);

      const txUpdateMock = jest.fn().mockResolvedValue({ ...userBadge, count: 1, unlocked: true });

      prisma.$transaction.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => {
        const tx = {
          userBadge: {
            findUnique: jest.fn().mockResolvedValue(userBadge),
            update: txUpdateMock,
          },
        };
        return cb(tx);
      });

      await service.updateBadgeProgress(userId, 'story_read', 1);

      expect(txUpdateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            count: 1,
            unlocked: true,
          }),
        }),
      );
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'badge.unlocked',
        expect.objectContaining({
          userId,
          kidId: null,
          badgeId: badge.id,
        }),
      );
    });

    it('should skip badge that is already unlocked', async () => {
      const badge = makeBadge({ id: 'badge-1', title: 'First Story', requiredAmount: 1 });
      const userBadge = makeUserBadge({ count: 1, unlocked: true });

      prisma.badge.findMany.mockResolvedValue([badge]);

      const txUpdateMock = jest.fn();

      prisma.$transaction.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => {
        const tx = {
          userBadge: {
            findUnique: jest.fn().mockResolvedValue(userBadge),
            update: txUpdateMock,
          },
        };
        return cb(tx);
      });

      await service.updateBadgeProgress(userId, 'story_read', 1);

      expect(txUpdateMock).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it('should skip when userBadge record is not found in transaction', async () => {
      const badge = makeBadge({ id: 'badge-1', title: 'First Story', requiredAmount: 1 });

      prisma.badge.findMany.mockResolvedValue([badge]);

      const txUpdateMock = jest.fn();

      prisma.$transaction.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => {
        const tx = {
          userBadge: {
            findUnique: jest.fn().mockResolvedValue(null),
            update: txUpdateMock,
          },
        };
        return cb(tx);
      });

      await service.updateBadgeProgress(userId, 'story_read', 1);

      expect(txUpdateMock).not.toHaveBeenCalled();
    });

    it('should pass kidId into the composite key when provided', async () => {
      const badge = makeBadge({ id: 'badge-1', title: 'First Story', requiredAmount: 5 });
      const userBadge = makeUserBadge({ count: 0, unlocked: false, kidId: 'kid-1' });

      prisma.badge.findMany.mockResolvedValue([badge]);

      const txFindUniqueMock = jest.fn().mockResolvedValue(userBadge);

      prisma.$transaction.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => {
        const tx = {
          userBadge: {
            findUnique: txFindUniqueMock,
            update: jest.fn().mockResolvedValue({ ...userBadge, count: 1 }),
          },
        };
        return cb(tx);
      });

      await service.updateBadgeProgress(userId, 'story_read', 1, undefined, 'kid-1');

      expect(txFindUniqueMock).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            userId_kidId_badgeId: {
              userId,
              kidId: 'kid-1',
              badgeId: badge.id,
            },
          },
        }),
      );
    });

    it('should skip quiz badge when correctOnly is set and isCorrect is false', async () => {
      const quizBadge = makeBadge({
        id: 'badge-quiz',
        title: 'Quiz Whiz',
        requiredAmount: 20,
        badgeType: 'count',
        metadata: { eventType: 'quiz_answered', correctOnly: true },
      });

      prisma.badge.findMany.mockResolvedValue([quizBadge]);

      await service.updateBadgeProgress(userId, 'quiz_answered', 1, { isCorrect: false });

      // Transaction should not be called because the badge should be skipped
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('should process quiz badge when isCorrect is true', async () => {
      const quizBadge = makeBadge({
        id: 'badge-quiz',
        title: 'Quiz Whiz',
        requiredAmount: 20,
        badgeType: 'count',
        metadata: { eventType: 'quiz_answered', correctOnly: true },
      });
      const userBadge = makeUserBadge({ badgeId: 'badge-quiz', count: 0 });

      prisma.badge.findMany.mockResolvedValue([quizBadge]);

      const txUpdateMock = jest.fn().mockResolvedValue({ ...userBadge, count: 1 });

      prisma.$transaction.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => {
        const tx = {
          userBadge: {
            findUnique: jest.fn().mockResolvedValue(userBadge),
            update: txUpdateMock,
          },
        };
        return cb(tx);
      });

      await service.updateBadgeProgress(userId, 'quiz_answered', 1, { isCorrect: true });

      expect(txUpdateMock).toHaveBeenCalled();
    });

    it('should use default increment of 1 when not specified', async () => {
      const badge = makeBadge({ id: 'badge-1', title: 'First Story', requiredAmount: 5 });
      const userBadge = makeUserBadge({ count: 2, unlocked: false });

      prisma.badge.findMany.mockResolvedValue([badge]);

      const txUpdateMock = jest.fn().mockResolvedValue({ ...userBadge, count: 3 });

      prisma.$transaction.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => {
        const tx = {
          userBadge: {
            findUnique: jest.fn().mockResolvedValue(userBadge),
            update: txUpdateMock,
          },
        };
        return cb(tx);
      });

      await service.updateBadgeProgress(userId, 'story_read');

      expect(txUpdateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            count: 3, // 2 + 1 default increment
          }),
        }),
      );
    });

    it('should handle custom increment values', async () => {
      const badge = makeBadge({ id: 'badge-1', title: 'First Story', requiredAmount: 10 });
      const userBadge = makeUserBadge({ count: 3, unlocked: false });

      prisma.badge.findMany.mockResolvedValue([badge]);

      const txUpdateMock = jest.fn().mockResolvedValue({ ...userBadge, count: 8 });

      prisma.$transaction.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => {
        const tx = {
          userBadge: {
            findUnique: jest.fn().mockResolvedValue(userBadge),
            update: txUpdateMock,
          },
        };
        return cb(tx);
      });

      await service.updateBadgeProgress(userId, 'story_read', 5);

      expect(txUpdateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            count: 8, // 3 + 5
          }),
        }),
      );
    });

    it('should continue processing when a badge title is not found in DB', async () => {
      // Only return one badge from DB but there are two defs for story_read
      const badge = makeBadge({ id: 'badge-1', title: 'First Story', requiredAmount: 5 });
      const userBadge = makeUserBadge({ count: 0, unlocked: false });

      prisma.badge.findMany.mockResolvedValue([badge]);

      const txUpdateMock = jest.fn().mockResolvedValue({ ...userBadge, count: 1 });

      prisma.$transaction.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => {
        const tx = {
          userBadge: {
            findUnique: jest.fn().mockResolvedValue(userBadge),
            update: txUpdateMock,
          },
        };
        return cb(tx);
      });

      await service.updateBadgeProgress(userId, 'story_read', 1);

      // Should still process the badge that was found
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });
  });

  // -----------------------------------------------------------------------
  // seedBadges
  // -----------------------------------------------------------------------

  describe('seedBadges', () => {
    it('should skip seeding when badges already exist', async () => {
      prisma.badge.count.mockResolvedValue(5);

      await service.seedBadges();

      expect(prisma.badge.count).toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('should seed badges when none exist', async () => {
      prisma.badge.count.mockResolvedValue(0);
      prisma.badge.create.mockResolvedValue(makeBadge());
      prisma.$transaction.mockResolvedValue([]);

      await service.seedBadges();

      expect(prisma.badge.count).toHaveBeenCalled();
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      const txOps = prisma.$transaction.mock.calls[0][0];
      expect(txOps).toHaveLength(mockBadgeConstants.CATALOG.length);
    });

    it('should create badge records with correct data from CATALOG', async () => {
      prisma.badge.count.mockResolvedValue(0);
      prisma.badge.create.mockResolvedValue(makeBadge());
      prisma.$transaction.mockResolvedValue([]);

      await service.seedBadges();

      // Verify prisma.badge.create was called via the transaction with catalog data
      expect(prisma.badge.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          title: 'First Story',
          description: 'Read your first story',
          badgeType: 'count',
          requiredAmount: 1,
          priority: 10,
        }),
      });
    });
  });

  // -----------------------------------------------------------------------
  // shouldSkipBadge (tested indirectly via updateBadgeProgress)
  // -----------------------------------------------------------------------

  describe('shouldSkipBadge (private, tested via updateBadgeProgress)', () => {
    const userId = 'user-1';

    it('should skip special badge with before_7am constraint when hour >= 7', async () => {
      // Mock Date to return 10 AM
      jest.spyOn(Date.prototype, 'getHours').mockReturnValue(10);

      const earlyBirdDef = {
        title: 'Early Bird',
        description: 'Read a story before 7 AM',
        badgeType: 'special',
        requiredAmount: 1,
        priority: 15,
        metadata: { eventType: 'early_special', timeConstraint: 'before_7am' },
      };

      // Temporarily override BADGE_DEFS_BY_TYPE
      const originalDefs = mockBadgeConstants.BADGE_DEFS_BY_TYPE;
      (mockBadgeConstants as Record<string, unknown>).BADGE_DEFS_BY_TYPE = {
        ...originalDefs,
        early_special: [earlyBirdDef],
      };

      const earlyBadge = makeBadge({ id: 'badge-early', title: 'Early Bird', badgeType: 'special', requiredAmount: 1 });
      prisma.badge.findMany.mockResolvedValue([earlyBadge]);

      await service.updateBadgeProgress(userId, 'early_special', 1);

      // Badge should be skipped - no transaction
      expect(prisma.$transaction).not.toHaveBeenCalled();

      // Restore
      (mockBadgeConstants as Record<string, unknown>).BADGE_DEFS_BY_TYPE = originalDefs;
      jest.restoreAllMocks();
    });

    it('should skip special badge with after_9pm constraint when hour < 21', async () => {
      jest.spyOn(Date.prototype, 'getHours').mockReturnValue(14);

      const nightOwlDef = {
        title: 'Night Owl',
        description: 'Read a story after 9 PM',
        badgeType: 'special',
        requiredAmount: 1,
        priority: 15,
        metadata: { eventType: 'night_special', timeConstraint: 'after_9pm' },
      };

      const originalDefs = mockBadgeConstants.BADGE_DEFS_BY_TYPE;
      (mockBadgeConstants as Record<string, unknown>).BADGE_DEFS_BY_TYPE = {
        ...originalDefs,
        night_special: [nightOwlDef],
      };

      const nightBadge = makeBadge({ id: 'badge-night', title: 'Night Owl', badgeType: 'special', requiredAmount: 1 });
      prisma.badge.findMany.mockResolvedValue([nightBadge]);

      await service.updateBadgeProgress(userId, 'night_special', 1);

      expect(prisma.$transaction).not.toHaveBeenCalled();

      (mockBadgeConstants as Record<string, unknown>).BADGE_DEFS_BY_TYPE = originalDefs;
      jest.restoreAllMocks();
    });

    it('should process special badge with before_7am constraint when hour < 7', async () => {
      jest.spyOn(Date.prototype, 'getHours').mockReturnValue(5);

      const earlyBirdDef = {
        title: 'Early Bird',
        description: 'Read a story before 7 AM',
        badgeType: 'special',
        requiredAmount: 1,
        priority: 15,
        metadata: { eventType: 'early_special', timeConstraint: 'before_7am' },
      };

      const originalDefs = mockBadgeConstants.BADGE_DEFS_BY_TYPE;
      (mockBadgeConstants as Record<string, unknown>).BADGE_DEFS_BY_TYPE = {
        ...originalDefs,
        early_special: [earlyBirdDef],
      };

      const earlyBadge = makeBadge({ id: 'badge-early', title: 'Early Bird', badgeType: 'special', requiredAmount: 1 });
      const userBadge = makeUserBadge({ badgeId: 'badge-early', count: 0, unlocked: false });
      prisma.badge.findMany.mockResolvedValue([earlyBadge]);

      prisma.$transaction.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => {
        const tx = {
          userBadge: {
            findUnique: jest.fn().mockResolvedValue(userBadge),
            update: jest.fn().mockResolvedValue({ ...userBadge, count: 1, unlocked: true }),
          },
        };
        return cb(tx);
      });

      await service.updateBadgeProgress(userId, 'early_special', 1);

      // Badge should be processed - transaction should be called
      expect(prisma.$transaction).toHaveBeenCalled();

      (mockBadgeConstants as Record<string, unknown>).BADGE_DEFS_BY_TYPE = originalDefs;
      jest.restoreAllMocks();
    });
  });
});

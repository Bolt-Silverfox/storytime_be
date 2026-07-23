import { Test, TestingModule } from '@nestjs/testing';
import { BadgeService } from './badge.service';
import { BadgeConstants } from './badge.constants';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  BADGE_REPOSITORY,
  IBadgeRepository,
  USER_BADGE_REPOSITORY,
  IUserBadgeRepository,
  KID_REPOSITORY,
  IKidRepository,
} from './repositories';

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

const mockBadgeRepository: Record<keyof IBadgeRepository, jest.Mock> = {
  findAll: jest.fn(),
  findManyByTitles: jest.fn(),
  count: jest.fn(),
  createBadgesInTransaction: jest.fn(),
};

const mockUserBadgeRepository: Record<keyof IUserBadgeRepository, jest.Mock> = {
  createUserBadgesInTransaction: jest.fn(),
  findPreviewBadges: jest.fn(),
  findRemainingPreviewBadges: jest.fn(),
  findFullBadgeList: jest.fn(),
  findByCompositeKey: jest.fn(),
  findByCompositeKeyForUpdate: jest.fn(),
  updateById: jest.fn(),
  // Execute the transaction callback immediately with a dummy tx client
  executeTransaction: jest.fn((fn) => fn({})),
};

const mockKidRepository: Record<keyof IKidRepository, jest.Mock> = {
  findIdsByParent: jest.fn(),
  findParentIdById: jest.fn(),
  findNameById: jest.fn(),
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
  let badgeRepository: jest.Mocked<typeof mockBadgeRepository>;
  let userBadgeRepository: jest.Mocked<typeof mockUserBadgeRepository>;
  let kidRepository: jest.Mocked<typeof mockKidRepository>;
  let eventEmitter: jest.Mocked<typeof mockEventEmitter>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BadgeService,
        { provide: BADGE_REPOSITORY, useValue: mockBadgeRepository },
        { provide: USER_BADGE_REPOSITORY, useValue: mockUserBadgeRepository },
        { provide: KID_REPOSITORY, useValue: mockKidRepository },
        { provide: BadgeConstants, useValue: mockBadgeConstants },
        { provide: EventEmitter2, useValue: mockEventEmitter },
      ],
    }).compile();

    service = module.get<BadgeService>(BadgeService);
    badgeRepository = module.get(BADGE_REPOSITORY);
    userBadgeRepository = module.get(USER_BADGE_REPOSITORY);
    kidRepository = module.get(KID_REPOSITORY);
    eventEmitter = module.get(EventEmitter2);
    jest.clearAllMocks();
    // Restore the passthrough transaction executor cleared above
    userBadgeRepository.executeTransaction.mockImplementation((fn) => fn({}));
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
      badgeRepository.findAll.mockResolvedValue([]);

      await service.initializeUserBadges(userId);

      expect(badgeRepository.findAll).toHaveBeenCalled();
      expect(kidRepository.findIdsByParent).not.toHaveBeenCalled();
      expect(
        userBadgeRepository.createUserBadgesInTransaction,
      ).not.toHaveBeenCalled();
    });

    it('should create parent-level userBadge records when user has no kids', async () => {
      const badges = [
        makeBadge(),
        makeBadge({ id: 'badge-2', title: 'Story Explorer' }),
      ];
      badgeRepository.findAll.mockResolvedValue(badges);
      kidRepository.findIdsByParent.mockResolvedValue([]);
      userBadgeRepository.createUserBadgesInTransaction.mockResolvedValue([]);

      await service.initializeUserBadges(userId);

      expect(kidRepository.findIdsByParent).toHaveBeenCalledWith(userId);
      // 2 badges, 0 kids = 2 parent-level create operations
      expect(
        userBadgeRepository.createUserBadgesInTransaction,
      ).toHaveBeenCalledTimes(1);
      const txOps =
        userBadgeRepository.createUserBadgesInTransaction.mock.calls[0][0];
      expect(txOps).toHaveLength(2);
    });

    it('should create parent-level + per-kid userBadge records', async () => {
      const badges = [makeBadge()];
      const kids = [{ id: 'kid-1' }, { id: 'kid-2' }];
      badgeRepository.findAll.mockResolvedValue(badges);
      kidRepository.findIdsByParent.mockResolvedValue(kids);
      userBadgeRepository.createUserBadgesInTransaction.mockResolvedValue([]);

      await service.initializeUserBadges(userId);

      // 1 badge * (1 parent + 2 kids) = 3 create operations
      expect(
        userBadgeRepository.createUserBadgesInTransaction,
      ).toHaveBeenCalledTimes(1);
      const txOps =
        userBadgeRepository.createUserBadgesInTransaction.mock.calls[0][0];
      expect(txOps).toHaveLength(3);
    });

    it('should create correct number of records for multiple badges and kids', async () => {
      const badges = [
        makeBadge({ id: 'badge-1' }),
        makeBadge({ id: 'badge-2', title: 'Story Explorer' }),
      ];
      const kids = [{ id: 'kid-1' }, { id: 'kid-2' }, { id: 'kid-3' }];
      badgeRepository.findAll.mockResolvedValue(badges);
      kidRepository.findIdsByParent.mockResolvedValue(kids);
      userBadgeRepository.createUserBadgesInTransaction.mockResolvedValue([]);

      await service.initializeUserBadges(userId);

      // 2 badges * (1 parent + 3 kids) = 8 create operations
      const txOps =
        userBadgeRepository.createUserBadgesInTransaction.mock.calls[0][0];
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
        makeUserBadge({
          id: 'ub-2',
          unlocked: true,
          count: 5,
          badge: makeBadge({ id: 'badge-2', title: 'Story Explorer' }),
        }),
        makeUserBadge({
          id: 'ub-3',
          unlocked: false,
          count: 0,
          badge: makeBadge({ id: 'badge-3', title: 'Story Master' }),
        }),
      ];
      userBadgeRepository.findPreviewBadges.mockResolvedValue(userBadges);

      const result = await service.getBadgePreview(userId);

      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({
        badgeId: 'badge-1',
        title: 'First Story',
        iconUrl: 'https://cdn.storytime.com/badges/first-story.png',
        locked: false,
        count: 1,
      });
      expect(userBadgeRepository.findPreviewBadges).toHaveBeenCalledWith(
        { userId, kidId: null },
        3,
      );
    });

    it('should fill remaining slots with locked badges when fewer than 3 are found', async () => {
      const firstBatch = [
        makeUserBadge({ id: 'ub-1', unlocked: true, count: 1 }),
      ];
      const remaining = [
        makeUserBadge({
          id: 'ub-2',
          unlocked: false,
          count: 0,
          badge: makeBadge({ id: 'badge-2', title: 'Story Explorer' }),
        }),
        makeUserBadge({
          id: 'ub-3',
          unlocked: false,
          count: 0,
          badge: makeBadge({ id: 'badge-3', title: 'Story Master' }),
        }),
      ];
      userBadgeRepository.findPreviewBadges.mockResolvedValue(firstBatch);
      userBadgeRepository.findRemainingPreviewBadges.mockResolvedValue(
        remaining,
      );

      const result = await service.getBadgePreview(userId);

      expect(result).toHaveLength(3);
      // Second query should ask for 2 more (3 - 1)
      expect(userBadgeRepository.findPreviewBadges).toHaveBeenCalledTimes(1);
      expect(
        userBadgeRepository.findRemainingPreviewBadges,
      ).toHaveBeenCalledTimes(1);
      const secondCallTake =
        userBadgeRepository.findRemainingPreviewBadges.mock.calls[0][1];
      expect(secondCallTake).toBe(2);
    });

    it('should pass kidId in where clause when provided', async () => {
      userBadgeRepository.findPreviewBadges.mockResolvedValue([
        makeUserBadge({ id: 'ub-1', kidId: 'kid-1' }),
        makeUserBadge({ id: 'ub-2', kidId: 'kid-1' }),
        makeUserBadge({ id: 'ub-3', kidId: 'kid-1' }),
      ]);

      await service.getBadgePreview(userId, 'kid-1');

      expect(userBadgeRepository.findPreviewBadges).toHaveBeenCalledWith(
        { userId, kidId: 'kid-1' },
        3,
      );
    });

    it('should return empty array on error', async () => {
      userBadgeRepository.findPreviewBadges.mockRejectedValue(
        new Error('DB failure'),
      );

      const result = await service.getBadgePreview(userId);

      expect(result).toEqual([]);
    });

    it('should return empty array when no badges exist at all', async () => {
      userBadgeRepository.findPreviewBadges.mockResolvedValue([]);
      userBadgeRepository.findRemainingPreviewBadges.mockResolvedValue([]);

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
          badge: makeBadge({
            id: 'badge-2',
            title: 'Story Explorer',
            description: 'Read 10 stories',
            requiredAmount: 10,
          }),
        }),
      ];
      userBadgeRepository.findFullBadgeList.mockResolvedValue(userBadges);

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
      userBadgeRepository.findFullBadgeList.mockResolvedValue([]);

      await service.getFullBadgeList(userId);

      expect(userBadgeRepository.findFullBadgeList).toHaveBeenCalledWith({
        userId,
        kidId: null,
      });
    });

    it('should use kidId when provided', async () => {
      userBadgeRepository.findFullBadgeList.mockResolvedValue([]);

      await service.getFullBadgeList(userId, 'kid-1');

      expect(userBadgeRepository.findFullBadgeList).toHaveBeenCalledWith({
        userId,
        kidId: 'kid-1',
      });
    });

    it('should return empty badges array when user has no badges', async () => {
      userBadgeRepository.findFullBadgeList.mockResolvedValue([]);

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
      userBadgeRepository.findByCompositeKey.mockResolvedValue(expected);

      const result = await service.getUserBadge(userId, badgeId);

      expect(result).toEqual(expected);
      expect(userBadgeRepository.findByCompositeKey).toHaveBeenCalledWith(
        userId,
        null,
        badgeId,
      );
    });

    it('should find a user badge by compound key with kidId', async () => {
      const expected = makeUserBadge({ kidId: 'kid-1' });
      userBadgeRepository.findByCompositeKey.mockResolvedValue(expected);

      const result = await service.getUserBadge(userId, badgeId, 'kid-1');

      expect(result).toEqual(expected);
      expect(userBadgeRepository.findByCompositeKey).toHaveBeenCalledWith(
        userId,
        'kid-1',
        badgeId,
      );
    });

    it('should return null when no matching user badge exists', async () => {
      userBadgeRepository.findByCompositeKey.mockResolvedValue(null);

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

      expect(badgeRepository.findManyByTitles).not.toHaveBeenCalled();
      expect(userBadgeRepository.executeTransaction).not.toHaveBeenCalled();
    });

    it('should increment badge count without unlocking when threshold not met', async () => {
      const badge = makeBadge({
        id: 'badge-1',
        title: 'First Story',
        requiredAmount: 5,
      });
      const userBadge = makeUserBadge({ count: 2, unlocked: false });

      badgeRepository.findManyByTitles.mockResolvedValue([badge]);
      userBadgeRepository.findByCompositeKeyForUpdate.mockResolvedValue(
        userBadge,
      );
      userBadgeRepository.updateById.mockResolvedValue({
        ...userBadge,
        count: 3,
      });

      await service.updateBadgeProgress(userId, 'story_read', 1);

      expect(badgeRepository.findManyByTitles).toHaveBeenCalledWith([
        'First Story',
        'Story Explorer',
      ]);
      // Should NOT emit badge.unlocked since threshold not met
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it('should unlock badge and emit event when threshold is met', async () => {
      const badge = makeBadge({
        id: 'badge-1',
        title: 'First Story',
        requiredAmount: 1,
      });
      const userBadge = makeUserBadge({ count: 0, unlocked: false });

      badgeRepository.findManyByTitles.mockResolvedValue([badge]);
      userBadgeRepository.findByCompositeKeyForUpdate.mockResolvedValue(
        userBadge,
      );
      userBadgeRepository.updateById.mockResolvedValue({
        ...userBadge,
        count: 1,
        unlocked: true,
      });

      await service.updateBadgeProgress(userId, 'story_read', 1);

      expect(userBadgeRepository.updateById).toHaveBeenCalledWith(
        userBadge.id,
        expect.objectContaining({
          count: 1,
          unlocked: true,
        }),
        expect.anything(),
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
      const badge = makeBadge({
        id: 'badge-1',
        title: 'First Story',
        requiredAmount: 1,
      });
      const userBadge = makeUserBadge({ count: 1, unlocked: true });

      badgeRepository.findManyByTitles.mockResolvedValue([badge]);
      userBadgeRepository.findByCompositeKeyForUpdate.mockResolvedValue(
        userBadge,
      );

      await service.updateBadgeProgress(userId, 'story_read', 1);

      expect(userBadgeRepository.updateById).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it('should skip when userBadge record is not found in transaction', async () => {
      const badge = makeBadge({
        id: 'badge-1',
        title: 'First Story',
        requiredAmount: 1,
      });

      badgeRepository.findManyByTitles.mockResolvedValue([badge]);
      userBadgeRepository.findByCompositeKeyForUpdate.mockResolvedValue(null);

      await service.updateBadgeProgress(userId, 'story_read', 1);

      expect(userBadgeRepository.updateById).not.toHaveBeenCalled();
    });

    it('should pass kidId into the composite key when provided', async () => {
      const badge = makeBadge({
        id: 'badge-1',
        title: 'First Story',
        requiredAmount: 5,
      });
      const userBadge = makeUserBadge({
        count: 0,
        unlocked: false,
        kidId: 'kid-1',
      });

      badgeRepository.findManyByTitles.mockResolvedValue([badge]);
      userBadgeRepository.findByCompositeKeyForUpdate.mockResolvedValue(
        userBadge,
      );
      userBadgeRepository.updateById.mockResolvedValue({
        ...userBadge,
        count: 1,
      });

      await service.updateBadgeProgress(
        userId,
        'story_read',
        1,
        undefined,
        'kid-1',
      );

      expect(
        userBadgeRepository.findByCompositeKeyForUpdate,
      ).toHaveBeenCalledWith(
        {
          userId,
          kidId: 'kid-1',
          badgeId: badge.id,
        },
        expect.anything(),
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

      badgeRepository.findManyByTitles.mockResolvedValue([quizBadge]);

      await service.updateBadgeProgress(userId, 'quiz_answered', 1, {
        isCorrect: false,
      });

      // Transaction should not be called because the badge should be skipped
      expect(userBadgeRepository.executeTransaction).not.toHaveBeenCalled();
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

      badgeRepository.findManyByTitles.mockResolvedValue([quizBadge]);
      userBadgeRepository.findByCompositeKeyForUpdate.mockResolvedValue(
        userBadge,
      );
      userBadgeRepository.updateById.mockResolvedValue({
        ...userBadge,
        count: 1,
      });

      await service.updateBadgeProgress(userId, 'quiz_answered', 1, {
        isCorrect: true,
      });

      expect(userBadgeRepository.updateById).toHaveBeenCalled();
    });

    it('should use default increment of 1 when not specified', async () => {
      const badge = makeBadge({
        id: 'badge-1',
        title: 'First Story',
        requiredAmount: 5,
      });
      const userBadge = makeUserBadge({ count: 2, unlocked: false });

      badgeRepository.findManyByTitles.mockResolvedValue([badge]);
      userBadgeRepository.findByCompositeKeyForUpdate.mockResolvedValue(
        userBadge,
      );
      userBadgeRepository.updateById.mockResolvedValue({
        ...userBadge,
        count: 3,
      });

      await service.updateBadgeProgress(userId, 'story_read');

      expect(userBadgeRepository.updateById).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          count: 3, // 2 + 1 default increment
        }),
        expect.anything(),
      );
    });

    it('should handle custom increment values', async () => {
      const badge = makeBadge({
        id: 'badge-1',
        title: 'First Story',
        requiredAmount: 10,
      });
      const userBadge = makeUserBadge({ count: 3, unlocked: false });

      badgeRepository.findManyByTitles.mockResolvedValue([badge]);
      userBadgeRepository.findByCompositeKeyForUpdate.mockResolvedValue(
        userBadge,
      );
      userBadgeRepository.updateById.mockResolvedValue({
        ...userBadge,
        count: 8,
      });

      await service.updateBadgeProgress(userId, 'story_read', 5);

      expect(userBadgeRepository.updateById).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          count: 8, // 3 + 5
        }),
        expect.anything(),
      );
    });

    it('should continue processing when a badge title is not found in DB', async () => {
      // Only return one badge from DB but there are two defs for story_read
      const badge = makeBadge({
        id: 'badge-1',
        title: 'First Story',
        requiredAmount: 5,
      });
      const userBadge = makeUserBadge({ count: 0, unlocked: false });

      badgeRepository.findManyByTitles.mockResolvedValue([badge]);
      userBadgeRepository.findByCompositeKeyForUpdate.mockResolvedValue(
        userBadge,
      );
      userBadgeRepository.updateById.mockResolvedValue({
        ...userBadge,
        count: 1,
      });

      await service.updateBadgeProgress(userId, 'story_read', 1);

      // Should still process the badge that was found
      expect(userBadgeRepository.executeTransaction).toHaveBeenCalledTimes(1);
    });
  });

  // -----------------------------------------------------------------------
  // seedBadges
  // -----------------------------------------------------------------------

  describe('seedBadges', () => {
    it('should skip seeding when badges already exist', async () => {
      badgeRepository.count.mockResolvedValue(5);

      await service.seedBadges();

      expect(badgeRepository.count).toHaveBeenCalled();
      expect(badgeRepository.createBadgesInTransaction).not.toHaveBeenCalled();
    });

    it('should seed badges when none exist', async () => {
      badgeRepository.count.mockResolvedValue(0);
      badgeRepository.createBadgesInTransaction.mockResolvedValue([]);

      await service.seedBadges();

      expect(badgeRepository.count).toHaveBeenCalled();
      expect(badgeRepository.createBadgesInTransaction).toHaveBeenCalledTimes(
        1,
      );
      const catalogArg =
        badgeRepository.createBadgesInTransaction.mock.calls[0][0];
      expect(catalogArg).toHaveLength(mockBadgeConstants.CATALOG.length);
    });

    it('should create badge records with correct data from CATALOG', async () => {
      badgeRepository.count.mockResolvedValue(0);
      badgeRepository.createBadgesInTransaction.mockResolvedValue([]);

      await service.seedBadges();

      // Verify the catalog passed to the repository carries the expected data
      expect(badgeRepository.createBadgesInTransaction).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            title: 'First Story',
            description: 'Read your first story',
            badgeType: 'count',
            requiredAmount: 1,
            priority: 10,
          }),
        ]),
      );
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

      const earlyBadge = makeBadge({
        id: 'badge-early',
        title: 'Early Bird',
        badgeType: 'special',
        requiredAmount: 1,
      });
      badgeRepository.findManyByTitles.mockResolvedValue([earlyBadge]);

      await service.updateBadgeProgress(userId, 'early_special', 1);

      // Badge should be skipped - no transaction
      expect(userBadgeRepository.executeTransaction).not.toHaveBeenCalled();

      // Restore
      (mockBadgeConstants as Record<string, unknown>).BADGE_DEFS_BY_TYPE =
        originalDefs;
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

      const nightBadge = makeBadge({
        id: 'badge-night',
        title: 'Night Owl',
        badgeType: 'special',
        requiredAmount: 1,
      });
      badgeRepository.findManyByTitles.mockResolvedValue([nightBadge]);

      await service.updateBadgeProgress(userId, 'night_special', 1);

      expect(userBadgeRepository.executeTransaction).not.toHaveBeenCalled();

      (mockBadgeConstants as Record<string, unknown>).BADGE_DEFS_BY_TYPE =
        originalDefs;
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

      const earlyBadge = makeBadge({
        id: 'badge-early',
        title: 'Early Bird',
        badgeType: 'special',
        requiredAmount: 1,
      });
      const userBadge = makeUserBadge({
        badgeId: 'badge-early',
        count: 0,
        unlocked: false,
      });
      badgeRepository.findManyByTitles.mockResolvedValue([earlyBadge]);
      userBadgeRepository.findByCompositeKeyForUpdate.mockResolvedValue(
        userBadge,
      );
      userBadgeRepository.updateById.mockResolvedValue({
        ...userBadge,
        count: 1,
        unlocked: true,
      });

      await service.updateBadgeProgress(userId, 'early_special', 1);

      // Badge should be processed - transaction should be called
      expect(userBadgeRepository.executeTransaction).toHaveBeenCalled();

      (mockBadgeConstants as Record<string, unknown>).BADGE_DEFS_BY_TYPE =
        originalDefs;
      jest.restoreAllMocks();
    });
  });
});

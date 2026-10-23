import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { PrismaAdminEngagementRepository } from './prisma-admin-engagement.repository';

describe('PrismaAdminEngagementRepository.getStoryReaderStats', () => {
  let prisma: PrismaService;
  let repo: PrismaAdminEngagementRepository;
  let storyId: string;
  let kidIds: string[];
  let userIds: string[];

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PrismaService, PrismaAdminEngagementRepository],
    }).compile();
    prisma = module.get(PrismaService);
    repo = module.get(PrismaAdminEngagementRepository);

    const story = await prisma.story.create({
      data: {
        title: 'Test Story',
        description: 'd',
        language: 'en',
        coverImageUrl: 'x',
        audioUrl: 'x',
        isInteractive: false,
        ageMin: 3,
        ageMax: 6,
      },
    });
    storyId = story.id;

    const parent = await prisma.user.create({
      data: { email: `parent-${Date.now()}@test.dev`, passwordHash: 'x' },
    });
    const parent2 = await prisma.user.create({
      data: { email: `parent2-${Date.now()}@test.dev`, passwordHash: 'x' },
    });
    const kid1 = await prisma.kid.create({
      data: { parentId: parent.id, name: 'Kid One' },
    });
    const kid2 = await prisma.kid.create({
      data: { parentId: parent.id, name: 'Kid Two' },
    });
    kidIds = [kid1.id, kid2.id];
    userIds = [parent.id, parent2.id];

    // 2 distinct kid readers, one completed
    await prisma.storyProgress.create({
      data: {
        kidId: kid1.id,
        storyId,
        completed: true,
        totalTimeSpent: 120,
        lastAccessed: new Date(),
      },
    });
    await prisma.storyProgress.create({
      data: {
        kidId: kid2.id,
        storyId,
        completed: false,
        totalTimeSpent: 60,
        lastAccessed: new Date(),
      },
    });
    // 1 distinct direct-parent reader (parent2 reading without a kid profile)
    await prisma.userStoryProgress.create({
      data: {
        userId: parent2.id,
        storyId,
        completed: false,
        totalTimeSpent: 30,
        lastAccessed: new Date(),
      },
    });
  });

  afterEach(async () => {
    await prisma.storyProgress.deleteMany({ where: { storyId } });
    await prisma.userStoryProgress.deleteMany({ where: { storyId } });
    await prisma.kid.deleteMany({ where: { id: { in: kidIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.story.deleteMany({ where: { id: storyId } });
  });

  it('counts distinct kid readers plus distinct direct-parent readers as one union', async () => {
    const start = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const end = new Date(Date.now() + 1000);
    const stats = await repo.getStoryReaderStats({ start, end });
    const row = stats.find((s) => s.storyId === storyId);
    expect(row).toBeDefined();
    expect(row!.distinctReaders).toBe(3); // 2 kids + 1 direct parent
    expect(row!.completedCount).toBe(1);
  });

  it('getStoryReaderStatsForStory returns the same totals for a single story, no range filter', async () => {
    const stats = await repo.getStoryReaderStatsForStory(storyId);
    expect(stats).not.toBeNull();
    expect(stats!.distinctReaders).toBe(3);
    expect(stats!.completedCount).toBe(1);
  });
});

describe('PrismaAdminEngagementRepository.getStoryReaderTrend', () => {
  let prisma: PrismaService;
  let repo: PrismaAdminEngagementRepository;
  let storyId: string;
  let kidIds: string[];
  let userIds: string[];
  const dayOne = new Date('2026-10-01T12:00:00Z');
  const dayTwo = new Date('2026-10-03T12:00:00Z');

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PrismaService, PrismaAdminEngagementRepository],
    }).compile();
    prisma = module.get(PrismaService);
    repo = module.get(PrismaAdminEngagementRepository);

    const story = await prisma.story.create({
      data: {
        title: 'Trend Story',
        description: 'd',
        language: 'en',
        coverImageUrl: 'x',
        audioUrl: 'x',
        isInteractive: false,
        ageMin: 3,
        ageMax: 6,
      },
    });
    storyId = story.id;

    const parent = await prisma.user.create({
      data: { email: `trend-parent-${Date.now()}@test.dev`, passwordHash: 'x' },
    });
    const kid1 = await prisma.kid.create({
      data: { parentId: parent.id, name: 'Trend Kid One' },
    });
    const kid2 = await prisma.kid.create({
      data: { parentId: parent.id, name: 'Trend Kid Two' },
    });
    kidIds = [kid1.id, kid2.id];
    userIds = [parent.id];

    // Day one: 1 kid reader, completed.
    await prisma.storyProgress.create({
      data: {
        kidId: kid1.id,
        storyId,
        completed: true,
        totalTimeSpent: 100,
        lastAccessed: dayOne,
      },
    });
    // Day two: a different kid reader, not completed.
    await prisma.storyProgress.create({
      data: {
        kidId: kid2.id,
        storyId,
        completed: false,
        totalTimeSpent: 50,
        lastAccessed: dayTwo,
      },
    });
  });

  afterEach(async () => {
    await prisma.storyProgress.deleteMany({ where: { storyId } });
    await prisma.kid.deleteMany({ where: { id: { in: kidIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.story.deleteMany({ where: { id: storyId } });
  });

  it('buckets distinct readers and completions per day, not into a single row', async () => {
    const trend = await repo.getStoryReaderTrend(storyId, {
      start: new Date('2026-09-30T00:00:00Z'),
      end: new Date('2026-10-04T00:00:00Z'),
    });

    expect(trend).toHaveLength(2);
    expect(trend[0].date).toBe('2026-10-01');
    expect(trend[0].distinctReaders).toBe(1);
    expect(trend[0].completions).toBe(1);
    expect(trend[1].date).toBe('2026-10-03');
    expect(trend[1].distinctReaders).toBe(1);
    expect(trend[1].completions).toBe(0);
  });
});

describe('PrismaAdminEngagementRepository.getStoryReaders', () => {
  let prisma: PrismaService;
  let repo: PrismaAdminEngagementRepository;
  let storyId: string;
  let kidIds: string[];
  let userIds: string[];

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PrismaService, PrismaAdminEngagementRepository],
    }).compile();
    prisma = module.get(PrismaService);
    repo = module.get(PrismaAdminEngagementRepository);

    const story = await prisma.story.create({
      data: {
        title: 'Readers Story',
        description: 'd',
        language: 'en',
        coverImageUrl: 'x',
        audioUrl: 'x',
        isInteractive: false,
        ageMin: 3,
        ageMax: 6,
      },
    });
    storyId = story.id;

    const parent = await prisma.user.create({
      data: {
        email: `readers-parent-${Date.now()}@test.dev`,
        passwordHash: 'x',
        name: 'Readers Parent',
      },
    });
    const directParent = await prisma.user.create({
      data: {
        email: `readers-direct-${Date.now()}@test.dev`,
        passwordHash: 'x',
        name: 'Direct Reader',
      },
    });
    const kid = await prisma.kid.create({
      data: { parentId: parent.id, name: 'Readers Kid' },
    });
    kidIds = [kid.id];
    userIds = [parent.id, directParent.id];

    await prisma.storyProgress.create({
      data: {
        kidId: kid.id,
        storyId,
        completed: false,
        totalTimeSpent: 40,
        lastAccessed: new Date(),
      },
    });
    await prisma.userStoryProgress.create({
      data: {
        userId: directParent.id,
        storyId,
        completed: false,
        totalTimeSpent: 20,
        lastAccessed: new Date(),
      },
    });
  });

  afterEach(async () => {
    await prisma.storyProgress.deleteMany({ where: { storyId } });
    await prisma.userStoryProgress.deleteMany({ where: { storyId } });
    await prisma.kid.deleteMany({ where: { id: { in: kidIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.story.deleteMany({ where: { id: storyId } });
  });

  it('returns both the kid reader and the direct-parent reader with correct types and names', async () => {
    const readers = await repo.getStoryReaders(storyId);

    expect(readers).toHaveLength(2);
    const kidReader = readers.find((r) => r.readerType === 'kid');
    const userReader = readers.find((r) => r.readerType === 'user');
    expect(kidReader).toBeDefined();
    expect(kidReader!.displayName).toBe('Readers Kid');
    expect(userReader).toBeDefined();
    expect(userReader!.displayName).toBe('Direct Reader');
  });
});

describe('PrismaAdminEngagementRepository soft-deleted reader exclusion', () => {
  let prisma: PrismaService;
  let repo: PrismaAdminEngagementRepository;
  let storyId: string;
  let kidIds: string[];
  let userIds: string[];
  let activeKidId: string;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PrismaService, PrismaAdminEngagementRepository],
    }).compile();
    prisma = module.get(PrismaService);
    repo = module.get(PrismaAdminEngagementRepository);

    const story = await prisma.story.create({
      data: {
        title: 'Soft Delete Story',
        description: 'd',
        language: 'en',
        coverImageUrl: 'x',
        audioUrl: 'x',
        isInteractive: false,
        ageMin: 3,
        ageMax: 6,
      },
    });
    storyId = story.id;

    const parent = await prisma.user.create({
      data: {
        email: `softdel-parent-${Date.now()}@test.dev`,
        passwordHash: 'x',
      },
    });
    // 4 active kids + 1 soft-deleted kid = 5 rows in story_progress, but only
    // 4 real (non-deleted) readers.
    const activeKids = await Promise.all(
      [1, 2, 3, 4].map((n) =>
        prisma.kid.create({
          data: { parentId: parent.id, name: `Active Kid ${n}` },
        }),
      ),
    );
    const deletedKid = await prisma.kid.create({
      data: { parentId: parent.id, name: 'Deleted Kid', isDeleted: true },
    });
    kidIds = [...activeKids.map((k) => k.id), deletedKid.id];
    userIds = [parent.id];
    activeKidId = activeKids[0].id;

    await Promise.all(
      [...activeKids, deletedKid].map((kid) =>
        prisma.storyProgress.create({
          data: {
            kidId: kid.id,
            storyId,
            completed: false,
            totalTimeSpent: 10,
            lastAccessed: new Date(),
          },
        }),
      ),
    );
  });

  afterEach(async () => {
    await prisma.storyProgress.deleteMany({ where: { storyId } });
    await prisma.kid.deleteMany({ where: { id: { in: kidIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.story.deleteMany({ where: { id: storyId } });
  });

  it('getStoryReaderStatsForStory does not count a soft-deleted kid, so the true count stays below the suppression threshold', async () => {
    const stats = await repo.getStoryReaderStatsForStory(storyId);
    expect(stats).not.toBeNull();
    expect(stats!.distinctReaders).toBe(4); // not 5 — the deleted kid must not count
  });

  it('getStoryReaderStats (list variant) agrees with getStoryReaders on the same 4 real readers', async () => {
    const start = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const end = new Date(Date.now() + 1000);
    const stats = await repo.getStoryReaderStats({ start, end });
    const row = stats.find((s) => s.storyId === storyId);
    expect(row!.distinctReaders).toBe(4);

    const readers = await repo.getStoryReaders(storyId);
    expect(readers).toHaveLength(4);
    expect(readers.some((r) => r.readerId === activeKidId)).toBe(true);
  });

  it('getStoryReaderTrend excludes the soft-deleted kid from the per-day count', async () => {
    const start = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const end = new Date(Date.now() + 1000);
    const trend = await repo.getStoryReaderTrend(storyId, { start, end });
    const totalDistinctReaders = trend.reduce(
      (sum, p) => sum + p.distinctReaders,
      0,
    );
    expect(totalDistinctReaders).toBe(4);
  });
});

describe('PrismaAdminEngagementRepository soft-deleted story exclusion', () => {
  let prisma: PrismaService;
  let repo: PrismaAdminEngagementRepository;
  let storyId: string;
  let kidIds: string[];
  let userIds: string[];

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PrismaService, PrismaAdminEngagementRepository],
    }).compile();
    prisma = module.get(PrismaService);
    repo = module.get(PrismaAdminEngagementRepository);

    const story = await prisma.story.create({
      data: {
        title: 'Soft Deleted Story',
        description: 'd',
        language: 'en',
        coverImageUrl: 'x',
        audioUrl: 'x',
        isInteractive: false,
        ageMin: 3,
        ageMax: 6,
        isDeleted: true,
      },
    });
    storyId = story.id;

    const parent = await prisma.user.create({
      data: { email: `delstory-parent-${Date.now()}@test.dev`, passwordHash: 'x' },
    });
    const kids = await Promise.all(
      [1, 2, 3, 4, 5].map((n) =>
        prisma.kid.create({ data: { parentId: parent.id, name: `Kid ${n}` } }),
      ),
    );
    kidIds = kids.map((k) => k.id);
    userIds = [parent.id];

    // 5 active, non-deleted readers — would be well above the suppression
    // threshold if the story itself weren't soft-deleted.
    await Promise.all(
      kids.map((kid) =>
        prisma.storyProgress.create({
          data: {
            kidId: kid.id,
            storyId,
            completed: false,
            totalTimeSpent: 10,
            lastAccessed: new Date(),
          },
        }),
      ),
    );
  });

  afterEach(async () => {
    await prisma.storyProgress.deleteMany({ where: { storyId } });
    await prisma.kid.deleteMany({ where: { id: { in: kidIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.story.deleteMany({ where: { id: storyId } });
  });

  it('getStoryReaderStats excludes a soft-deleted story entirely from its results', async () => {
    const start = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const end = new Date(Date.now() + 1000);
    const stats = await repo.getStoryReaderStats({ start, end });
    expect(stats.find((s) => s.storyId === storyId)).toBeUndefined();
  });

  it('getStoryReaderStatsForStory returns null for a soft-deleted story despite active progress rows', async () => {
    const stats = await repo.getStoryReaderStatsForStory(storyId);
    expect(stats).toBeNull();
  });

  it('getStoryReaderTrend returns no rows for a soft-deleted story', async () => {
    const start = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const end = new Date(Date.now() + 1000);
    const trend = await repo.getStoryReaderTrend(storyId, { start, end });
    expect(trend).toEqual([]);
  });
});

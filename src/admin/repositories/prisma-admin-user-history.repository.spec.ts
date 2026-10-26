import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { PrismaAdminUserHistoryRepository } from './prisma-admin-user-history.repository';

// DB-backed: needs DATABASE_URL pointing at a migrated database.
describe('PrismaAdminUserHistoryRepository', () => {
  let prisma: PrismaService;
  let repo: PrismaAdminUserHistoryRepository;

  const tag = `uh-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const userIds: string[] = [];
  const storyIds: string[] = [];

  let userA: string;
  let userB: string;
  let userDeleted: string;
  let kidA1: string;
  let kidA2Deleted: string;
  let kidB: string;
  let sOk: string;
  let sOk2: string;
  let sDeleted: string;

  const t = (mins: number) => new Date(Date.UTC(2026, 0, 10, 12, mins));

  const mkStory = async (title: string, isDeleted = false) => {
    const s = await prisma.story.create({
      data: {
        title: `${tag}-${title}`,
        description: 'd',
        language: 'en',
        coverImageUrl: 'x',
        audioUrl: 'x',
        isInteractive: false,
        ageMin: 3,
        ageMax: 6,
        isDeleted,
      },
    });
    storyIds.push(s.id);
    return s.id;
  };
  const mkUser = async (label: string, isDeleted = false) => {
    const u = await prisma.user.create({
      data: {
        email: `${tag}-${label}@test.dev`,
        passwordHash: 'x',
        isDeleted,
      },
    });
    userIds.push(u.id);
    return u.id;
  };

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PrismaService, PrismaAdminUserHistoryRepository],
    }).compile();
    prisma = module.get(PrismaService);
    repo = module.get(PrismaAdminUserHistoryRepository);

    userA = await mkUser('a');
    userB = await mkUser('b');
    userDeleted = await mkUser('del', true);
    kidA1 = (
      await prisma.kid.create({ data: { parentId: userA, name: 'Alpha' } })
    ).id;
    kidA2Deleted = (
      await prisma.kid.create({
        data: { parentId: userA, name: 'Gone', isDeleted: true },
      })
    ).id;
    kidB = (
      await prisma.kid.create({ data: { parentId: userB, name: 'Bravo' } })
    ).id;

    sOk = await mkStory('ok');
    sOk2 = await mkStory('ok2');
    sDeleted = await mkStory('deleted', true);

    const log = (
      userId: string | null,
      kidId: string | null,
      action: string,
      mins: number,
      extra: Partial<{ isDeleted: boolean; details: string }> = {},
    ) =>
      prisma.activityLog.create({
        data: {
          userId,
          kidId,
          action,
          status: 'SUCCESS',
          createdAt: t(mins),
          ...extra,
        },
      });
    await log(userA, null, 'A_OWN_1', 1);
    await log(userA, null, 'A_OWN_2', 5, { details: '{"storyId":"x"}' });
    await log(null, kidA1, 'A_KID_1', 3); // kid row without a userId
    await log(userA, kidA1, 'A_KID_2', 4); // kid row with both
    await log(null, kidA2Deleted, 'A_DELETED_KID', 6); // soft-deleted kid
    await log(userA, null, 'A_SOFT_DELETED', 7, { isDeleted: true });
    await log(userB, null, 'B_OWN', 2);
    await log(null, kidB, 'B_KID', 2);
    await log(userA, kidB, 'A_WITH_FOREIGN_KID', 8); // must never leak
    await log(null, null, 'ANON_GUEST', 2);

    const up = (
      userId: string,
      storyId: string,
      mins: number,
      o: Record<string, unknown> = {},
    ) =>
      prisma.userStoryProgress.create({
        data: {
          userId,
          storyId,
          progress: 40,
          totalTimeSpent: 100,
          lastAccessed: t(mins),
          ...o,
        },
      });
    const kp = (
      kidId: string,
      storyId: string,
      mins: number,
      o: Record<string, unknown> = {},
    ) =>
      prisma.storyProgress.create({
        data: {
          kidId,
          storyId,
          progress: 70,
          totalTimeSpent: 50,
          lastAccessed: t(mins),
          ...o,
        },
      });
    await up(userA, sOk, 10, { completed: true, progress: 100 });
    await up(userA, sDeleted, 20); // deleted story
    await up(userA, sOk2, 30, { isDeleted: true }); // deleted row
    await up(userB, sOk, 40);
    await kp(kidA1, sOk, 15, { completed: true, progress: 100 });
    await kp(kidA1, sOk2, 12);
    await kp(kidA1, sDeleted, 50); // deleted story
    await kp(kidA2Deleted, sOk, 60); // deleted kid
    await kp(kidB, sOk, 70);
  });

  afterAll(async () => {
    const kids = await prisma.kid.findMany({
      where: { parentId: { in: userIds } },
      select: { id: true },
    });
    const kidIds = kids.map((k) => k.id);
    await prisma.activityLog.deleteMany({
      where: { OR: [{ userId: { in: userIds } }, { kidId: { in: kidIds } }] },
    });
    await prisma.storyProgress.deleteMany({ where: { kidId: { in: kidIds } } });
    await prisma.userStoryProgress.deleteMany({
      where: { userId: { in: userIds } },
    });
    await prisma.kid.deleteMany({ where: { id: { in: kidIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.story.deleteMany({ where: { id: { in: storyIds } } });
    await prisma.$disconnect();
  });

  describe('findActiveUser / findKids', () => {
    it('returns the user, null for unknown and soft-deleted users', async () => {
      expect(await repo.findActiveUser(userA)).toEqual({ id: userA });
      expect(await repo.findActiveUser('nope')).toBeNull();
      expect(await repo.findActiveUser(userDeleted)).toBeNull();
    });
    it('returns only non-deleted kids of that user', async () => {
      expect(await repo.findKids(userA)).toEqual([
        { id: kidA1, name: 'Alpha' },
      ]);
    });
  });

  describe('findActivityPage', () => {
    const base = () => ({
      userId: userA,
      kidIds: [kidA1],
      includeUserOwn: true,
      skip: 0,
      take: 50,
    });

    it('returns the user and own-kid rows newest first, never other users / deleted / foreign-kid rows', async () => {
      const { rows, total } = await repo.findActivityPage(base());
      expect(rows.map((r) => r.action)).toEqual([
        'A_OWN_2',
        'A_KID_2',
        'A_KID_1',
        'A_OWN_1',
      ]);
      expect(total).toBe(4);
      const kidRow = rows.find((r) => r.action === 'A_KID_1');
      expect(kidRow?.kidId).toBe(kidA1);
    });

    it('paginates with a stable total', async () => {
      const p1 = await repo.findActivityPage({ ...base(), take: 3 });
      const p2 = await repo.findActivityPage({ ...base(), skip: 3, take: 3 });
      expect(p1.rows).toHaveLength(3);
      expect(p2.rows.map((r) => r.action)).toEqual(['A_OWN_1']);
      expect(p1.total).toBe(4);
      expect(p2.total).toBe(4);
    });

    it('filters by action', async () => {
      const { rows, total } = await repo.findActivityPage({
        ...base(),
        action: 'A_KID_2',
      });
      expect(rows.map((r) => r.action)).toEqual(['A_KID_2']);
      expect(total).toBe(1);
    });

    it('filters by inclusive from/to', async () => {
      const { rows } = await repo.findActivityPage({
        ...base(),
        from: t(3),
        to: t(4),
      });
      expect(rows.map((r) => r.action)).toEqual(['A_KID_2', 'A_KID_1']);
    });

    it('restricts to a single kid when includeUserOwn=false', async () => {
      const { rows } = await repo.findActivityPage({
        ...base(),
        includeUserOwn: false,
      });
      expect(rows.map((r) => r.action)).toEqual(['A_KID_2', 'A_KID_1']);
    });

    it('returns nothing for a user with no kids and no own rows', async () => {
      const r = await repo.findActivityPage({
        userId: userDeleted,
        kidIds: [],
        includeUserOwn: true,
        skip: 0,
        take: 10,
      });
      expect(r).toEqual({ rows: [], total: 0 });
    });

    it('returns the raw details string for the caller to sanitise', async () => {
      const { rows } = await repo.findActivityPage({
        ...base(),
        action: 'A_OWN_2',
      });
      expect(rows[0].details).toBe('{"storyId":"x"}');
    });
  });

  describe('findStoryTitles', () => {
    it('maps ids to titles and omits soft-deleted stories', async () => {
      const m = await repo.findStoryTitles([sOk, sDeleted, 'missing']);
      expect([...m.keys()]).toEqual([sOk]);
      expect(m.get(sOk)).toBe(`${tag}-ok`);
    });
    it('short-circuits on empty input', async () => {
      expect((await repo.findStoryTitles([])).size).toBe(0);
    });
  });

  describe('findReadingPage / getReadingSummary', () => {
    const base = () => ({
      userId: userA,
      kidIds: [kidA1],
      includeUser: true,
      skip: 0,
      take: 50,
    });

    it('unions user + own-kid progress, excludes deleted stories/rows/kids and other users, ordered by lastAccessed desc', async () => {
      const { rows, total } = await repo.findReadingPage(base());
      expect(total).toBe(3);
      expect(
        rows.map((r) => [r.readerType, r.kidId, r.storyId, r.lastAccessed]),
      ).toEqual([
        ['kid', kidA1, sOk, t(15)],
        ['kid', kidA1, sOk2, t(12)],
        ['user', null, sOk, t(10)],
      ]);
      expect(rows[0]).toMatchObject({
        title: `${tag}-ok`,
        progress: 100,
        completed: true,
        totalTimeSpentSeconds: 50,
      });
    });

    it('paginates across the union', async () => {
      const p1 = await repo.findReadingPage({ ...base(), take: 2 });
      const p2 = await repo.findReadingPage({ ...base(), skip: 2, take: 2 });
      expect(p1.rows).toHaveLength(2);
      expect(p2.rows.map((r) => r.readerType)).toEqual(['user']);
      expect(p2.total).toBe(3);
    });

    it('applies the lastAccessed window', async () => {
      const { rows, total } = await repo.findReadingPage({
        ...base(),
        start: t(11),
        end: t(14),
      });
      expect(total).toBe(1);
      expect(rows[0].storyId).toBe(sOk2);
    });

    it('restricts to kids only when includeUser=false', async () => {
      const { total } = await repo.findReadingPage({
        ...base(),
        includeUser: false,
      });
      expect(total).toBe(2);
    });

    it('summarises per reader with the same filters', async () => {
      const s = await repo.getReadingSummary(base());
      expect(s.user).toEqual({
        storiesRead: 1,
        storiesCompleted: 1,
        totalTimeSpentSeconds: 100,
        lastActiveAt: t(10),
      });
      expect(s.kids).toEqual([
        {
          kidId: kidA1,
          storiesRead: 2,
          storiesCompleted: 1,
          totalTimeSpentSeconds: 100,
          lastActiveAt: t(15),
        },
      ]);
    });

    it('summary honours the window and includeUser=false', async () => {
      const s = await repo.getReadingSummary({
        ...base(),
        includeUser: false,
        start: t(13),
      });
      expect(s.user.storiesRead).toBe(0);
      expect(s.user.lastActiveAt).toBeNull();
      expect(s.kids).toEqual([
        {
          kidId: kidA1,
          storiesRead: 1,
          storiesCompleted: 1,
          totalTimeSpentSeconds: 50,
          lastActiveAt: t(15),
        },
      ]);
    });
  });
});

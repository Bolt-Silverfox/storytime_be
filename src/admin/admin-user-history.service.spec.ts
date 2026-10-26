import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AdminUserHistoryService } from './admin-user-history.service';
import { IAdminUserHistoryRepository } from './repositories';
import { REDACTED } from './utils/activity-details.sanitizer';

describe('AdminUserHistoryService', () => {
  let repo: jest.Mocked<IAdminUserHistoryRepository>;
  let service: AdminUserHistoryService;

  const kids = [
    { id: 'k1', name: 'Alpha' },
    { id: 'k2', name: null },
  ];

  beforeEach(() => {
    repo = {
      findActiveUser: jest.fn().mockResolvedValue({ id: 'u1' }),
      findKids: jest.fn().mockResolvedValue(kids),
      findActivityPage: jest.fn().mockResolvedValue({ rows: [], total: 0 }),
      findStoryTitles: jest.fn().mockResolvedValue(new Map()),
      findReadingPage: jest.fn().mockResolvedValue({ rows: [], total: 0 }),
      getReadingSummary: jest.fn().mockResolvedValue({
        user: {
          storiesRead: 0,
          storiesCompleted: 0,
          totalTimeSpentSeconds: 0,
          lastActiveAt: null,
        },
        kids: [],
      }),
    };
    service = new AdminUserHistoryService(repo);
  });

  describe('getActivity', () => {
    it('404s for an unknown or soft-deleted user without touching other data', async () => {
      repo.findActiveUser.mockResolvedValue(null);
      await expect(service.getActivity('nope', {})).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(repo.findActivityPage).not.toHaveBeenCalled();
    });

    it('400s on from > to before querying', async () => {
      await expect(
        service.getActivity('u1', { from: '2026-02-02', to: '2026-02-01' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repo.findActivityPage).not.toHaveBeenCalled();
    });

    it('queries the user plus all their kids by default with page math and meta', async () => {
      repo.findActivityPage.mockResolvedValue({ rows: [], total: 45 });
      const res = await service.getActivity('u1', { page: 3, limit: 20 });
      expect(repo.findActivityPage).toHaveBeenCalledWith({
        userId: 'u1',
        kidIds: ['k1', 'k2'],
        includeUserOwn: true,
        action: undefined,
        from: undefined,
        to: undefined,
        skip: 40,
        take: 20,
      });
      expect(res.meta).toEqual({
        total: 45,
        page: 3,
        limit: 20,
        totalPages: 3,
      });
    });

    it('passes action and a date-only `to` as an inclusive upper bound', async () => {
      await service.getActivity('u1', {
        action: 'USER_LOGIN',
        from: '2026-01-01',
        to: '2026-01-02',
      });
      const arg = repo.findActivityPage.mock.calls[0][0];
      expect(arg.action).toBe('USER_LOGIN');
      expect(arg.from?.toISOString()).toBe('2026-01-01T00:00:00.000Z');
      expect(arg.to?.toISOString()).toBe('2026-01-02T23:59:59.999Z');
    });

    it("restricts to one kid when kidId is one of the user's kids", async () => {
      await service.getActivity('u1', { kidId: 'k1' });
      const arg = repo.findActivityPage.mock.calls[0][0];
      expect(arg.kidIds).toEqual(['k1']);
      expect(arg.includeUserOwn).toBe(false);
    });

    it("returns an empty page (no query) for a kidId that is not this user's kid", async () => {
      const res = await service.getActivity('u1', {
        kidId: 'someone-elses-kid',
        page: 1,
        limit: 20,
      });
      expect(repo.findActivityPage).not.toHaveBeenCalled();
      expect(res).toEqual({
        data: [],
        meta: { total: 0, page: 1, limit: 20, totalPages: 0 },
      });
    });

    it('maps rows: kid name, story title, sanitised details object, ISO dates', async () => {
      const createdAt = new Date('2026-01-01T10:00:00.000Z');
      repo.findActivityPage.mockResolvedValue({
        total: 3,
        rows: [
          {
            id: 'a1',
            action: 'STORY_READ',
            createdAt,
            kidId: 'k1',
            details: JSON.stringify({ storyId: 's1', token: 'abc', n: 1 }),
          },
          {
            id: 'a2',
            action: 'USER_REGISTERED',
            createdAt,
            kidId: null,
            details: 'User registered: someone@example.com',
          },
          {
            id: 'a3',
            action: 'LOGIN',
            createdAt,
            kidId: 'k2',
            details: null,
          },
        ],
      });
      repo.findStoryTitles.mockResolvedValue(new Map([['s1', 'The Story']]));

      const res = await service.getActivity('u1', {});

      expect(repo.findStoryTitles).toHaveBeenCalledWith(['s1']);
      expect(res.data).toEqual([
        {
          id: 'a1',
          action: 'STORY_READ',
          createdAt: '2026-01-01T10:00:00.000Z',
          kidId: 'k1',
          kidName: 'Alpha',
          storyId: 's1',
          storyTitle: 'The Story',
          details: { storyId: 's1', token: REDACTED, n: 1 },
        },
        {
          id: 'a2',
          action: 'USER_REGISTERED',
          createdAt: '2026-01-01T10:00:00.000Z',
          kidId: null,
          kidName: null,
          storyId: null,
          storyTitle: null,
          details: { message: `User registered: ${REDACTED}` },
        },
        {
          id: 'a3',
          action: 'LOGIN',
          createdAt: '2026-01-01T10:00:00.000Z',
          kidId: 'k2',
          kidName: null,
          storyId: null,
          storyTitle: null,
          details: null,
        },
      ]);
    });

    it('keeps storyId but nulls the title for a deleted/unknown story', async () => {
      repo.findActivityPage.mockResolvedValue({
        total: 1,
        rows: [
          {
            id: 'a1',
            action: 'STORY_READ',
            createdAt: new Date(),
            kidId: null,
            details: '{"storyId":"gone"}',
          },
        ],
      });
      const res = await service.getActivity('u1', {});
      expect(res.data[0].storyId).toBe('gone');
      expect(res.data[0].storyTitle).toBeNull();
    });
  });

  describe('getReading', () => {
    const aggregate = (
      n: number,
      done: number,
      secs: number,
      at: string | null,
    ) => ({
      storiesRead: n,
      storiesCompleted: done,
      totalTimeSpentSeconds: secs,
      lastActiveAt: at ? new Date(at) : null,
    });

    it('404s for an unknown or soft-deleted user', async () => {
      repo.findActiveUser.mockResolvedValue(null);
      await expect(service.getReading('nope', {})).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(repo.findReadingPage).not.toHaveBeenCalled();
    });

    it('400s on startDate > endDate', async () => {
      await expect(
        service.getReading('u1', {
          startDate: '2026-02-02',
          endDate: '2026-02-01',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('range=all adds no window; numeric range adds a start bound', async () => {
      await service.getReading('u1', { range: 'all' });
      expect(repo.findReadingPage.mock.calls[0][0].start).toBeUndefined();
      await service.getReading('u1', { range: 7 });
      expect(repo.findReadingPage.mock.calls[1][0].start).toBeInstanceOf(Date);
    });

    it('maps rows and builds the summary across user + kids (all kids listed, zero-filled)', async () => {
      const at = new Date('2026-01-05T00:00:00.000Z');
      repo.findReadingPage.mockResolvedValue({
        total: 21,
        rows: [
          {
            storyId: 's1',
            title: 'T1',
            readerType: 'kid',
            kidId: 'k1',
            progress: 55,
            completed: false,
            totalTimeSpentSeconds: 30,
            lastAccessed: at,
          },
          {
            storyId: 's2',
            title: 'T2',
            readerType: 'user',
            kidId: null,
            progress: 100,
            completed: true,
            totalTimeSpentSeconds: 90,
            lastAccessed: at,
          },
        ],
      });
      repo.getReadingSummary.mockResolvedValue({
        user: aggregate(1, 1, 90, '2026-01-05T00:00:00.000Z'),
        kids: [
          { kidId: 'k1', ...aggregate(2, 0, 60, '2026-01-06T00:00:00.000Z') },
        ],
      });

      const res = await service.getReading('u1', { page: 2, limit: 20 });

      expect(repo.findReadingPage).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'u1',
          kidIds: ['k1', 'k2'],
          includeUser: true,
          skip: 20,
          take: 20,
        }),
      );
      expect(res.data).toEqual([
        {
          storyId: 's1',
          title: 'T1',
          readerType: 'kid',
          kidId: 'k1',
          kidName: 'Alpha',
          progress: 55,
          completed: false,
          totalTimeSpentSeconds: 30,
          lastAccessed: '2026-01-05T00:00:00.000Z',
        },
        {
          storyId: 's2',
          title: 'T2',
          readerType: 'user',
          kidId: null,
          kidName: null,
          progress: 100,
          completed: true,
          totalTimeSpentSeconds: 90,
          lastAccessed: '2026-01-05T00:00:00.000Z',
        },
      ]);
      expect(res.summary).toEqual({
        storiesRead: 3,
        storiesCompleted: 1,
        totalTimeSpentSeconds: 150,
        lastActiveAt: '2026-01-06T00:00:00.000Z',
        kids: [
          { kidId: 'k1', name: 'Alpha', storiesRead: 2 },
          { kidId: 'k2', name: null, storiesRead: 0 },
        ],
      });
      expect(res.meta).toEqual({
        total: 21,
        page: 2,
        limit: 20,
        totalPages: 2,
      });
    });

    it('lastActiveAt is null with no reading at all', async () => {
      const res = await service.getReading('u1', {});
      expect(res.summary.lastActiveAt).toBeNull();
      expect(res.summary.storiesRead).toBe(0);
    });

    it('keeps every kid in summary.kids with its date-range-only count when filtering by kidId, while totals stay kid-filtered', async () => {
      repo.getReadingSummary.mockImplementation((f) => {
        const onlyOneKid = f.kidIds.length === 1;
        return Promise.resolve(
          f.includeUser
            ? { user: aggregate(0, 0, 0, null), kids: [] }
            : {
                user: aggregate(0, 0, 0, null),
                kids: onlyOneKid
                  ? [
                      {
                        kidId: 'k2',
                        ...aggregate(1, 1, 30, '2026-01-09T00:00:00.000Z'),
                      },
                    ]
                  : [
                      {
                        kidId: 'k1',
                        ...aggregate(4, 2, 90, '2026-01-08T00:00:00.000Z'),
                      },
                      {
                        kidId: 'k2',
                        ...aggregate(1, 1, 30, '2026-01-09T00:00:00.000Z'),
                      },
                    ],
              },
        );
      });
      const res = await service.getReading('u1', {
        kidId: 'k2',
        range: 7,
      });
      expect(res.summary.storiesRead).toBe(1);
      expect(res.summary.totalTimeSpentSeconds).toBe(30);
      expect(res.summary.kids).toEqual([
        { kidId: 'k1', name: 'Alpha', storiesRead: 4 },
        { kidId: 'k2', name: null, storiesRead: 1 },
      ]);
      const kidList = repo.getReadingSummary.mock.calls.find(
        ([f]) => f.kidIds.length === 2,
      )![0];
      expect(kidList.includeUser).toBe(false);
      expect(kidList.start).toEqual(
        repo.getReadingSummary.mock.calls[0][0].start,
      );

      const foreign = await service.getReading('u1', { kidId: 'foreign' });
      expect(foreign.summary.storiesRead).toBe(0);
      expect(foreign.summary.kids.map((k) => k.storiesRead)).toEqual([4, 1]);
    });

    it('kidId filter queries only that kid (no user rows); foreign kidId is an empty page', async () => {
      await service.getReading('u1', { kidId: 'k2' });
      const arg = repo.findReadingPage.mock.calls[0][0];
      expect(arg.kidIds).toEqual(['k2']);
      expect(arg.includeUser).toBe(false);
      expect(repo.getReadingSummary.mock.calls[0][0].includeUser).toBe(false);

      repo.findReadingPage.mockClear();
      const res = await service.getReading('u1', { kidId: 'foreign' });
      expect(repo.findReadingPage).not.toHaveBeenCalled();
      expect(res.data).toEqual([]);
      expect(res.meta.total).toBe(0);
      expect(res.summary).toEqual({
        storiesRead: 0,
        storiesCompleted: 0,
        totalTimeSpentSeconds: 0,
        lastActiveAt: null,
        kids: [
          { kidId: 'k1', name: 'Alpha', storiesRead: 0 },
          { kidId: 'k2', name: null, storiesRead: 0 },
        ],
      });
    });
  });
});

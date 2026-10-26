import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  IAdminUserHistoryRepository,
  ReaderAggregate,
  UserActivityPageParams,
  UserActivityRow,
  UserHistoryKid,
  UserReadingFilter,
  UserReadingPageParams,
  UserReadingRow,
  UserReadingSummaryRaw,
} from './admin-user-history.repository.interface';

const EMPTY_AGGREGATE: ReaderAggregate = {
  storiesRead: 0,
  storiesCompleted: 0,
  totalTimeSpentSeconds: 0,
  lastActiveAt: null,
};

function dateWindow(
  start?: Date,
  end?: Date,
): Prisma.DateTimeFilter | undefined {
  if (!start && !end) return undefined;
  return { ...(start ? { gte: start } : {}), ...(end ? { lte: end } : {}) };
}

@Injectable()
export class PrismaAdminUserHistoryRepository implements IAdminUserHistoryRepository {
  constructor(private readonly prisma: PrismaService) {}

  findActiveUser(userId: string): Promise<{ id: string } | null> {
    return this.prisma.user.findFirst({
      where: { id: userId, isDeleted: false },
      select: { id: true },
    });
  }

  findKids(userId: string): Promise<UserHistoryKid[]> {
    return this.prisma.kid.findMany({
      where: { parentId: userId, isDeleted: false },
      select: { id: true, name: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }

  async findActivityPage(
    params: UserActivityPageParams,
  ): Promise<{ rows: UserActivityRow[]; total: number }> {
    const { userId, kidIds, includeUserOwn, action, from, to, skip, take } =
      params;

    // Only rows that belong to this user (their own, with no kid attached) or
    // to one of THEIR kids. A row that names this user but a kid of someone
    // else is deliberately excluded, as are rows of soft-deleted kids (they
    // are not in `kidIds`).
    const owners: Prisma.ActivityLogWhereInput[] = [];
    if (includeUserOwn) owners.push({ userId, kidId: null });
    if (kidIds.length > 0) owners.push({ kidId: { in: kidIds } });
    if (owners.length === 0) return { rows: [], total: 0 };

    const where: Prisma.ActivityLogWhereInput = {
      isDeleted: false,
      OR: owners,
      ...(action ? { action } : {}),
      ...(from || to ? { createdAt: dateWindow(from, to) } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.activityLog.findMany({
        where,
        select: {
          id: true,
          action: true,
          createdAt: true,
          kidId: true,
          details: true,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take,
      }),
      this.prisma.activityLog.count({ where }),
    ]);
    return { rows, total };
  }

  async findStoryTitles(storyIds: string[]): Promise<Map<string, string>> {
    if (storyIds.length === 0) return new Map();
    const stories = await this.prisma.story.findMany({
      where: { id: { in: storyIds }, isDeleted: false },
      select: { id: true, title: true },
    });
    return new Map(stories.map((s) => [s.id, s.title]));
  }

  private userProgressWhere(
    f: UserReadingFilter,
  ): Prisma.UserStoryProgressWhereInput {
    return {
      userId: f.userId,
      isDeleted: false,
      story: { isDeleted: false },
      lastAccessed: dateWindow(f.start, f.end),
    };
  }

  private kidProgressWhere(
    f: UserReadingFilter,
  ): Prisma.StoryProgressWhereInput {
    return {
      kidId: { in: f.kidIds },
      isDeleted: false,
      story: { isDeleted: false },
      kid: { isDeleted: false },
      lastAccessed: dateWindow(f.start, f.end),
    };
  }

  async findReadingPage(
    params: UserReadingPageParams,
  ): Promise<{ rows: UserReadingRow[]; total: number }> {
    const { includeUser, kidIds, skip, take } = params;
    const upTo = skip + take;
    const orderBy = [
      { lastAccessed: 'desc' as const },
      { id: 'desc' as const },
    ];
    const storySelect = { select: { id: true, title: true } };

    const [userRows, userTotal, kidRows, kidTotal] = await Promise.all([
      includeUser
        ? this.prisma.userStoryProgress.findMany({
            where: this.userProgressWhere(params),
            include: { story: storySelect },
            orderBy,
            take: upTo,
          })
        : [],
      includeUser
        ? this.prisma.userStoryProgress.count({
            where: this.userProgressWhere(params),
          })
        : 0,
      kidIds.length > 0
        ? this.prisma.storyProgress.findMany({
            where: this.kidProgressWhere(params),
            include: { story: storySelect },
            orderBy,
            take: upTo,
          })
        : [],
      kidIds.length > 0
        ? this.prisma.storyProgress.count({
            where: this.kidProgressWhere(params),
          })
        : 0,
    ]);

    // Each source is already ordered newest-first and truncated to the first
    // `skip + take` rows, so the merged top `skip + take` is exact.
    const merged: Array<{ id: string; row: UserReadingRow }> = [
      ...userRows.map((r) => ({
        id: r.id,
        row: {
          storyId: r.storyId,
          title: r.story.title,
          readerType: 'user' as const,
          kidId: null,
          progress: r.progress,
          completed: r.completed,
          totalTimeSpentSeconds: r.totalTimeSpent,
          lastAccessed: r.lastAccessed,
        },
      })),
      ...kidRows.map((r) => ({
        id: r.id,
        row: {
          storyId: r.storyId,
          title: r.story.title,
          readerType: 'kid' as const,
          kidId: r.kidId,
          progress: r.progress,
          completed: r.completed,
          totalTimeSpentSeconds: r.totalTimeSpent,
          lastAccessed: r.lastAccessed,
        },
      })),
    ].sort(
      (a, b) =>
        b.row.lastAccessed.getTime() - a.row.lastAccessed.getTime() ||
        (a.id < b.id ? 1 : a.id > b.id ? -1 : 0),
    );

    return {
      rows: merged.slice(skip, upTo).map((m) => m.row),
      total: userTotal + kidTotal,
    };
  }

  async getReadingSummary(
    filter: UserReadingFilter,
  ): Promise<UserReadingSummaryRaw> {
    const userPromise = filter.includeUser
      ? this.prisma.userStoryProgress
          .groupBy({
            by: ['completed'],
            where: this.userProgressWhere(filter),
            _count: { _all: true },
            _sum: { totalTimeSpent: true },
            _max: { lastAccessed: true },
          })
          .then((groups) => foldGroups(groups))
      : Promise.resolve({ ...EMPTY_AGGREGATE });

    const kidsPromise =
      filter.kidIds.length > 0
        ? this.prisma.storyProgress.groupBy({
            by: ['kidId', 'completed'],
            where: this.kidProgressWhere(filter),
            _count: { _all: true },
            _sum: { totalTimeSpent: true },
            _max: { lastAccessed: true },
          })
        : Promise.resolve([]);

    const [user, kidGroups] = await Promise.all([userPromise, kidsPromise]);

    const byKid = new Map<string, typeof kidGroups>();
    for (const g of kidGroups) {
      byKid.set(g.kidId, [...(byKid.get(g.kidId) ?? []), g]);
    }
    const kids = [...byKid.entries()].map(([kidId, groups]) => ({
      kidId,
      ...foldGroups(groups),
    }));

    return { user, kids };
  }
}

function foldGroups(
  groups: Array<{
    completed: boolean;
    _count: { _all: number };
    _sum: { totalTimeSpent: number | null };
    _max: { lastAccessed: Date | null };
  }>,
): ReaderAggregate {
  let storiesRead = 0;
  let storiesCompleted = 0;
  let totalTimeSpentSeconds = 0;
  let lastActiveAt: Date | null = null;
  for (const g of groups) {
    storiesRead += g._count._all;
    if (g.completed) storiesCompleted += g._count._all;
    totalTimeSpentSeconds += g._sum.totalTimeSpent ?? 0;
    const max = g._max.lastAccessed;
    if (max && (!lastActiveAt || max > lastActiveAt)) lastActiveAt = max;
  }
  return { storiesRead, storiesCompleted, totalTimeSpentSeconds, lastActiveAt };
}

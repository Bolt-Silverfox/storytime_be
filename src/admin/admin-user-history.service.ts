import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  ADMIN_USER_HISTORY_REPOSITORY,
  IAdminUserHistoryRepository,
  ReaderAggregate,
  UserHistoryKid,
} from './repositories';
import {
  UserActivityQueryDto,
  UserReadingQueryDto,
  resolveActivityWindow,
  resolveReadingWindow,
} from './dto/admin-user-history.dto';
import {
  extractStoryId,
  sanitizeActivityDetails,
} from './utils/activity-details.sanitizer';

export interface PageMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface UserActivityItem {
  id: string;
  action: string;
  createdAt: string;
  kidId: string | null;
  kidName: string | null;
  storyId: string | null;
  storyTitle: string | null;
  details: Record<string, unknown> | null;
}

export interface UserReadingItem {
  storyId: string;
  title: string;
  readerType: 'user' | 'kid';
  kidId: string | null;
  kidName: string | null;
  /** Percentage 0-100 as stored by the progress endpoints. */
  progress: number;
  completed: boolean;
  totalTimeSpentSeconds: number;
  lastAccessed: string;
}

export interface UserReadingSummary {
  storiesRead: number;
  storiesCompleted: number;
  totalTimeSpentSeconds: number;
  lastActiveAt: string | null;
  kids: Array<{ kidId: string; name: string | null; storiesRead: number }>;
}

const buildMeta = (total: number, page: number, limit: number): PageMeta => ({
  total,
  page,
  limit,
  totalPages: Math.ceil(total / limit),
});

@Injectable()
export class AdminUserHistoryService {
  constructor(
    @Inject(ADMIN_USER_HISTORY_REPOSITORY)
    private readonly repo: IAdminUserHistoryRepository,
  ) {}

  private async loadUserKids(userId: string): Promise<UserHistoryKid[]> {
    const user = await this.repo.findActiveUser(userId);
    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }
    return this.repo.findKids(userId);
  }

  /**
   * Which readers a request covers. `kidId` narrows to one of THIS user's
   * kids; an id that is not theirs matches nothing (never another family's
   * data), signalled by `kidIds: []` + `includeUser: false`.
   */
  private scope(kids: UserHistoryKid[], kidId?: string) {
    if (!kidId) return { kidIds: kids.map((k) => k.id), includeUser: true };
    return kids.some((k) => k.id === kidId)
      ? { kidIds: [kidId], includeUser: false }
      : { kidIds: [], includeUser: false };
  }

  async getActivity(userId: string, query: Partial<UserActivityQueryDto>) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const { from, to } = resolveActivityWindow(query);

    const kids = await this.loadUserKids(userId);
    const { kidIds, includeUser } = this.scope(kids, query.kidId);
    if (kidIds.length === 0 && !includeUser) {
      return {
        data: [] as UserActivityItem[],
        meta: buildMeta(0, page, limit),
      };
    }

    const { rows, total } = await this.repo.findActivityPage({
      userId,
      kidIds,
      includeUserOwn: includeUser,
      action: query.action,
      from,
      to,
      skip: (page - 1) * limit,
      take: limit,
    });

    const sanitised = rows.map((r) => {
      const details = sanitizeActivityDetails(r.details);
      return { row: r, details, storyId: extractStoryId(details) };
    });
    const storyIds = [
      ...new Set(sanitised.flatMap((s) => (s.storyId ? [s.storyId] : []))),
    ];
    const titles = await this.repo.findStoryTitles(storyIds);
    const kidNames = new Map(kids.map((k) => [k.id, k.name]));

    const data: UserActivityItem[] = sanitised.map(
      ({ row, details, storyId }) => ({
        id: row.id,
        action: row.action,
        createdAt: row.createdAt.toISOString(),
        kidId: row.kidId,
        kidName: row.kidId ? (kidNames.get(row.kidId) ?? null) : null,
        storyId,
        storyTitle: storyId ? (titles.get(storyId) ?? null) : null,
        details,
      }),
    );
    return { data, meta: buildMeta(total, page, limit) };
  }

  async getReading(userId: string, query: Partial<UserReadingQueryDto>) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const { start, end } = resolveReadingWindow(query);

    const kids = await this.loadUserKids(userId);
    const { kidIds, includeUser } = this.scope(kids, query.kidId);
    const kidName = new Map(kids.map((k) => [k.id, k.name]));

    // The kid list always shows every kid (so the admin can switch child);
    // each count honours the date range but NOT the kidId filter. Only needed
    // as an extra query when a kidId narrows the main summary.
    const perKidCounts = (): Promise<Map<string, number>> =>
      this.repo
        .getReadingSummary({
          userId,
          kidIds: kids.map((k) => k.id),
          includeUser: false,
          start,
          end,
        })
        .then((r) => new Map(r.kids.map((k) => [k.kidId, k.storiesRead])));

    if (kidIds.length === 0 && !includeUser) {
      return {
        data: [] as UserReadingItem[],
        summary: this.buildSummary(
          kids,
          EMPTY_RAW,
          kids.length > 0 ? await perKidCounts() : undefined,
        ),
        meta: buildMeta(0, page, limit),
      };
    }

    const filter = { userId, kidIds, includeUser, start, end };
    const [{ rows, total }, rawSummary, allKidCounts] = await Promise.all([
      this.repo.findReadingPage({
        ...filter,
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.repo.getReadingSummary(filter),
      query.kidId && kids.length > 0 ? perKidCounts() : undefined,
    ]);

    const data: UserReadingItem[] = rows.map((r) => ({
      storyId: r.storyId,
      title: r.title,
      readerType: r.readerType,
      kidId: r.kidId,
      kidName: r.kidId ? (kidName.get(r.kidId) ?? null) : null,
      progress: r.progress,
      completed: r.completed,
      totalTimeSpentSeconds: r.totalTimeSpentSeconds,
      lastAccessed: r.lastAccessed.toISOString(),
    }));

    return {
      data,
      summary: this.buildSummary(kids, rawSummary, allKidCounts),
      meta: buildMeta(total, page, limit),
    };
  }

  /**
   * Privacy note: the 5-distinct-reader suppression used by the aggregate
   * reading analytics protects per-STORY stats that mix many users. This is a
   * per-USER view for an admin, so it does not apply here.
   *
   * `storiesRead` counts distinct (reader, story) pairs: progress rows are
   * unique per (user, story) and (kid, story), so a story read by both the
   * parent and a kid counts once for each reader.
   */
  private buildSummary(
    kids: UserHistoryKid[],
    raw: {
      user: ReaderAggregate;
      kids: Array<ReaderAggregate & { kidId: string }>;
    },
    kidCounts?: Map<string, number>,
  ): UserReadingSummary {
    const all = [raw.user, ...raw.kids];
    let lastActiveAt: Date | null = null;
    for (const a of all) {
      if (a.lastActiveAt && (!lastActiveAt || a.lastActiveAt > lastActiveAt)) {
        lastActiveAt = a.lastActiveAt;
      }
    }
    const perKid =
      kidCounts ?? new Map(raw.kids.map((k) => [k.kidId, k.storiesRead]));
    return {
      storiesRead: all.reduce((n, a) => n + a.storiesRead, 0),
      storiesCompleted: all.reduce((n, a) => n + a.storiesCompleted, 0),
      totalTimeSpentSeconds: all.reduce(
        (n, a) => n + a.totalTimeSpentSeconds,
        0,
      ),
      lastActiveAt: lastActiveAt ? lastActiveAt.toISOString() : null,
      kids: kids.map((k) => ({
        kidId: k.id,
        name: k.name,
        storiesRead: perKid.get(k.id) ?? 0,
      })),
    };
  }
}

const EMPTY_RAW = {
  user: {
    storiesRead: 0,
    storiesCompleted: 0,
    totalTimeSpentSeconds: 0,
    lastActiveAt: null,
  } as ReaderAggregate,
  kids: [] as Array<ReaderAggregate & { kidId: string }>,
};

# Reading Analytics (Backend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three admin endpoints (`top-stories`, `stories/:id`, `stories/:id/trend`) that report which stories are being read, with per-story reader counts suppressed below a privacy threshold.

**Architecture:** A new repository method set on the existing `IAdminEngagementRepository` does the aggregation (one raw-SQL query, everything else stays on Prisma's typed query builder); a new `AdminReadingAnalyticsService` applies the suppression rule and caches; a new `AdminReadingAnalyticsController` exposes the three routes under the existing `admin/` guard.

**Tech Stack:** NestJS 11, Prisma (PostgreSQL), `@nestjs/cache-manager`, Jest.

**Spec:** `docs/superpowers/specs/2026-10-22-reading-analytics-design.md`

## Global Constraints

- Reader counts/identities are suppressed when a story has fewer than 5 distinct readers (`StoryProgress.kidId` + `UserStoryProgress.userId`, unioned, deduplicated). This file calls that number `READER_SUPPRESSION_THRESHOLD`.
- Suppression is enforced in `AdminReadingAnalyticsService`, not the controller or repository — one place owns the rule.
- All new routes require the existing `@Admin()` guard (`AuthSessionGuard` + `AdminGuard`), same as every other `admin/*` route.
- The one `COUNT(DISTINCT ...)` union query uses `$queryRaw` with Prisma's tagged-template parameterization — never string concatenation.
- Real table/column names (confirmed from `prisma/schema.prisma` and migration SQL): `story_progress("storyId", "kidId", completed, "totalTimeSpent", "lastAccessed", "isDeleted")`, `user_story_progress("storyId", "userId", completed, "totalTimeSpent", "lastAccessed", "isDeleted")`, `users(id, name, email)`, `kids(id, name)`, `stories(id, title)`.

---

### Task 1: Repository — story reader stats aggregation

**Files:**
- Modify: `src/admin/repositories/admin-engagement.repository.interface.ts`
- Modify: `src/admin/repositories/prisma-admin-engagement.repository.ts`
- Test: `src/admin/repositories/prisma-admin-engagement.repository.spec.ts` (new file)

**Interfaces:**
- Produces:
  ```typescript
  export interface StoryReaderStats {
    storyId: string;
    distinctReaders: number;
    completedCount: number;
    avgTimeSpentSeconds: number;
  }

  export interface StoryReaderTrendPoint {
    date: string; // "YYYY-MM-DD"
    distinctReaders: number;
    completions: number;
  }

  export interface StoryReader {
    readerId: string;
    readerType: 'kid' | 'user';
    displayName: string;
    lastAccessed: Date;
  }
  ```
  Added to `IAdminEngagementRepository`:
  ```typescript
  getStoryReaderStats(range: { start: Date; end: Date }): Promise<StoryReaderStats[]>;
  getStoryReaderStatsForStory(storyId: string): Promise<StoryReaderStats | null>;
  getStoryReaderTrend(storyId: string, range: { start: Date; end: Date }): Promise<StoryReaderTrendPoint[]>;
  getStoryReaders(storyId: string): Promise<StoryReader[]>;
  ```

- [ ] **Step 1: Write the failing repository test**

This seeds real rows (not mocks) because the raw-SQL distinct-count union is the one place in this feature that's easy to get subtly wrong. Follow the existing integration-style pattern used by other `.spec.ts` files under `src/admin` that hit a real test database (check `src/admin/admin-system.service.spec.ts` for the `PrismaService` test setup if one isn't already running — if this repo's admin specs are pure-mock-only with no DB-backed spec precedent, use the shared `PrismaService` test module from `src/prisma/prisma.service.ts` directly against the configured test `DATABASE_URL`, creating and cleaning up rows in `beforeEach`/`afterEach`).

```typescript
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
    const kid1 = await prisma.kid.create({ data: { parentId: parent.id, name: 'Kid One' } });
    const kid2 = await prisma.kid.create({ data: { parentId: parent.id, name: 'Kid Two' } });
    kidIds = [kid1.id, kid2.id];
    userIds = [parent.id, parent2.id];

    // 2 distinct kid readers, one completed
    await prisma.storyProgress.create({
      data: { kidId: kid1.id, storyId, completed: true, totalTimeSpent: 120, lastAccessed: new Date() },
    });
    await prisma.storyProgress.create({
      data: { kidId: kid2.id, storyId, completed: false, totalTimeSpent: 60, lastAccessed: new Date() },
    });
    // 1 distinct direct-parent reader (parent2 reading without a kid profile)
    await prisma.userStoryProgress.create({
      data: { userId: parent2.id, storyId, completed: false, totalTimeSpent: 30, lastAccessed: new Date() },
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/admin/repositories/prisma-admin-engagement.repository.spec.ts -t "counts distinct"`
Expected: FAIL — `repo.getStoryReaderStats is not a function`

- [ ] **Step 3: Add the types and interface methods**

In `src/admin/repositories/admin-engagement.repository.interface.ts`, add above the existing `IAdminEngagementRepository` interface:

```typescript
export interface StoryReaderStats {
  storyId: string;
  distinctReaders: number;
  completedCount: number;
  avgTimeSpentSeconds: number;
}

export interface StoryReaderTrendPoint {
  date: string;
  distinctReaders: number;
  completions: number;
}

export interface StoryReader {
  readerId: string;
  readerType: 'kid' | 'user';
  displayName: string;
  lastAccessed: Date;
}
```

Add to the `IAdminEngagementRepository` interface body (after `getAverageSessionSeconds`):

```typescript
  getStoryReaderStats(range: {
    start: Date;
    end: Date;
  }): Promise<StoryReaderStats[]>;
  getStoryReaderStatsForStory(storyId: string): Promise<StoryReaderStats | null>;
  getStoryReaderTrend(
    storyId: string,
    range: { start: Date; end: Date },
  ): Promise<StoryReaderTrendPoint[]>;
  getStoryReaders(storyId: string): Promise<StoryReader[]>;
```

- [ ] **Step 4: Implement in the Prisma repository**

In `src/admin/repositories/prisma-admin-engagement.repository.ts`, add:

```typescript
  async getStoryReaderStats(range: {
    start: Date;
    end: Date;
  }): Promise<StoryReaderStats[]> {
    const rows = await this.prisma.$queryRaw<
      {
        story_id: string;
        kid_readers: bigint;
        user_readers: bigint;
        completed_count: bigint;
        avg_time_spent_seconds: number | null;
      }[]
    >(Prisma.sql`
      SELECT
        combined."storyId" AS story_id,
        COUNT(DISTINCT combined."kidReader") AS kid_readers,
        COUNT(DISTINCT combined."userReader") AS user_readers,
        SUM(CASE WHEN combined.completed THEN 1 ELSE 0 END) AS completed_count,
        AVG(combined."totalTimeSpent") AS avg_time_spent_seconds
      FROM (
        SELECT "storyId", "kidId" AS "kidReader", NULL::text AS "userReader", completed, "totalTimeSpent"
        FROM story_progress
        WHERE "isDeleted" = false AND "lastAccessed" BETWEEN ${range.start} AND ${range.end}
        UNION ALL
        SELECT "storyId", NULL::text AS "kidReader", "userId" AS "userReader", completed, "totalTimeSpent"
        FROM user_story_progress
        WHERE "isDeleted" = false AND "lastAccessed" BETWEEN ${range.start} AND ${range.end}
      ) combined
      GROUP BY combined."storyId"
    `);

    return rows.map((r) => ({
      storyId: r.story_id,
      distinctReaders: Number(r.kid_readers) + Number(r.user_readers),
      completedCount: Number(r.completed_count),
      avgTimeSpentSeconds: Number(r.avg_time_spent_seconds ?? 0),
    }));
  }

  async getStoryReaderStatsForStory(
    storyId: string,
  ): Promise<StoryReaderStats | null> {
    const rows = await this.prisma.$queryRaw<
      {
        kid_readers: bigint;
        user_readers: bigint;
        completed_count: bigint;
        avg_time_spent_seconds: number | null;
      }[]
    >(Prisma.sql`
      SELECT
        COUNT(DISTINCT combined."kidReader") AS kid_readers,
        COUNT(DISTINCT combined."userReader") AS user_readers,
        SUM(CASE WHEN combined.completed THEN 1 ELSE 0 END) AS completed_count,
        AVG(combined."totalTimeSpent") AS avg_time_spent_seconds
      FROM (
        SELECT "kidId" AS "kidReader", NULL::text AS "userReader", completed, "totalTimeSpent"
        FROM story_progress
        WHERE "isDeleted" = false AND "storyId" = ${storyId}
        UNION ALL
        SELECT NULL::text AS "kidReader", "userId" AS "userReader", completed, "totalTimeSpent"
        FROM user_story_progress
        WHERE "isDeleted" = false AND "storyId" = ${storyId}
      ) combined
    `);

    const r = rows[0];
    if (!r || (Number(r.kid_readers) === 0 && Number(r.user_readers) === 0)) {
      return null;
    }
    return {
      storyId,
      distinctReaders: Number(r.kid_readers) + Number(r.user_readers),
      completedCount: Number(r.completed_count),
      avgTimeSpentSeconds: Number(r.avg_time_spent_seconds ?? 0),
    };
  }

  async getStoryReaderTrend(
    storyId: string,
    range: { start: Date; end: Date },
  ): Promise<StoryReaderTrendPoint[]> {
    const rows = await this.prisma.$queryRaw<
      { day: Date; kid_readers: bigint; user_readers: bigint; completions: bigint }[]
    >(Prisma.sql`
      SELECT
        DATE_TRUNC('day', combined."lastAccessed")::date AS day,
        COUNT(DISTINCT combined."kidReader") AS kid_readers,
        COUNT(DISTINCT combined."userReader") AS user_readers,
        SUM(CASE WHEN combined.completed THEN 1 ELSE 0 END) AS completions
      FROM (
        SELECT "kidId" AS "kidReader", NULL::text AS "userReader", completed, "lastAccessed"
        FROM story_progress
        WHERE "isDeleted" = false AND "storyId" = ${storyId}
          AND "lastAccessed" BETWEEN ${range.start} AND ${range.end}
        UNION ALL
        SELECT NULL::text AS "kidReader", "userId" AS "userReader", completed, "lastAccessed"
        FROM user_story_progress
        WHERE "isDeleted" = false AND "storyId" = ${storyId}
          AND "lastAccessed" BETWEEN ${range.start} AND ${range.end}
      ) combined
      GROUP BY day
      ORDER BY day ASC
    `);

    return rows.map((r) => ({
      date: r.day.toISOString().slice(0, 10),
      distinctReaders: Number(r.kid_readers) + Number(r.user_readers),
      completions: Number(r.completions),
    }));
  }

  async getStoryReaders(storyId: string): Promise<StoryReader[]> {
    const rows = await this.prisma.$queryRaw<
      {
        reader_id: string;
        reader_type: 'kid' | 'user';
        display_name: string | null;
        last_accessed: Date;
      }[]
    >(Prisma.sql`
      SELECT sp."kidId" AS reader_id, 'kid' AS reader_type, k.name AS display_name, sp."lastAccessed" AS last_accessed
      FROM story_progress sp
      JOIN kids k ON k.id = sp."kidId"
      WHERE sp."storyId" = ${storyId} AND sp."isDeleted" = false
      UNION ALL
      SELECT usp."userId" AS reader_id, 'user' AS reader_type, u.name AS display_name, usp."lastAccessed" AS last_accessed
      FROM user_story_progress usp
      JOIN users u ON u.id = usp."userId"
      WHERE usp."storyId" = ${storyId} AND usp."isDeleted" = false
      ORDER BY last_accessed DESC
    `);

    return rows.map((r) => ({
      readerId: r.reader_id,
      readerType: r.reader_type,
      displayName: r.display_name ?? 'Unnamed',
      lastAccessed: r.last_accessed,
    }));
  }
```

Add `StoryReaderStats`, `StoryReaderTrendPoint`, `StoryReader` to the import from `./admin-engagement.repository.interface` at the top of this file.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest src/admin/repositories/prisma-admin-engagement.repository.spec.ts`
Expected: PASS (both tests)

- [ ] **Step 6: Commit**

```bash
git add src/admin/repositories/admin-engagement.repository.interface.ts src/admin/repositories/prisma-admin-engagement.repository.ts src/admin/repositories/prisma-admin-engagement.repository.spec.ts
git commit -m "feat(admin): add story reader stats aggregation to engagement repository"
```

---

### Task 2: Repository — story titles by id

**Files:**
- Modify: `src/admin/repositories/admin-story.repository.interface.ts`
- Modify: `src/admin/repositories/prisma-admin-story.repository.ts`
- Test: `src/admin/repositories/prisma-admin-story.repository.find-titles.spec.ts` (new file)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces:
  ```typescript
  findTitlesByIds(storyIds: string[]): Promise<{ id: string; title: string }[]>;
  ```
  Task 3 (service) calls this to attach titles to the reader-stats rows from Task 1, which only carry `storyId`.

- [ ] **Step 1: Write the failing test**

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { PrismaAdminStoryRepository } from './prisma-admin-story.repository';

describe('PrismaAdminStoryRepository.findTitlesByIds', () => {
  let prisma: PrismaService;
  let repo: PrismaAdminStoryRepository;
  let storyIds: string[];

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PrismaService, PrismaAdminStoryRepository],
    }).compile();
    prisma = module.get(PrismaService);
    repo = module.get(PrismaAdminStoryRepository);

    const base = {
      description: 'd',
      language: 'en',
      coverImageUrl: 'x',
      audioUrl: 'x',
      isInteractive: false,
      ageMin: 3,
      ageMax: 6,
    };
    const a = await prisma.story.create({ data: { ...base, title: 'Story A' } });
    const b = await prisma.story.create({ data: { ...base, title: 'Story B' } });
    storyIds = [a.id, b.id];
  });

  afterEach(async () => {
    await prisma.story.deleteMany({ where: { id: { in: storyIds } } });
  });

  it('returns id and title pairs for the requested ids, in any order', async () => {
    const result = await repo.findTitlesByIds(storyIds);
    const titles = result.map((r) => r.title).sort();
    expect(titles).toEqual(['Story A', 'Story B']);
  });

  it('returns an empty array for an empty input', async () => {
    const result = await repo.findTitlesByIds([]);
    expect(result).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/admin/repositories/prisma-admin-story.repository.find-titles.spec.ts`
Expected: FAIL — `repo.findTitlesByIds is not a function`

- [ ] **Step 3: Add to the interface**

In `src/admin/repositories/admin-story.repository.interface.ts`, add to `IAdminStoryRepository` (after `findStoryBasicById`):

```typescript
  // Lightweight title lookup for cross-referencing story ids returned by
  // another repository's aggregate query (e.g. reading-analytics stats).
  findTitlesByIds(storyIds: string[]): Promise<{ id: string; title: string }[]>;
```

- [ ] **Step 4: Implement**

In `src/admin/repositories/prisma-admin-story.repository.ts`, add:

```typescript
  async findTitlesByIds(
    storyIds: string[],
  ): Promise<{ id: string; title: string }[]> {
    if (storyIds.length === 0) return [];
    return this.prisma.story.findMany({
      where: { id: { in: storyIds } },
      select: { id: true, title: true },
    });
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest src/admin/repositories/prisma-admin-story.repository.find-titles.spec.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/admin/repositories/admin-story.repository.interface.ts src/admin/repositories/prisma-admin-story.repository.ts src/admin/repositories/prisma-admin-story.repository.find-titles.spec.ts
git commit -m "feat(admin): add findTitlesByIds to story repository"
```

---

### Task 3: DTOs for reading analytics

**Files:**
- Create: `src/admin/dto/reading-analytics.dto.ts`

**Interfaces:**
- Consumes: nothing (pure types + validation).
- Produces: `ReadingAnalyticsRangeDto`, `TopStoryDto`, `StoryDetailDto`, `ReaderDto`, `TrendPointDto` — used by Task 4 (service) and Task 5 (controller).

- [ ] **Step 1: Write the DTO file**

No test — this is pure declarative validation/typing, exercised indirectly by Task 4's and Task 5's tests.

```typescript
import { IsIn, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';

export class ReadingAnalyticsRangeDto {
  @ApiPropertyOptional({ enum: [7, 30, 90], default: 30 })
  @IsOptional()
  @Type(() => Number)
  @IsIn([7, 30, 90])
  range?: 7 | 30 | 90 = 30;
}

export class TopStoryDto {
  @ApiProperty() storyId: string;
  @ApiProperty() title: string;
  @ApiProperty({ nullable: true, description: 'null when fewer than 5 distinct readers (privacy suppression)' })
  readerCount: number | null;
  @ApiProperty() completionRate: number;
}

export class TrendPointDto {
  @ApiProperty() date: string;
  @ApiProperty() distinctReaders: number;
  @ApiProperty() completions: number;
}

export class ReaderDto {
  @ApiProperty() readerId: string;
  @ApiProperty({ enum: ['kid', 'user'] }) readerType: 'kid' | 'user';
  @ApiProperty() displayName: string;
  @ApiProperty() lastAccessed: Date;
}

export class StoryDetailDto {
  @ApiProperty() storyId: string;
  @ApiProperty() title: string;
  @ApiProperty({ nullable: true }) readerCount: number | null;
  @ApiProperty() completionRate: number;
  @ApiProperty() avgTimeSpentSeconds: number;
  @ApiProperty({ type: [TrendPointDto] }) trend: TrendPointDto[];
  @ApiProperty({ type: [ReaderDto] }) readers: ReaderDto[];
  @ApiProperty() readersSuppressed: boolean;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/admin/dto/reading-analytics.dto.ts
git commit -m "feat(admin): add reading analytics DTOs"
```

---

### Task 4: `AdminReadingAnalyticsService`

**Files:**
- Create: `src/admin/admin-reading-analytics.service.ts`
- Test: `src/admin/admin-reading-analytics.service.spec.ts`
- Modify: `src/shared/constants/cache-keys.constants.ts`

**Interfaces:**
- Consumes:
  - `IAdminEngagementRepository.getStoryReaderStats/getStoryReaderStatsForStory/getStoryReaderTrend/getStoryReaders` (Task 1)
  - `IAdminStoryRepository.findTitlesByIds` (Task 2)
  - `ReadingAnalyticsRangeDto`, `TopStoryDto`, `StoryDetailDto`, `ReaderDto`, `TrendPointDto` (Task 3)
- Produces:
  ```typescript
  class AdminReadingAnalyticsService {
    getTopStories(range: ReadingAnalyticsRangeDto): Promise<TopStoryDto[]>;
    getStoryDetail(storyId: string, range: ReadingAnalyticsRangeDto): Promise<StoryDetailDto | null>;
    getStoryTrend(storyId: string, range: ReadingAnalyticsRangeDto): Promise<TrendPointDto[]>;
  }
  ```
  Task 5 (controller) injects and calls this service.

- [ ] **Step 1: Add cache keys**

In `src/shared/constants/cache-keys.constants.ts`, add inside `CACHE_KEYS` (after `GUEST_STATS`):

```typescript
  READING_ANALYTICS_TOP_STORIES: (range: number) =>
    `admin:reading-analytics:top-stories:${range}`,
```

(Per-story detail and trend are not cached — see spec's "Caching" section.)

- [ ] **Step 2: Write the failing test**

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { AdminReadingAnalyticsService } from './admin-reading-analytics.service';
import {
  ADMIN_ENGAGEMENT_REPOSITORY,
  ADMIN_STORY_REPOSITORY,
} from './repositories';

describe('AdminReadingAnalyticsService', () => {
  let service: AdminReadingAnalyticsService;
  const getStoryReaderStats = jest.fn();
  const getStoryReaderStatsForStory = jest.fn();
  const getStoryReaderTrend = jest.fn();
  const getStoryReaders = jest.fn();
  const findTitlesByIds = jest.fn();

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminReadingAnalyticsService,
        {
          provide: ADMIN_ENGAGEMENT_REPOSITORY,
          useValue: {
            getStoryReaderStats,
            getStoryReaderStatsForStory,
            getStoryReaderTrend,
            getStoryReaders,
          },
        },
        { provide: ADMIN_STORY_REPOSITORY, useValue: { findTitlesByIds } },
        {
          provide: CACHE_MANAGER,
          useValue: { get: jest.fn().mockResolvedValue(null), set: jest.fn() },
        },
      ],
    }).compile();
    service = module.get(AdminReadingAnalyticsService);
  });

  it('suppresses readerCount to null for stories under the 5-reader threshold', async () => {
    getStoryReaderStats.mockResolvedValue([
      { storyId: 's1', distinctReaders: 4, completedCount: 1, avgTimeSpentSeconds: 10 },
      { storyId: 's2', distinctReaders: 5, completedCount: 2, avgTimeSpentSeconds: 20 },
    ]);
    findTitlesByIds.mockResolvedValue([
      { id: 's1', title: 'Below Threshold' },
      { id: 's2', title: 'At Threshold' },
    ]);

    const result = await service.getTopStories({ range: 30 });

    const below = result.find((r) => r.storyId === 's1');
    const at = result.find((r) => r.storyId === 's2');
    expect(below!.readerCount).toBeNull();
    expect(at!.readerCount).toBe(5);
  });

  it('sorts suppressed rows to the bottom regardless of their real count', async () => {
    getStoryReaderStats.mockResolvedValue([
      { storyId: 's1', distinctReaders: 4, completedCount: 0, avgTimeSpentSeconds: 0 },
      { storyId: 's2', distinctReaders: 50, completedCount: 0, avgTimeSpentSeconds: 0 },
      { storyId: 's3', distinctReaders: 1, completedCount: 0, avgTimeSpentSeconds: 0 },
    ]);
    findTitlesByIds.mockResolvedValue([
      { id: 's1', title: 'A' },
      { id: 's2', title: 'B' },
      { id: 's3', title: 'C' },
    ]);

    const result = await service.getTopStories({ range: 30 });

    expect(result[0].storyId).toBe('s2'); // only non-suppressed row, must be first
    expect(result.slice(1).map((r) => r.readerCount)).toEqual([null, null]);
  });

  it('suppresses the reader list on story detail when total distinct readers is under 5', async () => {
    getStoryReaderStatsForStory.mockResolvedValue({
      storyId: 's1',
      distinctReaders: 3,
      completedCount: 1,
      avgTimeSpentSeconds: 15,
    });
    findTitlesByIds.mockResolvedValue([{ id: 's1', title: 'Story' }]);
    getStoryReaderTrend.mockResolvedValue([]);

    const detail = await service.getStoryDetail('s1', { range: 30 });

    expect(detail!.readersSuppressed).toBe(true);
    expect(detail!.readers).toEqual([]);
    expect(getStoryReaders).not.toHaveBeenCalled();
  });

  it('includes the real reader list on story detail at/above the threshold', async () => {
    getStoryReaderStatsForStory.mockResolvedValue({
      storyId: 's1',
      distinctReaders: 5,
      completedCount: 1,
      avgTimeSpentSeconds: 15,
    });
    findTitlesByIds.mockResolvedValue([{ id: 's1', title: 'Story' }]);
    getStoryReaderTrend.mockResolvedValue([]);
    getStoryReaders.mockResolvedValue([
      { readerId: 'k1', readerType: 'kid', displayName: 'Kid One', lastAccessed: new Date() },
    ]);

    const detail = await service.getStoryDetail('s1', { range: 30 });

    expect(detail!.readersSuppressed).toBe(false);
    expect(detail!.readers).toHaveLength(1);
  });

  it('returns null from getStoryDetail when the story has no reading activity', async () => {
    getStoryReaderStatsForStory.mockResolvedValue(null);

    const detail = await service.getStoryDetail('missing', { range: 30 });

    expect(detail).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx jest src/admin/admin-reading-analytics.service.spec.ts`
Expected: FAIL — module can't find `./admin-reading-analytics.service`

- [ ] **Step 4: Implement the service**

```typescript
import { Inject, Injectable } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import {
  ADMIN_ENGAGEMENT_REPOSITORY,
  IAdminEngagementRepository,
  ADMIN_STORY_REPOSITORY,
  IAdminStoryRepository,
} from './repositories';
import { CACHE_KEYS, CACHE_TTL_MS } from '@/shared/constants/cache-keys.constants';
import {
  ReadingAnalyticsRangeDto,
  TopStoryDto,
  StoryDetailDto,
} from './dto/reading-analytics.dto';

const READER_SUPPRESSION_THRESHOLD = 5;

function rangeToDates(range: ReadingAnalyticsRangeDto): { start: Date; end: Date } {
  const end = new Date();
  const start = new Date(end.getTime() - (range.range ?? 30) * 24 * 60 * 60 * 1000);
  return { start, end };
}

@Injectable()
export class AdminReadingAnalyticsService {
  constructor(
    @Inject(ADMIN_ENGAGEMENT_REPOSITORY)
    private readonly engagementRepo: IAdminEngagementRepository,
    @Inject(ADMIN_STORY_REPOSITORY)
    private readonly storyRepo: IAdminStoryRepository,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {}

  async getTopStories(range: ReadingAnalyticsRangeDto): Promise<TopStoryDto[]> {
    const cacheKey = CACHE_KEYS.READING_ANALYTICS_TOP_STORIES(range.range ?? 30);
    const cached = await this.cacheManager.get<TopStoryDto[]>(cacheKey);
    if (cached) return cached;

    const stats = await this.engagementRepo.getStoryReaderStats(rangeToDates(range));
    const titles = await this.storyRepo.findTitlesByIds(stats.map((s) => s.storyId));
    const titleById = new Map(titles.map((t) => [t.id, t.title]));

    const result = stats
      .map((s) => ({
        storyId: s.storyId,
        title: titleById.get(s.storyId) ?? 'Unknown story',
        readerCount:
          s.distinctReaders >= READER_SUPPRESSION_THRESHOLD ? s.distinctReaders : null,
        completionRate: s.distinctReaders > 0 ? s.completedCount / s.distinctReaders : 0,
      }))
      .sort((a, b) => (b.readerCount ?? 0) - (a.readerCount ?? 0));

    await this.cacheManager.set(cacheKey, result, CACHE_TTL_MS.DASHBOARD);
    return result;
  }

  async getStoryDetail(
    storyId: string,
    range: ReadingAnalyticsRangeDto,
  ): Promise<StoryDetailDto | null> {
    const stats = await this.engagementRepo.getStoryReaderStatsForStory(storyId);
    if (!stats) return null;

    const titles = await this.storyRepo.findTitlesByIds([storyId]);
    const title = titles[0]?.title ?? 'Unknown story';
    const trend = await this.engagementRepo.getStoryReaderTrend(storyId, rangeToDates(range));

    const suppressed = stats.distinctReaders < READER_SUPPRESSION_THRESHOLD;
    const readers = suppressed ? [] : await this.engagementRepo.getStoryReaders(storyId);

    return {
      storyId,
      title,
      readerCount: suppressed ? null : stats.distinctReaders,
      completionRate: stats.distinctReaders > 0 ? stats.completedCount / stats.distinctReaders : 0,
      avgTimeSpentSeconds: stats.avgTimeSpentSeconds,
      trend,
      readers,
      readersSuppressed: suppressed,
    };
  }

  async getStoryTrend(storyId: string, range: ReadingAnalyticsRangeDto) {
    return this.engagementRepo.getStoryReaderTrend(storyId, rangeToDates(range));
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest src/admin/admin-reading-analytics.service.spec.ts`
Expected: PASS (all 5 tests)

- [ ] **Step 6: Commit**

```bash
git add src/admin/admin-reading-analytics.service.ts src/admin/admin-reading-analytics.service.spec.ts src/shared/constants/cache-keys.constants.ts
git commit -m "feat(admin): add AdminReadingAnalyticsService with 5-reader suppression"
```

---

### Task 5: `AdminReadingAnalyticsController` + module wiring

**Files:**
- Create: `src/admin/admin-reading-analytics.controller.ts`
- Modify: `src/admin/admin.module.ts`
- Test: `src/admin/admin-reading-analytics.controller.spec.ts`

**Interfaces:**
- Consumes: `AdminReadingAnalyticsService` (Task 4).
- Produces: the three HTTP routes the frontend plan calls.

- [ ] **Step 1: Write the failing test**

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { AdminReadingAnalyticsController } from './admin-reading-analytics.controller';
import { AdminReadingAnalyticsService } from './admin-reading-analytics.service';

describe('AdminReadingAnalyticsController', () => {
  let controller: AdminReadingAnalyticsController;
  const getTopStories = jest.fn();
  const getStoryDetail = jest.fn();
  const getStoryTrend = jest.fn();

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminReadingAnalyticsController],
      providers: [
        {
          provide: AdminReadingAnalyticsService,
          useValue: { getTopStories, getStoryDetail, getStoryTrend },
        },
      ],
    }).compile();
    controller = module.get(AdminReadingAnalyticsController);
  });

  it('getTopStories delegates to the service with the parsed range', async () => {
    getTopStories.mockResolvedValue([]);
    await controller.getTopStories({ range: 7 });
    expect(getTopStories).toHaveBeenCalledWith({ range: 7 });
  });

  it('getStoryDetail delegates with the story id and range', async () => {
    getStoryDetail.mockResolvedValue({ storyId: 's1' });
    const result = await controller.getStoryDetail('s1', { range: 30 });
    expect(getStoryDetail).toHaveBeenCalledWith('s1', { range: 30 });
    expect(result.data.storyId).toBe('s1');
  });

  it('getStoryTrend delegates with the story id and range', async () => {
    getStoryTrend.mockResolvedValue([]);
    await controller.getStoryTrend('s1', { range: 90 });
    expect(getStoryTrend).toHaveBeenCalledWith('s1', { range: 90 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/admin/admin-reading-analytics.controller.spec.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the controller**

Follows the existing `{ statusCode, message, data }` envelope used by `AdminDashboardController.getDashboardStats` (seen in the existing codebase).

```typescript
import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Admin } from './decorators/admin.decorator';
import { AdminReadingAnalyticsService } from './admin-reading-analytics.service';
import { ReadingAnalyticsRangeDto } from './dto/reading-analytics.dto';

@ApiBearerAuth()
@Controller('admin/reading-analytics')
@Admin()
@ApiTags('admin')
export class AdminReadingAnalyticsController {
  constructor(private readonly service: AdminReadingAnalyticsService) {}

  @Get('top-stories')
  @ApiOperation({ summary: 'Top stories by distinct readers, 5-reader minimum to show a count' })
  async getTopStories(@Query() range: ReadingAnalyticsRangeDto) {
    const data = await this.service.getTopStories(range);
    return { statusCode: 200, message: 'Top stories retrieved successfully', data };
  }

  @Get('stories/:storyId')
  @ApiOperation({ summary: 'Reading stats and reader list for one story' })
  async getStoryDetail(
    @Param('storyId') storyId: string,
    @Query() range: ReadingAnalyticsRangeDto,
  ) {
    const data = await this.service.getStoryDetail(storyId, range);
    return { statusCode: 200, message: 'Story reading detail retrieved successfully', data };
  }

  @Get('stories/:storyId/trend')
  @ApiOperation({ summary: 'Reading trend series for one story' })
  async getStoryTrend(
    @Param('storyId') storyId: string,
    @Query() range: ReadingAnalyticsRangeDto,
  ) {
    const data = await this.service.getStoryTrend(storyId, range);
    return { statusCode: 200, message: 'Story reading trend retrieved successfully', data };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/admin/admin-reading-analytics.controller.spec.ts`
Expected: PASS

- [ ] **Step 5: Wire into `admin.module.ts`**

Add import:
```typescript
import { AdminReadingAnalyticsController } from './admin-reading-analytics.controller';
import { AdminReadingAnalyticsService } from './admin-reading-analytics.service';
```
Add `AdminReadingAnalyticsController` to the `controllers` array (after `AdminSupportController`).
Add `AdminReadingAnalyticsService` to the `providers` array (after `AdminGuestAnalyticsService`).

- [ ] **Step 6: Build and run the full admin test suite**

Run: `pnpm build && npx jest src/admin`
Expected: PASS, no TypeScript errors

- [ ] **Step 7: Commit**

```bash
git add src/admin/admin-reading-analytics.controller.ts src/admin/admin-reading-analytics.controller.spec.ts src/admin/admin.module.ts
git commit -m "feat(admin): wire reading analytics endpoints into admin module"
```

---

## Self-Review Notes

- **Spec coverage:** suppression threshold (Task 4 tests the boundary at 4 vs 5), raw-SQL distinct-reader union (Task 1, real-DB test), three endpoints (Task 5), caching (Task 4 step 1 + service), reader-list suppression on drill-down (Task 4 tests) — all covered.
- **Type consistency:** `StoryReaderStats`/`StoryReaderTrendPoint`/`StoryReader` (Task 1) flow unchanged into `AdminReadingAnalyticsService` (Task 4); `TopStoryDto`/`StoryDetailDto` (Task 3) are what the controller (Task 5) returns — checked consistent across tasks. `CACHE_TTL_MS.DASHBOARD` confirmed as the existing 5-minute constant in `src/shared/constants/cache-keys.constants.ts:42`.

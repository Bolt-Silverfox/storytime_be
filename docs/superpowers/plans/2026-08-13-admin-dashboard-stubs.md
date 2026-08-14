# Admin Dashboard Stubs (`draftStories` + `avgSessionTime`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace two hardcoded admin-dashboard stubs with real data: `draftStories` (via a new `Story.isPublished` flag) and `averageSessionTime` (via a new `Session.lastActivityAt` timestamp).

**Architecture:** Two independent, additive features. Feature 1 adds a boolean `Story.isPublished` (default `true`), surfaces it to admins (filter + toggle + counts), and filters it out of every public read path so drafts never reach kids/parents. Feature 2 adds `Session.lastActivityAt`, bumped throttled in the auth guard, and averages `lastActivityAt − createdAt` over a 30-day window for the dashboard.

**Tech Stack:** NestJS 11, Prisma 6 (PostgreSQL), Jest, pnpm.

## Global Constraints

- **Shared DB:** `DATABASE_URL` points at the shared prod/dev RDS. **NEVER run `prisma migrate dev`.** Migrations are hand-authored SQL files under `prisma/migrations/`, applied by the deploy pipeline via `db:migrate:deploy`.
- **Migrations are additive & safe:** bool `NOT NULL DEFAULT true`; nullable timestamp. Both are metadata-only ALTERs (no table rewrite).
- **Public vs admin filtering rule:** public read paths filter `isPublished: true`; admin repositories and a kid's own-created-story views do NOT filter.
- **No Claude signature** in commits/PRs (verify per-commit `git log -1 --format=%b`).
- **Branch:** `feat/admin-dashboard-stubs`; PR base `develop-v1.3.0`.
- **Build:** `pnpm build`. If `nest build`/eslint hits a transient `Segmentation fault (core dumped)`, retry once.
- **Lint** (avoid the segfaulting wrapper): `node ./node_modules/eslint/bin/eslint.js <files>`.
- **Test:** `npx jest <path> --modulePathIgnorePatterns='/.claude/worktrees/' --roots=/home/williams/Documents/storytime/storytime_be/src` (the `--roots`/ignore flags suppress stale `.claude/worktrees` haste-map collisions; ignore any `jest-haste-map` warnings).

---

## File Structure

**Feature 1 — Story draft/published:**
- `prisma/schema.prisma` — add `Story.isPublished`
- `prisma/migrations/20260813000000_add_ispublished_to_story/migration.sql` — new
- `src/admin/admin-dashboard-metrics.service.ts` — real published/draft counts in `getStoryStats`
- `src/admin/dto/admin-filters.dto.ts` — `isPublished?` on `StoryFilterDto`
- `src/admin/dto/admin-responses.dto.ts` — `isPublished` on `StoryListItemDto`
- `src/admin/admin-story.service.ts` — filter wiring + `toggleStoryPublish`
- `src/admin/repositories/admin-story.repository.interface.ts` + `prisma-admin-story.repository.ts` — `updateStoryPublished`
- `src/admin/admin-story-admin.controller.ts` — `PATCH stories/:storyId/publish`
- `src/story/story-feed.service.ts`, `src/story/story.service.ts`, `src/story/services/daily-challenge.service.ts`, `src/story/repositories/prisma-story.repository.ts` — public draft-hiding

**Feature 2 — avgSessionTime:**
- `prisma/schema.prisma` — add `Session.lastActivityAt`
- `prisma/migrations/20260813000001_add_lastactivityat_to_session/migration.sql` — new
- `src/shared/guards/auth.guard.ts` — throttled `lastActivityAt` bump
- `src/admin/repositories/admin-engagement.repository.interface.ts` + `prisma-admin-engagement.repository.ts` — `getAverageSessionSeconds`
- `src/admin/admin-dashboard-metrics.service.ts` — wire into `getDashboardStats`

---

## Task 1: Add `Story.isPublished` schema + migration

**Files:**
- Modify: `prisma/schema.prisma` (Story model)
- Create: `prisma/migrations/20260813000000_add_ispublished_to_story/migration.sql`

**Interfaces:**
- Produces: `Story.isPublished: boolean` (Prisma-typed, default `true`).

- [ ] **Step 1: Add the field to the Story model**

In `prisma/schema.prisma`, inside `model Story`, add after the `aiGenerated` line:

```prisma
  // Draft/published state. Default true = every existing + newly generated
  // story is published (no behavior change). Admins can unpublish to make a
  // story a draft; public read paths filter isPublished: true.
  isPublished           Boolean                @default(true)
```

- [ ] **Step 2: Write the migration SQL**

Create `prisma/migrations/20260813000000_add_ispublished_to_story/migration.sql`:

```sql
-- AlterTable: add draft/published flag. Nullable-free but safe: a NOT NULL
-- column WITH a constant DEFAULT is a metadata-only change in Postgres (no
-- table rewrite). Default true keeps every existing story published.
ALTER TABLE "stories" ADD COLUMN "isPublished" BOOLEAN NOT NULL DEFAULT true;
```

- [ ] **Step 3: Regenerate the Prisma client (generate only — no DB access)**

Run: `pnpm db:generate`
Expected: "Generated Prisma Client".

- [ ] **Step 4: Validate schema + build**

Run: `npx prisma validate && pnpm build`
Expected: schema valid, build succeeds.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260813000000_add_ispublished_to_story
git commit -m "feat(story): add isPublished flag (default true) + migration"
```

---

## Task 2: Real `publishedStories` / `draftStories` counts

**Files:**
- Modify: `src/admin/admin-dashboard-metrics.service.ts` (`getStoryStats`, ~line 488-519)
- Test: `src/admin/admin-dashboard-metrics.story-stats.spec.ts` (create)

**Interfaces:**
- Consumes: `storyRepo.countStories(where)` (existing).
- Produces: `getStoryStats()` returns `publishedStories`/`draftStories` counted by `isPublished`.

- [ ] **Step 1: Write the failing test**

Create `src/admin/admin-dashboard-metrics.story-stats.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { AdminDashboardMetricsService } from './admin-dashboard-metrics.service';
import {
  ADMIN_USER_REPOSITORY,
  ADMIN_SUBSCRIPTION_REPOSITORY,
  ADMIN_PAYMENT_REPOSITORY,
  ADMIN_STORY_REPOSITORY,
  ADMIN_CONTENT_REPOSITORY,
  ADMIN_ENGAGEMENT_REPOSITORY,
} from './repositories';

describe('AdminDashboardMetricsService.getStoryStats', () => {
  let service: AdminDashboardMetricsService;
  const countStories = jest.fn();

  beforeEach(async () => {
    countStories.mockReset();
    // Return a distinct count per where so we can assert mapping regardless of
    // call order.
    countStories.mockImplementation((where: Record<string, unknown>) => {
      if (where.isDeleted === true) return Promise.resolve(7); // deleted
      if (where.isPublished === true) return Promise.resolve(300); // published
      if (where.isPublished === false) return Promise.resolve(12); // draft
      if (where.aiGenerated === true) return Promise.resolve(40);
      if (where.recommended === true) return Promise.resolve(15);
      return Promise.resolve(312); // total (isDeleted:false only)
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminDashboardMetricsService,
        { provide: ADMIN_USER_REPOSITORY, useValue: {} },
        { provide: ADMIN_SUBSCRIPTION_REPOSITORY, useValue: {} },
        { provide: ADMIN_PAYMENT_REPOSITORY, useValue: {} },
        { provide: ADMIN_STORY_REPOSITORY, useValue: { countStories } },
        { provide: ADMIN_CONTENT_REPOSITORY, useValue: {} },
        {
          provide: ADMIN_ENGAGEMENT_REPOSITORY,
          useValue: {
            countStoryProgress: jest.fn().mockResolvedValue(0),
            countFavorites: jest.fn().mockResolvedValue(0),
          },
        },
        { provide: CACHE_MANAGER, useValue: { get: jest.fn().mockResolvedValue(null), set: jest.fn() } },
      ],
    }).compile();

    service = module.get(AdminDashboardMetricsService);
  });

  it('counts published and draft stories by isPublished', async () => {
    const result = await service.getStoryStats();

    expect(countStories).toHaveBeenCalledWith({ isDeleted: false, isPublished: true });
    expect(countStories).toHaveBeenCalledWith({ isDeleted: false, isPublished: false });
    expect(result.publishedStories).toBe(300);
    expect(result.draftStories).toBe(12);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/admin/admin-dashboard-metrics.story-stats.spec.ts --modulePathIgnorePatterns='/.claude/worktrees/' --roots=/home/williams/Documents/storytime/storytime_be/src`
Expected: FAIL — `publishedStories` is 312 (total) and `draftStories` is 0.

- [ ] **Step 3: Implement the counts**

In `src/admin/admin-dashboard-metrics.service.ts`, in `getStoryStats`, change the `publishedStories` count (currently `countStories({ isDeleted: false })`) and add a `draftStories` count. In the destructured array (around line 488) add `draftStories,` after `publishedStories,`; in the `Promise.all` change the second entry and add a new one:

```typescript
      this.storyRepo.countStories({ isDeleted: false, isPublished: true }), // publishedStories
      this.storyRepo.countStories({ isDeleted: false, isPublished: false }), // draftStories
```

Then in the returned `StoryStatsDto`, replace `draftStories: 0,` with `draftStories,`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/admin/admin-dashboard-metrics.story-stats.spec.ts --modulePathIgnorePatterns='/.claude/worktrees/' --roots=/home/williams/Documents/storytime/storytime_be/src`
Expected: PASS.

- [ ] **Step 5: Build + commit**

```bash
pnpm build && git add src/admin/admin-dashboard-metrics.service.ts src/admin/admin-dashboard-metrics.story-stats.spec.ts
git commit -m "feat(admin): count published/draft stories by isPublished"
```

---

## Task 3: Admin `isPublished` filter + response field

**Files:**
- Modify: `src/admin/dto/admin-filters.dto.ts` (`StoryFilterDto`)
- Modify: `src/admin/dto/admin-responses.dto.ts` (`StoryListItemDto`)
- Modify: `src/admin/admin-story.service.ts` (`getAllStories`)
- Test: `src/admin/admin-story.filter.spec.ts` (create)

**Interfaces:**
- Consumes: `StoryFilterDto`, `adminStoryRepository.findStories`/`countStories`.
- Produces: `getAllStories({ isPublished })` filters by `isPublished`.

- [ ] **Step 1: Write the failing test**

Create `src/admin/admin-story.filter.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { AdminStoryService } from './admin-story.service';
import { ADMIN_STORY_REPOSITORY } from './repositories';

describe('AdminStoryService.getAllStories isPublished filter', () => {
  let service: AdminStoryService;
  const findStories = jest.fn().mockResolvedValue([]);
  const countStories = jest.fn().mockResolvedValue(0);

  beforeEach(async () => {
    findStories.mockClear();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminStoryService,
        { provide: ADMIN_STORY_REPOSITORY, useValue: { findStories, countStories } },
        { provide: CACHE_MANAGER, useValue: { get: jest.fn(), set: jest.fn(), del: jest.fn() } },
      ],
    }).compile();
    service = module.get(AdminStoryService);
  });

  it('passes isPublished:false through to the where clause', async () => {
    await service.getAllStories({ isPublished: false } as never);
    expect(findStories).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ isPublished: false }) }),
    );
  });

  it('omits isPublished from where when not provided', async () => {
    await service.getAllStories({} as never);
    const arg = findStories.mock.calls[0][0];
    expect(arg.where).not.toHaveProperty('isPublished');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/admin/admin-story.filter.spec.ts --modulePathIgnorePatterns='/.claude/worktrees/' --roots=/home/williams/Documents/storytime/storytime_be/src`
Expected: FAIL — `isPublished` not in where.

- [ ] **Step 3: Add the filter field to `StoryFilterDto`**

In `src/admin/dto/admin-filters.dto.ts`, in `StoryFilterDto`, after the `aiGenerated`/`isAiGenerated` block add:

```typescript
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  isPublished?: boolean;
```

- [ ] **Step 4: Wire it into `getAllStories`**

In `src/admin/admin-story.service.ts`, `getAllStories`, add `isPublished` to the destructured `filters` and add the where clause next to the other booleans:

```typescript
    if (typeof isPublished === 'boolean') where.isPublished = isPublished;
```

- [ ] **Step 5: Expose `isPublished` on the response DTO**

In `src/admin/dto/admin-responses.dto.ts`, in `StoryListItemDto`, after the `aiGenerated` property add:

```typescript
  @ApiProperty({ example: true })
  isPublished: boolean;
```

(The value already flows via `...storyData` — the admin `findStories` uses `include`, returning all scalar fields.)

- [ ] **Step 6: Run test + build**

Run: `npx jest src/admin/admin-story.filter.spec.ts --modulePathIgnorePatterns='/.claude/worktrees/' --roots=/home/williams/Documents/storytime/storytime_be/src && pnpm build`
Expected: PASS + build succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/admin/dto/admin-filters.dto.ts src/admin/dto/admin-responses.dto.ts src/admin/admin-story.service.ts src/admin/admin-story.filter.spec.ts
git commit -m "feat(admin): filter stories by isPublished + expose it in list DTO"
```

---

## Task 4: Publish toggle endpoint

**Files:**
- Modify: `src/admin/repositories/admin-story.repository.interface.ts` (add `updateStoryPublished`)
- Modify: `src/admin/repositories/prisma-admin-story.repository.ts` (impl)
- Modify: `src/admin/admin-story.service.ts` (`toggleStoryPublish`)
- Modify: `src/admin/admin-story-admin.controller.ts` (route)
- Test: `src/admin/admin-story.toggle-publish.spec.ts` (create)

**Interfaces:**
- Consumes: `adminStoryRepository.findStoryById`, `storyExists`.
- Produces: `AdminStoryService.toggleStoryPublish(storyId): Promise<Story>`; repo `updateStoryPublished({ storyId, isPublished }): Promise<Story>`.

- [ ] **Step 1: Write the failing test**

Create `src/admin/admin-story.toggle-publish.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { AdminStoryService } from './admin-story.service';
import { ADMIN_STORY_REPOSITORY } from './repositories';

describe('AdminStoryService.toggleStoryPublish', () => {
  let service: AdminStoryService;
  const storyExists = jest.fn().mockResolvedValue(true);
  const findStoryById = jest.fn().mockResolvedValue({ id: 's1', isPublished: true });
  const updateStoryPublished = jest.fn().mockResolvedValue({ id: 's1', isPublished: false });

  beforeEach(async () => {
    updateStoryPublished.mockClear();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminStoryService,
        { provide: ADMIN_STORY_REPOSITORY, useValue: { storyExists, findStoryById, updateStoryPublished } },
        { provide: CACHE_MANAGER, useValue: { get: jest.fn(), set: jest.fn(), del: jest.fn() } },
      ],
    }).compile();
    service = module.get(AdminStoryService);
  });

  it('flips isPublished to the opposite of current', async () => {
    const result = await service.toggleStoryPublish('s1');
    expect(updateStoryPublished).toHaveBeenCalledWith({ storyId: 's1', isPublished: false });
    expect(result.isPublished).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/admin/admin-story.toggle-publish.spec.ts --modulePathIgnorePatterns='/.claude/worktrees/' --roots=/home/williams/Documents/storytime/storytime_be/src`
Expected: FAIL — `toggleStoryPublish` / `updateStoryPublished` don't exist.

- [ ] **Step 3: Add repo interface method**

In `src/admin/repositories/admin-story.repository.interface.ts`, after `updateStoryRecommendation`, add:

```typescript
  updateStoryPublished(params: {
    storyId: string;
    isPublished: boolean;
  }): Promise<Story>;
```

- [ ] **Step 4: Implement in the prisma repo**

In `src/admin/repositories/prisma-admin-story.repository.ts`, after `updateStoryRecommendation`, add:

```typescript
  async updateStoryPublished(params: {
    storyId: string;
    isPublished: boolean;
  }): Promise<Story> {
    return this.prisma.story.update({
      where: { id: params.storyId },
      data: { isPublished: params.isPublished },
    });
  }
```

- [ ] **Step 5: Add the service method**

In `src/admin/admin-story.service.ts`, mirror `toggleStoryRecommendation`:

```typescript
  async toggleStoryPublish(storyId: string): Promise<Story> {
    const storyExists = await this.adminStoryRepository.storyExists(storyId);
    if (!storyExists) {
      throw new ResourceNotFoundException('Story', storyId);
    }
    const story = await this.adminStoryRepository.findStoryById(storyId);
    if (!story) {
      throw new ResourceNotFoundException('Story', storyId);
    }
    const result = await this.adminStoryRepository.updateStoryPublished({
      storyId,
      isPublished: !story.isPublished,
    });
    try {
      await this.cacheManager.del(CACHE_KEYS.STORY_STATS);
    } catch (error) {
      this.logger.warn(
        `Failed to invalidate story stats cache: ${error.message}`,
      );
    }
    return result;
  }
```

- [ ] **Step 6: Add the controller route**

In `src/admin/admin-story-admin.controller.ts`, mirror the `stories/:storyId/recommend` route:

```typescript
  @Patch('stories/:storyId/publish')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Toggle story published state',
    description: 'Toggles the isPublished flag for a story (publish/unpublish).',
  })
  @ApiParam({ name: 'storyId', type: String, description: 'Story ID' })
  @ApiOkResponse({ description: 'Story published state toggled successfully' })
  @ApiResponse({ status: 404, description: 'Story not found' })
  async toggleStoryPublish(@Param('storyId') storyId: string) {
    const data = await this.adminService.toggleStoryPublish(storyId);
    return {
      statusCode: 200,
      message: 'Story published state toggled successfully',
      data,
    };
  }
```

- [ ] **Step 7: Run test + build**

Run: `npx jest src/admin/admin-story.toggle-publish.spec.ts --modulePathIgnorePatterns='/.claude/worktrees/' --roots=/home/williams/Documents/storytime/storytime_be/src && pnpm build`
Expected: PASS + build.

- [ ] **Step 8: Commit**

```bash
git add src/admin/repositories/admin-story.repository.interface.ts src/admin/repositories/prisma-admin-story.repository.ts src/admin/admin-story.service.ts src/admin/admin-story-admin.controller.ts src/admin/admin-story.toggle-publish.spec.ts
git commit -m "feat(admin): add publish/unpublish toggle endpoint for stories"
```

---

## Task 5: Hide drafts from all public read paths

**Files:**
- Modify: `src/story/story-feed.service.ts` (base where + home carousels + topPicks count)
- Modify: `src/story/story.service.ts` (`getStoryById`, `getTopPicksFromParents`, `getTopPicksFromUs`, daily-challenge pool)
- Modify: `src/story/services/daily-challenge.service.ts` (assignment pool)
- Modify: `src/story/repositories/prisma-story.repository.ts` (raw-SQL id generators)
- Test: `src/story/story-feed.draft-hiding.spec.ts` (create) — chokepoint coverage

**Interfaces:**
- Consumes: existing story repos.
- Produces: no draft (`isPublished:false`) appears in any public list/feed or single-read.

**Rule:** add `isPublished: true` to each public **where**. Do NOT touch the admin repo, and do NOT add it to a kid's own-created-story view (`getCreatedStories`) — a kid always sees their own generations.

- [ ] **Step 1: Write the failing tests (chokepoints)**

Create `src/story/story-feed.draft-hiding.spec.ts`. This asserts the two chokepoints pass `isPublished: true` to the repo. Mock only what these methods touch; if a method needs more collaborators, extend the mocks until it runs.

```typescript
import { StoryFeedService } from './story-feed.service';

describe('public read paths hide drafts', () => {
  it('buildStoryWhereClause base where includes isPublished: true', async () => {
    const svc = new StoryFeedService(...deps); // construct with mocked deps
    // buildStoryWhereClause is private; call the public getStories and assert
    // the repo received a where with isPublished: true.
    const findManyStoriesRaw = jest.fn().mockResolvedValue([]);
    // ...wire findManyStoriesRaw into the mocked story repo...
    await svc.getStories({} as never);
    expect(findManyStoriesRaw).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ isPublished: true }) }),
    );
  });
});
```

Note: `StoryFeedService`'s constructor deps must be read from `src/story/story-feed.service.ts` and mocked. If wiring the full service is impractical, instead assert at `StoryService.getStoryById`:

```typescript
import { StoryService } from './story.service';

it('getStoryById filters isPublished: true', async () => {
  const findUniqueStoryRaw = jest.fn().mockResolvedValue({ id: 's1' });
  const svc = new StoryService(...deps); // storyRepository.findUniqueStoryRaw = findUniqueStoryRaw
  await svc.getStoryById('s1');
  expect(findUniqueStoryRaw).toHaveBeenCalledWith(
    expect.objectContaining({ where: expect.objectContaining({ id: 's1', isPublished: true }) }),
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/story/story-feed.draft-hiding.spec.ts --modulePathIgnorePatterns='/.claude/worktrees/' --roots=/home/williams/Documents/storytime/storytime_be/src`
Expected: FAIL — where has no `isPublished`.

- [ ] **Step 3: Edit `story-feed.service.ts`**

- `buildStoryWhereClause` base where (~line 74): change `{ isDeleted: false }` to `{ isDeleted: false, isPublished: true }`.
- topPicks count branch (~line 305): `countStoriesRaw({ isDeleted: false, isPublished: true })`.
- `getHomePageStories` carousels — add `isPublished: true` to each inline `where`: recommended base (~999/1006), seasonal (~1038, ~1063, ~1086), topLiked (~1106, ~1117).

- [ ] **Step 4: Edit `story.service.ts`**

- `getStoryById` (~line 553): `where: { id, isDeleted: false, isPublished: true }`.
- `getTopPicksFromParents` (~line 696): add `isPublished: true` to the `{ id: { in }, isDeleted: false }` where.
- `getTopPicksFromUs` second query (~line 744-745): add `isPublished: true` alongside `id: { in: randomIds }`.
- daily-challenge pool query (~line 474-478): add `isPublished: true`.
- Leave `getCreatedStories` (~610) unfiltered (kid's own content).

- [ ] **Step 5: Edit `daily-challenge.service.ts`**

- Assignment pool `findStories({ where: { isDeleted: false } })` (~line 117): add `isPublished: true`.

- [ ] **Step 6: Edit raw-SQL id generators in `prisma-story.repository.ts`**

- `getRandomStoryIdsFromStories` (~line 1185): change `WHERE "isDeleted" = false` to `WHERE "isDeleted" = false AND "isPublished" = true`.
- `getDeterministicStoryIdsFromStories` (~line 1199): same edit.

- [ ] **Step 7: Run test + build**

Run: `npx jest src/story/story-feed.draft-hiding.spec.ts --modulePathIgnorePatterns='/.claude/worktrees/' --roots=/home/williams/Documents/storytime/storytime_be/src && pnpm build`
Expected: PASS + build.

- [ ] **Step 8: Regression-run the story test suite**

Run: `npx jest src/story --modulePathIgnorePatterns='/.claude/worktrees/' --roots=/home/williams/Documents/storytime/storytime_be/src`
Expected: existing story tests still pass.

- [ ] **Step 9: Commit**

```bash
git add src/story/story-feed.service.ts src/story/story.service.ts src/story/services/daily-challenge.service.ts src/story/repositories/prisma-story.repository.ts src/story/story-feed.draft-hiding.spec.ts
git commit -m "feat(story): hide unpublished (draft) stories from public read paths"
```

**Known limitation (documented, out of scope):** a story unpublished *after* a user already has progress on / downloaded / favorited it can still appear in that user's continue-reading / library joins (`prisma-story.repository.ts:269,284,349,364` and download/favorite joins). Strict-hiding those requires a nested `story: { isPublished: true }` filter; deferred.

---

## Task 6: Add `Session.lastActivityAt` schema + migration

**Files:**
- Modify: `prisma/schema.prisma` (Session model)
- Create: `prisma/migrations/20260813000001_add_lastactivityat_to_session/migration.sql`

**Interfaces:**
- Produces: `Session.lastActivityAt: Date | null`.

- [ ] **Step 1: Add the field**

In `prisma/schema.prisma`, in `model Session`, after `createdAt`, add:

```prisma
  // Last time an authenticated request used this session (bumped, throttled, by
  // AuthSessionGuard). Nullable: pre-existing sessions predate it. Enables
  // avg session duration = lastActivityAt - createdAt.
  lastActivityAt DateTime?
```

- [ ] **Step 2: Write the migration SQL**

Create `prisma/migrations/20260813000001_add_lastactivityat_to_session/migration.sql`:

```sql
-- AlterTable: add nullable last-activity timestamp (metadata-only, no rewrite).
ALTER TABLE "sessions" ADD COLUMN "lastActivityAt" TIMESTAMP(3);
```

- [ ] **Step 3: Generate + validate + build**

Run: `pnpm db:generate && npx prisma validate && pnpm build`
Expected: success.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260813000001_add_lastactivityat_to_session
git commit -m "feat(session): add lastActivityAt timestamp + migration"
```

---

## Task 7: Throttled `lastActivityAt` bump in the auth guard

**Files:**
- Modify: `src/shared/guards/auth.guard.ts`
- Test: `src/shared/guards/auth.guard.last-activity.spec.ts` (create)

**Interfaces:**
- Consumes: the `session` object already loaded in `validateRequest`, `this.prisma.session.update`.
- Produces: on a valid session, `lastActivityAt` is set to now when it is null or older than 60s; the update is fire-and-forget (never awaited, errors swallowed).

- [ ] **Step 1: Write the failing test**

Create `src/shared/guards/auth.guard.last-activity.spec.ts`:

```typescript
import { AuthSessionGuard } from './auth.guard';

const THRESHOLD_MS = 60_000;

function makeGuard(session: Record<string, unknown>) {
  const update = jest.fn().mockResolvedValue({});
  const prisma = { session: { findUnique: jest.fn().mockResolvedValue(session), update } } as never;
  const jwt = { verify: jest.fn().mockReturnValue({ userId: 'u1', authSessionId: 'sess1' }) } as never;
  const reflector = { getAllAndOverride: jest.fn().mockReturnValue(false) } as never;
  const guard = new AuthSessionGuard(jwt, reflector, prisma);
  const ctx = {
    switchToHttp: () => ({ getRequest: () => ({ headers: { authorization: 'Bearer t' } }) }),
    getHandler: () => null,
    getClass: () => null,
  } as never;
  return { guard, update, ctx };
}

const baseSession = {
  id: 'sess1',
  isDeleted: false,
  deletedAt: null,
  expiresAt: new Date(Date.now() + 3_600_000),
  createdAt: new Date(Date.now() - 7_200_000),
};

it('bumps lastActivityAt when null', async () => {
  const { guard, update, ctx } = makeGuard({ ...baseSession, lastActivityAt: null });
  await guard.canActivate(ctx);
  await new Promise((r) => setImmediate(r)); // let the fire-and-forget settle
  expect(update).toHaveBeenCalledWith(
    expect.objectContaining({ where: { id: 'sess1' }, data: expect.objectContaining({ lastActivityAt: expect.any(Date) }) }),
  );
});

it('bumps when lastActivityAt is stale (> 60s)', async () => {
  const { guard, update, ctx } = makeGuard({ ...baseSession, lastActivityAt: new Date(Date.now() - THRESHOLD_MS - 1000) });
  await guard.canActivate(ctx);
  await new Promise((r) => setImmediate(r));
  expect(update).toHaveBeenCalled();
});

it('does NOT bump when lastActivityAt is fresh (< 60s)', async () => {
  const { guard, update, ctx } = makeGuard({ ...baseSession, lastActivityAt: new Date(Date.now() - 5000) });
  await guard.canActivate(ctx);
  await new Promise((r) => setImmediate(r));
  expect(update).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/shared/guards/auth.guard.last-activity.spec.ts --modulePathIgnorePatterns='/.claude/worktrees/' --roots=/home/williams/Documents/storytime/storytime_be/src`
Expected: FAIL — no update call.

- [ ] **Step 3: Implement the throttled bump**

In `src/shared/guards/auth.guard.ts`, inside `validateRequest`, after the `session.expiresAt < new Date()` check passes and before `return true`, add:

```typescript
      // Track last activity for avg-session-time analytics. Throttled to at most
      // one write per 60s per session; fire-and-forget so it never adds latency
      // or fails an otherwise-valid request.
      const ACTIVITY_THROTTLE_MS = 60_000;
      const last = session.lastActivityAt?.getTime() ?? 0;
      if (Date.now() - last > ACTIVITY_THROTTLE_MS) {
        void this.prisma.session
          .update({ where: { id: session.id }, data: { lastActivityAt: new Date() } })
          .catch(() => undefined);
      }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/shared/guards/auth.guard.last-activity.spec.ts --modulePathIgnorePatterns='/.claude/worktrees/' --roots=/home/williams/Documents/storytime/storytime_be/src`
Expected: PASS (all 3).

- [ ] **Step 5: Build + commit**

```bash
pnpm build && git add src/shared/guards/auth.guard.ts src/shared/guards/auth.guard.last-activity.spec.ts
git commit -m "feat(auth): track session lastActivityAt (throttled, fire-and-forget)"
```

---

## Task 8: Compute `avgSessionTime` + wire into dashboard

**Files:**
- Modify: `src/admin/repositories/admin-engagement.repository.interface.ts`
- Modify: `src/admin/repositories/prisma-admin-engagement.repository.ts`
- Modify: `src/admin/admin-dashboard-metrics.service.ts` (`getDashboardStats`)
- Test: `src/admin/prisma-admin-engagement.avg-session.spec.ts` (create)

**Interfaces:**
- Produces: `IAdminEngagementRepository.getAverageSessionSeconds(start: Date, end: Date): Promise<number>`.
- Consumes (in metrics): `range30d.start`, `range30d.end` (already computed in `getDashboardStats`).

- [ ] **Step 1: Write the failing test**

Create `src/admin/prisma-admin-engagement.avg-session.spec.ts`:

```typescript
import { PrismaAdminEngagementRepository } from './repositories/prisma-admin-engagement.repository';

describe('getAverageSessionSeconds', () => {
  function repoWith(rows: { createdAt: Date; lastActivityAt: Date | null }[]) {
    const prisma = { session: { findMany: jest.fn().mockResolvedValue(rows) } } as never;
    return new PrismaAdminEngagementRepository(prisma);
  }

  it('averages (lastActivityAt - createdAt) in seconds, excluding nulls', async () => {
    const base = new Date('2026-08-01T00:00:00Z').getTime();
    const repo = repoWith([
      { createdAt: new Date(base), lastActivityAt: new Date(base + 100_000) }, // 100s
      { createdAt: new Date(base), lastActivityAt: new Date(base + 300_000) }, // 300s
    ]);
    const avg = await repo.getAverageSessionSeconds(new Date(base - 1000), new Date(base + 1_000_000));
    expect(avg).toBe(200);
  });

  it('returns 0 when there are no qualifying sessions', async () => {
    const repo = repoWith([]);
    expect(await repo.getAverageSessionSeconds(new Date(), new Date())).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/admin/prisma-admin-engagement.avg-session.spec.ts --modulePathIgnorePatterns='/.claude/worktrees/' --roots=/home/williams/Documents/storytime/storytime_be/src`
Expected: FAIL — method missing.

- [ ] **Step 3: Add the interface method**

In `src/admin/repositories/admin-engagement.repository.interface.ts`, add to `IAdminEngagementRepository`:

```typescript
  // Average session duration (seconds) over sessions active in [start, end].
  // Uses lastActivityAt - createdAt; sessions without lastActivityAt excluded.
  getAverageSessionSeconds(start: Date, end: Date): Promise<number>;
```

- [ ] **Step 4: Implement it**

In `src/admin/repositories/prisma-admin-engagement.repository.ts`, add:

```typescript
  async getAverageSessionSeconds(start: Date, end: Date): Promise<number> {
    const rows = await this.prisma.session.findMany({
      where: {
        isDeleted: false,
        lastActivityAt: { not: null, gte: start, lte: end },
      },
      select: { createdAt: true, lastActivityAt: true },
    });
    if (rows.length === 0) return 0;
    const totalSeconds = rows.reduce((sum, r) => {
      const lastActivity = r.lastActivityAt as Date;
      return sum + (lastActivity.getTime() - r.createdAt.getTime()) / 1000;
    }, 0);
    return totalSeconds / rows.length;
  }
```

- [ ] **Step 5: Wire into `getDashboardStats`**

In `src/admin/admin-dashboard-metrics.service.ts`, replace `const avgSessionTime = 0; // Placeholder` with:

```typescript
    const avgSessionTime = await this.engagementRepo.getAverageSessionSeconds(
      range30d.start,
      range30d.end,
    );
```

(`range30d` is already computed near the top of `getDashboardStats`.)

- [ ] **Step 6: Run test + build**

Run: `npx jest src/admin/prisma-admin-engagement.avg-session.spec.ts --modulePathIgnorePatterns='/.claude/worktrees/' --roots=/home/williams/Documents/storytime/storytime_be/src && pnpm build`
Expected: PASS + build.

- [ ] **Step 7: Commit**

```bash
git add src/admin/repositories/admin-engagement.repository.interface.ts src/admin/repositories/prisma-admin-engagement.repository.ts src/admin/admin-dashboard-metrics.service.ts src/admin/prisma-admin-engagement.avg-session.spec.ts
git commit -m "feat(admin): compute averageSessionTime from session lastActivityAt"
```

---

## Task 9: Final lint + PR

- [ ] **Step 1: Lint all changed files**

Run: `node ./node_modules/eslint/bin/eslint.js $(git diff --name-only develop-v1.3.0...HEAD -- '*.ts')`
Expected: exit 0.

- [ ] **Step 2: Push + open PR**

```bash
git push "https://x-access-token:$(gh auth token)@github.com/Bolt-Silverfox/storytime_be.git" HEAD:feat/admin-dashboard-stubs
gh pr create --repo Bolt-Silverfox/storytime_be --base develop-v1.3.0 --head feat/admin-dashboard-stubs \
  --title "feat(admin): real draftStories + averageSessionTime dashboard metrics" \
  --body "Implements docs/superpowers/specs/2026-08-13-admin-dashboard-stubs-design.md. Adds Story.isPublished (default true; admin filter/toggle/counts; hidden from public read paths) and Session.lastActivityAt (throttled bump in auth guard; averaged over 30d for the dashboard). Two additive migrations."
```

- [ ] **Step 3: Babysit checks; merge when green** (Build, Code Quality, CodeQL, Test, CodeRabbit). Deploy runs `db:migrate:deploy` on merge — confirm the "Run database migrations" step succeeds (both migrations are additive/safe).

---

## Self-Review notes

- **Spec coverage:** Story schema (T1) · publishedStories/draftStories (T2) · admin filter+DTO (T3) · publish toggle (T4) · public draft-hiding (T5) · Session schema (T6) · guard tracking (T7) · avg computation + wiring (T8). All spec sections mapped.
- **Rollout caveat** from spec (avgSessionTime starts ~0, no backfill; draftStories 0 until admin unpublishes) holds — no task backfills, matching the design.
- **Non-goals** respected: boolean not enum; no client session events; no `stories.isPublished` index; kid-created stories stay published via `@default(true)` (no creator-kid exemption needed).

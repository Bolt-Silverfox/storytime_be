# Reading Analytics Design

## Problem

Staff have no way to see which stories users are actually reading. The
admin dashboard reports aggregate counts (total stories, total users) but
nothing per-story. Product wants a "what are kids reading" view to guide
content decisions (what to narrate next, what to promote, what's dead
weight in the library).

## Privacy constraint

A story read by only a handful of distinct people is a near-identifying
signal — if staff can see "this obscure story was read by 2 people," and
staff also has access to user-support data, that's enough to work out who.
The rule: **any per-story reader count or reader identity is suppressed
when the story has fewer than 5 distinct readers.** This applies both to
the top-stories ranked list and to the per-story drill-down's reader list.
Suppression is enforced server-side — the frontend is never sent the real
sub-threshold numbers or names, so there's no path (bug or otherwise) for
it to render what it was never given.

## Scope

- New backend aggregate endpoints in `storytime_be`'s `admin` module.
- New "Reading Analytics" tab on `storytime_superadmin`'s Content
  Management page (alongside the existing Categories/Themes tabs).
- Out of scope: email/notification digests of reading activity, export of
  per-story data, any feature built on top of this (e.g. recommending
  stories based on reading patterns) — those are separate future asks.

## Data source

Two tables track reading progress:

- `StoryProgress` — one row per `(kidId, storyId)`, a kid profile's
  progress on a story.
- `UserStoryProgress` — one row per `(userId, storyId)`, a parent
  account's own direct progress on a story (reading without a kid
  profile).

A story's distinct-reader count is the union of distinct `kidId`s from
`StoryProgress` and distinct `userId`s from `UserStoryProgress` for that
`storyId`. A kid and the parent who owns that kid reading the same story
both count — they're different readers.

## Backend

### New repository method

Extend `IAdminEngagementRepository` (`src/admin/repositories/admin-engagement.repository.interface.ts`)
with:

```typescript
export interface StoryReaderStats {
  storyId: string;
  distinctReaders: number;
  completedCount: number;
  avgTimeSpentSeconds: number;
}

getStoryReaderStats(
  range?: { start: Date; end: Date },
): Promise<StoryReaderStats[]>;

getStoryReaderStatsForStory(
  storyId: string,
): Promise<StoryReaderStats | null>;

getStoryReaderTrend(
  storyId: string,
  range: { start: Date; end: Date },
): Promise<{ date: string; distinctReaders: number; completions: number }[]>;

// Suppressed when total distinct readers < 5 — returns [] in that case,
// never partial/truncated real data.
getStoryReaders(
  storyId: string,
): Promise<{ readerId: string; readerType: 'kid' | 'user'; displayName: string; lastAccessed: Date }[]>;
```

`distinctReaders` requires `COUNT(DISTINCT kidId)` / `COUNT(DISTINCT
userId)` per story, which Prisma's `groupBy` cannot express directly
(its `_count` counts rows, not distinct values of a field). This is the
one place in the admin module that uses `$queryRaw` instead of the query
builder — every other repository method keeps using Prisma's typed query
API. The raw query:

```sql
SELECT
  story_id,
  COUNT(DISTINCT kid_reader) + COUNT(DISTINCT user_reader) AS distinct_readers,
  -- completions and avg time computed the same way, unioned across both tables
FROM (
  SELECT story_id, kid_id AS kid_reader, NULL AS user_reader, completed, total_time_spent
  FROM story_progress
  WHERE is_deleted = false AND lastAccessed BETWEEN $1 AND $2
  UNION ALL
  SELECT story_id, NULL, user_id, completed, total_time_spent
  FROM user_story_progress
  WHERE is_deleted = false AND lastAccessed BETWEEN $1 AND $2
) combined
GROUP BY story_id
```

(Exact column list finalized in the implementation plan; this is the
shape, not the literal final SQL.) Parameterized via Prisma's tagged
template `$queryRaw` — never string-concatenated — to avoid SQL
injection.

### New service: `AdminReadingAnalyticsService`

`src/admin/admin-reading-analytics.service.ts`, following the existing
admin service pattern (thin orchestration over the repository, DTO
mapping, suppression logic). Suppression lives here, not in the
repository or controller — one place decides "is this story below
threshold," so the rule can't be forgotten in a future second caller of
the repository.

```typescript
const READER_SUPPRESSION_THRESHOLD = 5;

async getTopStories(range: DateRangeDto): Promise<TopStoryDto[]> {
  const stats = await this.repo.getStoryReaderStats(range);
  const stories = await this.storyRepo.findByIds(stats.map(s => s.storyId));
  return stats
    .map(s => ({
      storyId: s.storyId,
      title: stories.find(st => st.id === s.storyId)?.title ?? 'Unknown',
      readerCount: s.distinctReaders >= READER_SUPPRESSION_THRESHOLD ? s.distinctReaders : null,
      completionRate: s.distinctReaders > 0 ? s.completedCount / s.distinctReaders : 0,
    }))
    .sort((a, b) => (b.readerCount ?? 0) - (a.readerCount ?? 0));
}
```

Rows with `readerCount: null` still appear in the list (frontend renders
"< 5 readers") but sort to the bottom — ranking by a number we're
hiding would leak ordinal information.

### New endpoints

Added to `AdminDashboardController` (or a new
`AdminReadingAnalyticsController` if the dashboard controller is judged
too large already — decided in the implementation plan after reading its
current line count):

- `GET /admin/reading-analytics/top-stories?range=7|30|90` → `TopStoryDto[]`
- `GET /admin/reading-analytics/stories/:storyId` → `StoryDetailDto`
  (completion rate, avg time spent, trend series, reader list — reader
  list is `[]` with `readersSuppressed: true` when below threshold)
- `GET /admin/reading-analytics/stories/:storyId/trend?range=7|30|90` → trend series only (separate endpoint so the range toggle on the drill-down chart doesn't refetch the whole detail payload)

All three guarded by the existing admin JWT auth guard, same as every
other `/admin/*` route.

### Caching

Dashboard-stats-style endpoints in this codebase cache via
`CACHE_MANAGER` (seen in the existing `getStoryStats` test). Top-stories
and trend data follow the same pattern: 5-minute TTL, cache key includes
the `range` param. Per-story detail is not cached (low traffic, staff
drilling into one story at a time — not worth the complexity).

## Frontend

### Placement

New `Reading Analytics` tab on `/dashboard/content`
(`app/dashboard/content/page.tsx`), added to the existing `Tabs` /
`TabsList` alongside `Categories` and `Themes`.

### Top-stories view

Reuses the existing sortable `DataTable` primitive
(`app/_components/ui/DataTable.tsx`, built in this session's redesign
but not yet wired into any page). Columns: Title, Readers (shows "< 5"
for suppressed rows), Completion rate, Last read. A range toggle (7 /
30 / 90 days, matching the existing AI Credit Consumption chart's
toggle pattern) above the table controls the query range.

### Trend chart

Chart.js line chart (matching the existing restyled chart components'
moss/ocean palette and IBM Plex font), one line per selected story (or
an aggregate "all stories" line when none is selected) over the chosen
range.

### Story drill-down

Clicking a row opens a detail view (a route,
`/dashboard/content/reading-analytics/[storyId]`, not a modal — detail
pages in this app are routes, e.g. nothing currently uses a modal for
this depth of content) showing: completion rate, avg time spent, its own
trend chart, and the reader list table (kid/user display name, last
read date) — or, when suppressed, a one-line "Fewer than 5 readers —
details hidden to protect reader privacy" message in place of the list.

### New query functions

`query/queryReadingAnalytics.ts` (top stories + trend) and
`query/queryStoryReaderDetail.ts` (per-story detail), following the
existing `query/` folder convention — `authFetch` wrapper, centralized
`QueryKeys`.

## Testing

Backend: unit tests for `AdminReadingAnalyticsService` (suppression
threshold boundary at exactly 5, exactly 4; sort order with suppressed
rows at the bottom; DTO mapping), plus a repository-level test against
the raw SQL (seed `StoryProgress`/`UserStoryProgress` rows, assert the
distinct-count union is correct — this is the one query in the feature
that's easy to get subtly wrong, so it gets a real test against the
test database, not a mock).

Frontend: component tests for the suppression placeholder rendering
("< 5 readers" vs a real number), and for the drill-down's suppressed
reader-list message.

## Open follow-ups (not in this feature's scope)

- Admin tables across the app need real filtering/sorting — already
  flagged separately, the new Reading Analytics table will use the same
  `DataTable` primitive once it's upgraded, not bespoke logic.
- `LoadingIndicator` needs a visual redesign — already flagged
  separately, applies to every page including this one's loading states.

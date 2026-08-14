# Admin dashboard stubs: `draftStories` + `avgSessionTime`

**Date:** 2026-08-13
**Status:** Approved (design)
**Line:** `develop-v1.3.0`

## Background

Two admin-dashboard metrics were hardcoded stubs (from the admin-section audit):

- `draftStories` is always `0`, and `publishedStories` is just the total story
  count — because `Story` has no draft/published concept.
- `averageSessionTime` is a `= 0` placeholder — session duration is recorded
  nowhere. The `Session` model has `createdAt` and `expiresAt` (token expiry),
  but no logout or last-seen timestamp.

This spec adds the minimal data + logic to make both metrics real. The two
features are independent but small, so they share one spec and one plan.

Both schema changes are additive and **hand-authored** (no `prisma migrate dev`
— `DATABASE_URL` points at the shared prod/dev RDS), applied via
`db:migrate:deploy` in the deploy pipeline.

## Feature 1 — Story draft/published

### Schema

Add to `model Story`:

```prisma
isPublished Boolean @default(true)
```

Migration:

```sql
ALTER TABLE "stories" ADD COLUMN "isPublished" BOOLEAN NOT NULL DEFAULT true;
```

`DEFAULT true` = every existing story stays published → zero behavior change on
deploy. No index in this change (stories table is small and story-count metrics
are cached; an `@@index([isPublished, isDeleted])` can be added later if a query
shows up hot).

### Admin surface

- `StoryFilterDto`: add optional `isPublished?: boolean` filter; wire into
  `AdminStoryService.getAllStories` `where` (same pattern as `recommended` /
  `aiGenerated`).
- Admin story DTOs (`StoryListItemDto`, `StoryDetailDto`): expose `isPublished`.
- Publish toggle: add `toggleStoryPublish(storyId)` mirroring the existing
  `toggleStoryRecommendation` (service + repository method + controller route +
  cache invalidation of story-stats).
- Metrics (`admin-dashboard-metrics.service.ts`):
  - `publishedStories = countStories({ isDeleted: false, isPublished: true })`
  - `draftStories = countStories({ isDeleted: false, isPublished: false })`
  - (replaces the current `publishedStories = total` and `draftStories: 0`.)

### Public surface (correctness-critical)

Drafts must never reach kids/parents. The public-facing story **list/feed**
queries get `isPublished: true` added to their `where`; single-story lookups
used by public read paths are gated too. **Admin** repository queries stay
unfiltered (admins see drafts). The exact query sites (across
`src/story/repositories/*`) are enumerated in the implementation plan; the rule
is: public read path → filter `isPublished: true`; admin path → no filter.

## Feature 2 — avgSessionTime via `Session.lastActivityAt`

### Schema

Add to `model Session`:

```prisma
lastActivityAt DateTime?
```

Migration:

```sql
ALTER TABLE "sessions" ADD COLUMN "lastActivityAt" TIMESTAMP(3);
```

Nullable — pre-existing sessions have no activity timestamp.

### Write path (tracking)

`AuthSessionGuard.validateRequest` already loads the session via
`findUnique` on every authenticated request. After the session passes
validation, do a **throttled** bump:

```
if session.lastActivityAt is null OR (now - session.lastActivityAt) > 60_000ms:
    fire-and-forget prisma.session.update({ where:{id}, data:{ lastActivityAt: now } })
```

The update is **not awaited** and its rejection is swallowed (`.catch`), so it
adds no latency and can never fail an otherwise-valid request. The 60s throttle
keeps this from becoming a write on every request.

### Read path (metric)

New engagement-repo method:

```
getAverageSessionSeconds(start: Date, end: Date): Promise<number>
```

`findMany` sessions with `lastActivityAt` in `[start, end]`, `lastActivityAt`
not null, not soft-deleted; select `createdAt` + `lastActivityAt`; return the
mean of `(lastActivityAt - createdAt) / 1000` seconds (0 when there are none).
Sessions with null `lastActivityAt` (login but no subsequent authenticated
request) are excluded — their duration is unknown, not zero.

Wire into `getDashboardStats` over a trailing 30-day window, replacing
`const avgSessionTime = 0`.

### Honest caveat

This measures **going forward**. Historical sessions have no activity timestamp,
so the metric starts near 0 and builds up as sessions accrue `lastActivityAt`.
No backfill is possible — the data never existed.

## Testing

- **Story metrics:** `publishedStories` / `draftStories` count by `isPublished`.
- **Public feed excludes drafts:** a story with `isPublished:false` does not
  appear in the public list query; admin list still shows it.
- **Admin filter:** `getAllStories({ isPublished:false })` returns only drafts.
- **Guard throttle:** bumps `lastActivityAt` when null/stale (>60s); skips the
  write when fresh (<60s).
- **Average:** excludes null `lastActivityAt`, averages `(last-created)` in
  seconds, returns 0 on empty.

## Non-goals

- No enum/`ARCHIVED` state for stories (YAGNI — boolean chosen).
- No client-side session events (mobile/web) — server-derived tracking only.
- No backfill of historical session durations.
- No index on `stories.isPublished` in this change.

## Rollout

Two additive migrations (bool NOT NULL DEFAULT true; nullable timestamp), both
safe on the shared DB. On merge to `develop-v1.3.0`, the deploy job runs
`db:migrate:deploy` (verified working on PR #498). `avgSessionTime` reads ~0
immediately post-deploy and climbs; `draftStories` reads 0 until an admin marks
a story as a draft.

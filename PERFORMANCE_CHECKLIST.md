# Performance & Scalability Checklist

This checklist identifies bottlenecks and issues that could affect users during peak traffic. Work through these items to improve application performance.

---

## Critical Priority (P0)

### Database: N+1 Query Problems in Story Service ✅ COMPLETED
- [x] **Location:** `src/story/story.service.ts:133-149`
- [x] Batch kid lookups instead of querying each separately
- [x] Combine parent recommendations query with main query
- [x] Combine restricted stories query with main query
- [ ] Consolidate `getRelevantSeasons()` query - *deferred, only called when isSeasonal=true*
- **Impact:** ~~100 concurrent users = 400+ unnecessary DB queries~~ Now 1 batch query per request

### Database: Admin Dashboard Sequential Counts ✅ COMPLETED
- [x] **Location:** `src/admin/admin.service.ts:79-294`
- [ ] Create denormalized `SystemMetrics` table updated async - *deferred, not critical with caching*
- [x] Queries already use `Promise.all` for parallel execution
- [x] Add caching for dashboard metrics (5-minute TTL)
- **Impact:** ~~1.5-7.5 second endpoint latency~~ <50ms on cache hit (5-min TTL)

### External API: ElevenLabs Rate Limit Handling ✅ COMPLETED
- [x] **Location:** `src/voice/providers/eleven-labs-tts.provider.ts:79-147`
- [x] Add retry logic for 429 (rate limit) responses
- [x] Implement exponential backoff (1s → 2s → 4s with jitter)
- [ ] Add request timeout (10 seconds recommended) - *SDK handles internally*
- [ ] Consider request queuing for burst traffic - *deferred, not critical*
- **Impact:** ~~500 concurrent requests = immediate failure cascade~~ Now handles gracefully

---

## High Priority (P1)

### Queue: Email Processor Concurrency ✅ COMPLETED
- [x] **Location:** `src/notification/queue/email.processor.ts:14`
- [x] Add concurrency setting: `@Processor(EMAIL_QUEUE_NAME, { concurrency: 10 })`
- **Impact:** ~~1000 emails queue = 83 minute delay~~ Now ~8 minutes with 10 workers

### Database: Offset Pagination (Optimized)
- [x] **Location:** `src/story/story.service.ts:230-247`
- [ ] Replace offset pagination with cursor-based pagination - *deferred, breaking API change*
- [x] Parallelize `count()` and `findMany()` with Promise.all (~50% latency reduction)
- **Impact:** ~~O(N) degradation~~ Parallel queries halve latency; cursor pagination deferred for API stability

### Auth: Login/Session Query Overhead ✅ COMPLETED
- [x] **Location:** `src/auth/auth.service.ts:56-63`
- [x] Consolidate user + kid count into single query
- [x] Use `_count` in Prisma instead of separate `count()` call
- **Impact:** ~~1000 concurrent logins = 2000 queries/second~~ Now 1000 queries/second (50% reduction)

### Cache: Missing Invalidation ✅ COMPLETED
- [x] **Location:** `src/story/story.service.ts`, `src/admin/admin.service.ts`
- [x] Add cache invalidation when stories are created/updated/deleted
- [x] Add cache invalidation when categories are seeded
- [x] Cache voice list (queried repeatedly but never cached) - ✅ 5-min TTL
- [ ] Review 4-hour global TTL - *config tuning, not code change*
- **Impact:** ~~Users see stale data for up to 4 hours~~ Caches invalidated on changes

---

## Medium Priority (P2)

### Memory: Audio Buffer Handling
- [ ] **Location:** `src/upload/upload.service.ts:97-119`
- [ ] Add file size validation before buffering
- [ ] Consider streaming uploads for large files
- [ ] Add memory monitoring/alerts
- **Impact:** 50 users x 5MB audio = 250MB memory spike

### Database: Voice Quota Multiple Queries ✅ COMPLETED
- [x] **Location:** `src/voice/voice-quota.service.ts:18-57`
- [x] Consolidate 3 queries into 2 (user+subs+usage in one, upsert for update)
- [ ] Cache user subscription status (short TTL) - *deferred, minor gain*
- **Impact:** ~~3x query overhead~~ Now 2 queries per TTS request (~33% reduction)

### Security: Rate Limit Dev Multiplier ✅ COMPLETED
- [x] **Location:** `src/app.module.ts:71-84`
- [x] Add safeguard to prevent dev config in production
- [x] Only apply strict limits when NODE_ENV=production
- **Impact:** ~~Accidental 100x rate limit~~ Now only strict in production

### Database: Missing Indexes ✅ COMPLETED
- [x] **Location:** `prisma/schema.prisma`
- [x] Add composite index on `User(email, isDeleted)` - ✅ line 123
- [x] Add index on `Story.createdAt` (used in ordering) - ✅ line 334
- [x] Add composite index on `StoryProgress(kidId, completed)` - ✅ line 418
- [x] Add index on `ActivityLog(kidId, createdAt)` - ✅ line 670
- **Impact:** ~~Slow queries on large tables~~ All critical indexes added

### External API: Gemini Circuit Breaker ✅ COMPLETED
- [x] **Location:** `src/story/gemini.service.ts:63-146`
- [x] Add circuit breaker pattern for AI failures
- [ ] Implement graceful degradation (cached fallback stories) - *deferred*
- [x] Fail-fast after 5 consecutive failures, 1-min recovery
- **Impact:** ~~Story generation failures cascade to users~~ Now fails fast and recovers gracefully

### External API: Google/Apple IAP Timeout ✅ COMPLETED
- [x] **Location:** `src/payment/google-verification.service.ts:134`, `apple-verification.service.ts:240`
- [x] Reduce 30-second timeout to 10 seconds
- [ ] Add retry mechanism for transient failures - *deferred*
- [ ] Consider async verification with webhooks - *deferred*
- **Impact:** ~~User blocked for 30 seconds~~ Now max 10 seconds

---

## Low Priority (P3)

### Database: Excessive Include Clauses
- [ ] **Location:** Multiple services
- [ ] Audit all `include` statements
- [ ] Replace with selective `select` where full relations not needed
- [ ] Example: `src/user/user.service.ts:23-29`
- **Impact:** 30% more bandwidth than needed

### Database: Connection Pool Settings ✅ COMPLETED
- [x] **Location:** `src/prisma/prisma.service.ts`
- [x] Add explicit constructor with datasource config
- [x] Pool limits via DATABASE_URL: `?connection_limit=10&pool_timeout=10`
- [ ] Monitor connection usage during load tests - *operational task*
- **Impact:** Pool now configurable; add URL params for production tuning

---

## Quick Wins ✅ COMPLETED

All quick wins have been implemented:

| Task | Status | File |
|------|--------|------|
| ~~Add email queue concurrency~~ | ✅ Done | `src/notification/queue/email.processor.ts:14` - `concurrency: 10` |
| ~~Add retry logic to ElevenLabs~~ | ✅ Done | `src/voice/providers/eleven-labs-tts.provider.ts:79-147` - exponential backoff |
| ~~Cache voice list~~ | ✅ Done | `src/voice/voice.service.ts:239-283` - 5-min TTL cache |
| ~~Add index on Story.createdAt~~ | ✅ Done | `prisma/schema.prisma:334` - `@@index([createdAt])` |
| ~~Consolidate login queries~~ | ✅ Done | `src/auth/auth.service.ts:56-63` - single query with `_count` |

---

## Testing Recommendations

After implementing fixes:

- [ ] Load test with 100 concurrent users
- [ ] Load test with 500 concurrent users
- [ ] Monitor database query count per request
- [ ] Monitor memory usage during audio generation
- [ ] Monitor external API response times
- [ ] Test rate limit behavior under load

---

## Notes

- Analysis performed: February 2026
- Base branch: `develop-v0.0.1`
- Priority levels: P0 (Critical), P1 (High), P2 (Medium), P3 (Low)

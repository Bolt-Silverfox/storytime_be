# Performance Improvements Roadmap

This document tracks performance optimization opportunities in the Storytime backend.

> **Generated**: February 2026
> **Last Updated**: 2026-02-24
> **Priority Scale**: P0 (Critical) | P1 (High) | P2 (Medium) | P3 (Low)

---

## Table of Contents

1. [Database Optimizations](#1-database-optimizations)
2. [Caching Improvements](#2-caching-improvements)
3. [Query Optimizations](#3-query-optimizations)
4. [External Service Optimizations](#4-external-service-optimizations)
5. [Application-Level Optimizations](#5-application-level-optimizations)
6. [Monitoring & Observability](#6-monitoring--observability)
7. [Queue System Optimization](#7-queue-system-optimization)
8. [API Performance Patterns](#8-api-performance-patterns)
9. [Sequential Operations Optimization](#9-sequential-operations-optimization)

---

## 1. Database Optimizations

### 1.1 Missing Indexes (P0) ✅ COMPLETED

70+ indexes added for FK columns and query optimization. Migration: `prisma/migrations/20260208170000_add_comprehensive_indexes/`

### 1.2 Missing Transactions (P1) ✅ COMPLETED

Atomic transactions added to all critical operations:
- Payment + subscription processing
- Story CRUD with validation (categories, themes, seasons)
- User profile updates (avatar creation + user update)
- Auth registration (user creation + notification preferences)
- Email verification (token rotation)

### 1.3 N+1 Query Prevention (P1) ✅ COMPLETED

Sequential queries replaced with batched queries using `Promise.all()` and Prisma `include`:
- StoryService: `addFavorite`, `setProgress`, `getProgress`, etc.
- `assignDailyChallengeToAllKids()`: O(n×queries) → 4 upfront queries + batch creates
- `generateStoryForKid()`: Removed duplicate kid query, batched themes/categories fetch

### 1.4 Query Select Optimization (P2) ✅ COMPLETED

| Location | Status |
|----------|--------|
| `UserService` queries | ✅ `safeUserSelect` excludes `passwordHash`/`pinHash` |
| `AdminAnalyticsService` | ✅ Selective field fetching |
| `StoryService.getStories()` | ✅ Uses `excludeContent: true` via repository `findStories()` |

---

## 2. Caching Improvements

### 2.1 Current Cache Implementation ✅ GOOD

Two-tier caching (Redis + In-Memory) with event-driven invalidation.

### 2.2 Cache Coverage ✅ COMPLETE

| Data | TTL | Status |
|------|-----|--------|
| User preferences | 5 min | ✅ |
| Kid profiles | 5 min | ✅ (with event-driven invalidation) |
| Story categories | 1 hour | ✅ |
| Themes | 1 hour | ✅ |
| Seasons | 1 hour | ✅ |
| Voice list | 30 min | ✅ |
| Subscription status | 1 min | ✅ |
| Story buddy list | 1 hour | ✅ |
| Dashboard stats | varies | ✅ |

**Event-driven cache invalidation (2026-02-23):**
- `SubscriptionCacheListener` — invalidates subscription cache on create/change/cancel events
- `KidCacheListener` — invalidates kid profile + user kids cache on create/delete events

### 2.3 Cache Invalidation Strategy ✅ COMPLETE

Granular key-specific invalidation implemented via `CACHE_INVALIDATION` groups in `cache-keys.constants.ts`. Uses explicit key deletion per operation (not pattern-based bulk purges). Event-driven listeners handle cross-service invalidation.

---

## 3. Query Optimizations

### 3.1 Soft Delete Filtering ✅ GOOD

190+ instances of `isDeleted: false` — properly implemented.

### 3.2 Pagination ✅ COMPLETE

All list endpoints enforce max limit caps (100 items) via `Math.min(100, limit)` in controllers and `PaginationUtil.sanitize()` in admin endpoints.

### 3.3 Aggregation Queries ✅ COMPLETE

Using Prisma `.count()` and `groupBy` instead of fetching and counting in code. StoryService uses `countStories()` with `Promise.all()` for parallel count + fetch.

---

## 4. External Service Optimizations

### 4.1 AI Provider Calls (P1) ✅ COMPLETED

GeminiService has retry logic with exponential backoff (3 attempts, 1s-8s delay) and circuit breaker.

**Completed:**
- ✅ 30s request timeouts on ElevenLabs (per-request `timeoutInSeconds`), Deepgram (`Promise.race` timeout), ElevenLabs HTTP service (Axios `timeout`)

**Fallback handling already in place:**
- FCM: returns `{ successCount: 0 }` when unconfigured; processor try-catches log-and-continue
- NotificationService: per-channel try-catch, returns `{ success: false }` on failure
- Cloudinary health: returns `status: 'degraded'` on rate-limit/timeout
- AnalyticsEventListener: currently stubs (log-only) — add try-catch when real analytics SDK is integrated

### 4.2 Cloudinary Uploads (P2) ✅ LARGELY COMPLETE

- ✅ Audio uploads already run inside BullMQ processors (`VoiceProcessor` → `TextToSpeechService` → `uploadAudioBuffer`)
- ✅ Auto-optimization configured: `quality: 'auto'`, `format: 'webp'`, `500x500 crop: limit` on image uploads
- Avatar image uploads (~50KB webp) remain inline — fast enough to not warrant queue overhead

### 4.3 Email Queue ✅ GOOD

BullMQ with 5 retry attempts, exponential backoff, priority levels.

---

## 5. Application-Level Optimizations

### 5.1 Module Lazy Loading ⚠️ NOT RECOMMENDED

NestJS doesn't support Angular-style lazy loading for HTTP modules. All HTTP routes must be registered at startup. Not beneficial for monolithic REST APIs.

### 5.2 Response Compression ✅ COMPLETED

Gzip/deflate compression enabled for responses > 1KB (level 6, client opt-out via `x-no-compression` header).

### 5.3 Connection Pooling ✅ DONE

Configured via `DATABASE_URL` connection string parameters in `.env`.

### 5.4 Memory Management (P2) ✅ PARTIALLY COMPLETE

- ✅ Admin user CSV export uses chunked 1000-record pagination instead of single 10k fetch
- Analytics export deals with small aggregated data — no streaming needed

Memory monitoring covered by Terminus health checks (`checkHeap(500MB)`, `checkRSS(1GB)`) at `/health/system` and `/health/full`. Per-request memory tracking not recommended due to `process.memoryUsage()` overhead on every request.

---

## 6. Monitoring & Observability

### 6.1 Current State ✅

- Request logging middleware with tracing
- Health checks: DB, Redis, SMTP, Queue, Firebase, Cloudinary
- Request ID propagation via `X-Request-ID`
- OpenTelemetry metrics export (`src/otel-setup.ts`)
- Cache metrics tracking (CacheMetricsService with hit/miss, latency)
- Prisma slow query logging (>100ms threshold in development)

**Health Endpoints:**
```
GET /health          - Liveness
GET /health/ready    - Readiness (DB, Redis, Queues)
GET /health/db       - Database
GET /health/redis    - Redis
GET /health/smtp     - SMTP
GET /health/queues   - All queues (email, story, voice)
GET /health/firebase - Firebase/FCM
GET /health/cloudinary - Cloudinary
GET /health/external - All external services
GET /health/system   - Memory + Disk
GET /health/full     - All indicators
```

### 6.2 Metrics ✅ LARGELY COMPLETE

| Metric | Status |
|--------|--------|
| Query execution time | ✅ Prisma middleware |
| Cache hit/miss ratio | ✅ CacheMetricsService |
| Request duration | ✅ Middleware |
| Memory usage | ✅ Health check |
| Queue depth | ✅ QueueHealthIndicator |
| External API latency | ✅ HttpLatencyInterceptor (Axios) |

**Completed:**
- ✅ Alerting thresholds configured in `src/shared/config/alerting.config.ts` (WARNING/CRITICAL levels for response time, DB query time, external API time, error rate, cache hit ratio, queue depth, memory, disk)

**Pending:**
- [ ] Create custom Grafana dashboards (community dashboards available via GRAFANA_SETUP.md)

---

## 7. Queue System Optimization

### 7.1 Queue Implementation ✅ COMPLETE

| Queue | Location | Status |
|-------|----------|--------|
| Email | `src/notification/` | ✅ BullMQ, 5 retries, exponential backoff |
| Story generation | `src/story/queue/` | ✅ Processor, service, constants |
| Voice synthesis | `src/voice/queue/` | ✅ Processor, service, constants |

### 7.2 Queue Health ✅ COMPLETE

`QueueHealthIndicator` monitors all 3 queues with per-queue health endpoints. Bull Board dashboard configured at `/admin/queues` with `@bull-board/nestjs`.

---

## 8. API Performance Patterns

### 8.1 Response Optimization (P1) ✅ COMPLETE

- `StoryListItemDto` for lightweight list views (id, title, coverImageUrl, language, age range, aiGenerated, recommended, durationSeconds, createdAt)
- `PaginatedStoriesDto` references `StoryListItemDto` for proper Swagger documentation
- Repository `findStories()` uses `excludeContent: true` to exclude `textContent` at DB level

### 8.2 Compression & Headers ✅ COMPLETE

Gzip compression (1KB threshold), Helmet security headers, CORS with 24h preflight caching.

---

## 9. Sequential Operations Optimization ✅ COMPLETED

Batch operations replacing sequential loops:

| File | Optimization |
|------|-------------|
| `notification-preference.service.ts` | Sequential `for...of` → batched `$transaction` |
| `story-buddy.seeder.ts` | Sequential creates → `createMany` with `skipDuplicates` |
| `avatar.seeder.service.ts` | Two sequential loops → single `$transaction` |
| `backfill-duration.ts` | Sequential updates → chunked batch updates (100/tx) |

---

## Progress Summary

### Completed ✅
- Database indexes: 70+ indexes added
- Transactions: All critical operations atomic
- N+1 queries: Batched across StoryService, DailyChallengeService
- Response compression: 1KB threshold, level 6
- Caching: All static content + user data with event-driven invalidation
- Cache invalidation: Granular key-specific with event-driven listeners
- AI retry logic: GeminiService with exponential backoff
- Queue system: Email, story, voice queues with health monitoring + Bull Board
- OpenTelemetry: Metrics export, cache metrics, slow query logging
- Health checks: All services (DB, Redis, SMTP, Queue, Firebase, Cloudinary)
- Sequential operations: Batched transactions replacing loops
- Push notifications (FCM) + SSE
- Query select optimization: UserService, AdminAnalytics, StoryService (excludeContent)
- Pagination: Max limit caps enforced on all list endpoints
- Aggregation queries: Using `.count()` and `groupBy` properly
- Connection pooling: Configured via DATABASE_URL
- External API timeouts: 30s on ElevenLabs, Deepgram, all HTTP services
- HTTP latency tracking: OpenTelemetry Axios interceptor on story, voice, notification modules
- Response DTOs: StoryListItemDto for lightweight list views
- Admin export chunking: 1000-record batches replacing single 10k fetch
- Alerting thresholds: WARNING/CRITICAL levels configured in `src/shared/config/alerting.config.ts`
- Cloudinary optimization: auto-quality, webp format, size limits on image uploads
- Cloudinary audio uploads: already in BullMQ queue processors (VoiceProcessor)
- External API fallbacks: FCM, Notification, Cloudinary health all have graceful degradation

### Pending 📋

- [ ] Custom Grafana dashboards (P3 — requires external infrastructure setup)

---

## References

- [Prisma Performance Guide](https://www.prisma.io/docs/guides/performance-and-optimization)
- [NestJS Caching](https://docs.nestjs.com/techniques/caching)
- [BullMQ Best Practices](https://docs.bullmq.io/guide/going-to-production)
- [OpenTelemetry for Node.js](https://opentelemetry.io/docs/instrumentation/js/)

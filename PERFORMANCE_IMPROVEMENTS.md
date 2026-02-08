# Performance Improvements Roadmap

This document tracks performance optimization opportunities in the Storytime backend.

> **Generated**: February 2026
> **Priority Scale**: P0 (Critical) | P1 (High) | P2 (Medium) | P3 (Low)

---

## Table of Contents

1. [Database Optimizations](#1-database-optimizations)
2. [Caching Improvements](#2-caching-improvements)
3. [Query Optimizations](#3-query-optimizations)
4. [External Service Optimizations](#4-external-service-optimizations)
5. [Application-Level Optimizations](#5-application-level-optimizations)

---

## 1. Database Optimizations

### 1.1 Missing Indexes (P0 - Critical) ✅ COMPLETED

**Status**: Fixed in commit `90d0274`

Added 70+ indexes for FK columns and query optimization:
- User/Kid FK indexes (`parentId`, `avatarId`, `preferredVoiceId`, `storyBuddyId`)
- Story optimizations (`creatorKidId`, `language`, `aiGenerated`, `recommended`, age range)
- Progress tracking indexes
- Payment/Subscription indexes
- And many more...

**Migration**: `prisma/migrations/20260208170000_add_comprehensive_indexes/`

### 1.2 Missing Transactions (P1 - High)

Only **9 instances** of `$transaction` across all services. Multi-step operations need atomic transactions.

| Service | Operation | Risk | Priority |
|---------|-----------|------|----------|
| `UserService` | User profile update with preferences | Data inconsistency | P1 |
| `SubscriptionService` | Subscription + payment record | Orphaned records | P0 |
| `StoryService` | Story creation with images/paths | Partial creation | P1 |
| `AuthService` | User registration + session | Orphaned sessions | P1 |
| `KidService` | Kid creation with preferences | Partial creation | P2 |

**Current Transaction Usage:**
```typescript
// Found in: src/auth/auth.service.ts, src/admin/admin.service.ts, etc.
await this.prisma.$transaction(async (tx) => {
  // Operations here
});
```

**Action Items:**
- [ ] Add transactions to `SubscriptionService` for plan changes
- [ ] Add transactions to `StoryService` for story creation
- [ ] Add transactions to `UserService` for profile updates
- [ ] Add transactions to `AuthService` for registration flow
- [ ] Document transaction patterns in CLAUDE.md

### 1.3 N+1 Query Prevention (P1 - High)

Some operations use sequential queries that could be batched:

| File | Line | Issue | Solution |
|------|------|-------|----------|
| `src/story/story.service.ts` | 253 | Sequential `findMany` calls | Use `Promise.all()` or single query with includes |
| `src/story/story.service.ts` | 363-378 | Multiple separate queries | Batch into single query |
| `src/story/story.service.ts` | 393-413 | Loop with individual queries | Use `findMany` with `where: { id: { in: ids } }` |

**Example Fix:**
```typescript
// ❌ N+1 Problem
for (const kidId of kidIds) {
  const kid = await this.prisma.kid.findUnique({ where: { id: kidId } });
  results.push(kid);
}

// ✅ Batched Query
const kids = await this.prisma.kid.findMany({
  where: { id: { in: kidIds } }
});
```

**Action Items:**
- [ ] Audit all `for` loops with database queries
- [ ] Replace sequential queries with batched queries
- [ ] Use Prisma `include` for related data instead of separate queries

### 1.4 Query Select Optimization (P2 - Medium)

Many queries fetch all columns when only a few are needed:

| Location | Issue | Optimization |
|----------|-------|--------------|
| `StoryService.findAll()` | Fetches all story fields | Add `select` for list views |
| `UserService.findOne()` | Fetches password hash unnecessarily | Exclude sensitive fields |
| `AdminService` dashboard queries | Full records for counts | Use `_count` aggregations |

**Example:**
```typescript
// ❌ Fetches everything
const stories = await this.prisma.story.findMany();

// ✅ Select only needed fields
const stories = await this.prisma.story.findMany({
  select: {
    id: true,
    title: true,
    coverImageUrl: true,
    createdAt: true,
  }
});
```

**Action Items:**
- [ ] Add `select` to list/index queries
- [ ] Create DTOs that map to select fields
- [ ] Never fetch `passwordHash` outside auth operations

---

## 2. Caching Improvements

### 2.1 Current Cache Implementation (P2 - Medium)

**Positive findings:**
- Two-tier caching (Redis + In-Memory) is implemented
- `STORY_INVALIDATION_KEYS` constant for cache management
- Dashboard stats caching in `AdminService`

**Files:**
- `src/story/story.service.ts` (Lines 63-71) - Story cache invalidation
- `src/admin/admin.service.ts` (Lines 75-81) - Dashboard caching

### 2.2 Missing Cache Opportunities (P2 - Medium)

| Data | TTL Suggestion | Cache Key Pattern | Priority |
|------|----------------|-------------------|----------|
| User preferences | 5 min | `user:${userId}:preferences` | P2 |
| Kid profiles | 5 min | `kid:${kidId}:profile` | P2 |
| Story categories | 1 hour | `categories:all` | P3 |
| Voice list | 30 min | `voices:all` | P3 |
| Subscription status | 1 min | `user:${userId}:subscription` | P1 |
| Story buddy list | 1 hour | `story-buddies:all` | P3 |

**Action Items:**
- [ ] Cache subscription status checks (frequently accessed)
- [ ] Cache user preferences
- [ ] Implement cache warming for static data (categories, voices, buddies)

### 2.3 Cache Invalidation Strategy (P2 - Medium)

Current approach invalidates all caches on updates. Consider granular invalidation:

```typescript
// Current: Invalidates everything
await this.cacheService.invalidatePattern('stories:*');

// Better: Invalidate specific keys
await this.cacheService.del(`story:${storyId}`);
await this.cacheService.del(`stories:recommended`);
```

**Action Items:**
- [ ] Implement key-specific cache invalidation
- [ ] Add cache tags for group invalidation
- [ ] Document cache invalidation patterns

---

## 3. Query Optimizations

### 3.1 Soft Delete Filtering (P3 - Low) ✅ GOOD

**Status**: Well implemented with 190+ instances of `isDeleted: false`

All queries properly filter soft-deleted records.

### 3.2 Pagination Implementation (P2 - Medium)

Verify all list endpoints use cursor-based or offset pagination:

| Endpoint | Has Pagination | Type |
|----------|----------------|------|
| `GET /stories` | ✅ Yes | Offset |
| `GET /admin/users` | ✅ Yes | Offset |
| `GET /notifications` | ⚠️ Check | Unknown |
| `GET /activity-logs` | ⚠️ Check | Unknown |

**Recommendation**: Use cursor-based pagination for large datasets:

```typescript
// Cursor-based pagination
const stories = await this.prisma.story.findMany({
  take: 20,
  skip: 1,
  cursor: { id: lastStoryId },
  orderBy: { createdAt: 'desc' },
});
```

**Action Items:**
- [ ] Audit all list endpoints for pagination
- [ ] Implement cursor-based pagination for infinite scroll
- [ ] Add `limit` validation (max 100 items)

### 3.3 Aggregation Queries (P2 - Medium)

Use Prisma aggregations instead of fetching and counting in code:

```typescript
// ❌ Inefficient
const stories = await this.prisma.story.findMany({ where: { kidId } });
const count = stories.length;

// ✅ Efficient
const count = await this.prisma.story.count({ where: { kidId } });

// ✅ Even better - grouped counts
const stats = await this.prisma.story.groupBy({
  by: ['language'],
  _count: { id: true },
});
```

**Action Items:**
- [ ] Replace `.length` counts with `.count()` queries
- [ ] Use `groupBy` for analytics queries
- [ ] Use `aggregate` for sum/avg calculations

---

## 4. External Service Optimizations

### 4.1 AI Provider Calls (P1 - High)

External API calls to Gemini, ElevenLabs, Deepgram need optimization:

| Service | Issue | Solution |
|---------|-------|----------|
| `GeminiService` | No retry logic | Implement exponential backoff |
| `ElevenLabsTtsProvider` | No timeout | Add request timeout |
| `DeepgramSttProvider` | No circuit breaker | Implement circuit breaker pattern |

**Recommended Pattern:**
```typescript
// Retry with exponential backoff
async callWithRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      await this.delay(Math.pow(2, i) * 1000);
    }
  }
}
```

**Action Items:**
- [ ] Add retry logic to all AI provider calls
- [ ] Implement circuit breaker for external services
- [ ] Add request timeouts (30s max)
- [ ] Add fallback responses for non-critical failures

### 4.2 Cloudinary Uploads (P2 - Medium)

| Issue | Solution |
|-------|----------|
| Large image uploads block request | Use background job queue |
| No image optimization | Enable Cloudinary transformations |
| No upload progress | Consider chunked uploads for large files |

**Action Items:**
- [ ] Move large uploads to BullMQ background jobs
- [ ] Configure Cloudinary auto-optimization
- [ ] Add upload size limits

### 4.3 Email Queue (P3 - Low) ✅ GOOD

**Status**: Well implemented with BullMQ

- 5 retry attempts with exponential backoff
- Priority levels (HIGH, NORMAL, LOW)
- Failed jobs kept for 7 days

---

## 5. Application-Level Optimizations

### 5.1 Module Lazy Loading (P2 - Medium)

Consider lazy loading for infrequently used modules:

```typescript
// In app.module.ts
@Module({
  imports: [
    // Eager load core modules
    AuthModule,
    UserModule,

    // Lazy load admin module
    import('./admin/admin.module').then(m => m.AdminModule),
  ],
})
```

**Candidates for Lazy Loading:**
- `AdminModule` - Only used by admins
- `ReportsModule` - Infrequently accessed
- `HelpSupportModule` - Occasional use

**Action Items:**
- [ ] Measure startup time
- [ ] Implement lazy loading for admin features
- [ ] Monitor cold start times after changes

### 5.2 Response Compression (P3 - Low)

Verify compression is enabled for API responses:

```typescript
// In main.ts
import compression from 'compression';
app.use(compression());
```

**Action Items:**
- [ ] Verify compression middleware is enabled
- [ ] Configure compression threshold (1kb minimum)

### 5.3 Connection Pooling (P2 - Medium)

Verify Prisma connection pool is properly configured:

```prisma
// In schema.prisma datasource
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
  // Add connection pool settings
}
```

**Recommended settings for production:**
```
DATABASE_URL="postgresql://...?connection_limit=20&pool_timeout=30"
```

**Action Items:**
- [ ] Configure connection pool limits based on server capacity
- [ ] Monitor connection pool usage
- [ ] Add connection pool health check

### 5.4 Memory Management (P2 - Medium)

Large services may cause memory issues:

| Service | Lines | Risk |
|---------|-------|------|
| `AdminService` | 2,121 | High memory for large reports |
| `StoryService` | 1,772 | Story generation buffers |

**Action Items:**
- [ ] Implement streaming for large data exports
- [ ] Use pagination for report generation
- [ ] Add memory usage monitoring

---

## 6. Monitoring & Observability

### 6.1 Current State

- Request logging middleware with tracing ✅
- Health checks for DB, Redis, SMTP, Queue ✅

### 6.2 Missing Metrics (P2 - Medium)

| Metric | Purpose | Priority |
|--------|---------|----------|
| Query execution time | Identify slow queries | P1 |
| Cache hit/miss ratio | Cache effectiveness | P2 |
| External API latency | Provider performance | P1 |
| Memory usage per endpoint | Resource planning | P3 |

**Action Items:**
- [ ] Add Prisma query logging in development
- [ ] Implement cache metrics
- [ ] Add APM integration (DataDog, New Relic, etc.)

---

## Progress Tracking

### Completed ✅
- [x] Database indexes optimization (70+ indexes added)
- [x] Email queue with retry logic (BullMQ)
- [x] Health checks implementation
- [x] Request logging middleware

### In Progress 🔄
- [ ] Transaction coverage improvement
- [ ] N+1 query fixes

### Pending 📋
- [ ] Cache strategy improvements
- [ ] External service retry logic
- [ ] Lazy loading implementation
- [ ] APM integration

---

## Quick Wins (Can be done in < 1 day each)

1. **Add transactions to subscription operations** - Prevents payment/subscription mismatch
2. **Cache subscription status** - Reduces DB calls on every authenticated request
3. **Add request timeouts to AI providers** - Prevents hanging requests
4. **Use `select` in list queries** - Reduces data transfer
5. **Replace sequential queries with batch** - Quick N+1 fixes

---

## References

- [Prisma Performance Guide](https://www.prisma.io/docs/guides/performance-and-optimization)
- [NestJS Caching](https://docs.nestjs.com/techniques/caching)
- [BullMQ Best Practices](https://docs.bullmq.io/guide/going-to-production)
- Project guidelines: `.claude/CLAUDE.md`

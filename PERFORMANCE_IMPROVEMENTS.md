# Performance Improvements Roadmap

This document tracks performance optimization opportunities in the Storytime backend.

> **Generated**: February 2026
> **Last Updated**: February 2026
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
9. [Prisma v7 Upgrade Considerations](#9-prisma-v7-upgrade-considerations)
10. [Repository Pattern Implementation](#10-repository-pattern-implementation)
11. [Test Coverage Expansion](#11-test-coverage-expansion)
12. [Rate Limiting Coverage](#12-rate-limiting-coverage)
13. [Custom Domain Exceptions](#13-custom-domain-exceptions)
14. [Event-Driven Architecture Expansion](#14-event-driven-architecture-expansion)
15. [Sequential Operations Optimization](#15-sequential-operations-optimization)

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

### 1.2 Missing Transactions (P1 - High) ✅ COMPLETED

**Status**: Fixed by Instance 3, 4 & 16 (February 2026)

Added atomic transactions to critical operations:
- `PaymentService.processPaymentAndSubscriptionAtomic()` - Combined payment + subscription in single transaction
- `StoryService.createStory()` - Transaction with validation for categories, themes, seasons
- `StoryService.updateStory()` - Transaction with validation for categories, themes, seasons
- `StoryService.persistGeneratedStory()` - Atomic story creation with all related data
- `UserService.updateUser()` - Avatar creation + user update atomic (Instance 16)
- `UserService.updateParentProfile()` - Learning expectations delete + create atomic (Instance 16)
- `AuthService.register()` - User creation + notification preferences atomic (Instance 16)
- `AuthService.sendEmailVerification()` - Token rotation atomic (Instance 16)
- `AuthService.verifyEmail()` - User update + token deletion atomic (Instance 16)

**Action Items:**
- [x] Add transactions to `SubscriptionService` for plan changes *(Instance 3)*
- [x] Add transactions to `StoryService` for story creation *(Instance 4)*
- [x] Add transactions to `UserService` for profile updates *(Instance 16)*
- [x] Add transactions to `AuthService` for registration flow *(Instance 16)*
- [ ] Document transaction patterns in CLAUDE.md

### 1.3 N+1 Query Prevention (P1 - High) ✅ COMPLETED

**Status**: Fixed by Instance 4 & 5 (February 2026)

Batched sequential queries using `Promise.all()` in StoryService:
- `addFavorite`, `setProgress`, `getProgress`, `setUserProgress`, `getUserProgress`
- `restrictStory`, `assignDailyChallenge`, `startStoryPath`, `adjustReadingLevel`, `recommendStoryToKid`
- `assignDailyChallengeToAllKids()` - Refactored from O(n×queries) to 4 upfront queries + batch creates
- `generateStoryForKid()` - Removed duplicate kid query, batched themes/categories fetch

**Example Fix Applied:**
```typescript
// ❌ Before: N+1 Problem
for (const kidId of kidIds) {
  const kid = await this.prisma.kid.findUnique({ where: { id: kidId } });
  results.push(kid);
}

// ✅ After: Batched Query
const kids = await this.prisma.kid.findMany({
  where: { id: { in: kidIds } }
});
```

**Action Items:**
- [x] Audit all `for` loops with database queries *(Instance 4)*
- [x] Replace sequential queries with batched queries *(Instance 4 & 5)*
- [x] Use Prisma `include` for related data instead of separate queries *(Instance 4)*

### 1.4 Query Select Optimization (P2 - Medium) ✅ PARTIALLY COMPLETED

**Status**: UserService optimizations completed (February 2026)

Many queries fetch all columns when only a few are needed:

| Location | Issue | Optimization | Status |
|----------|-------|--------------|--------|
| `StoryService.getStories()` | Fetches all story fields | Add `select` for list views | ⏳ Pending |
| `UserService.getUser()` | Fetches password hash unnecessarily | Exclude sensitive fields | ✅ Completed |
| `AdminService` dashboard queries | Full records for counts | Use `_count` aggregations | ✅ Already optimized |

**Implementation Details:**

Added `safeUserSelect` constant in `UserService` that explicitly selects all user fields except `passwordHash` and `pinHash` at the database level. Applied to:
- `getUser()` - Single user lookup
- `getUserIncludingDeleted()` - User lookup including soft-deleted
- `getAllUsers()` - Admin user list
- `getActiveUsers()` - Active user list

```typescript
// ✅ safeUserSelect excludes passwordHash and pinHash at DB level
const safeUserSelect = {
  id: true,
  email: true,
  name: true,
  // ... all other safe fields
  // Explicitly excludes: passwordHash, pinHash
} satisfies Prisma.UserSelect;

const user = await this.prisma.user.findUnique({
  where: { id },
  select: {
    ...safeUserSelect,
    profile: true,
    kids: true,
  },
});
```

**Action Items:**
- [x] Never fetch `passwordHash` outside auth operations
- [x] Add `select` to UserService queries
- [ ] Add `select` to StoryService list queries (exclude `textContent` for list views)
- [ ] Create DTOs that map to select fields

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

### 2.2 Missing Cache Opportunities (P2 - Medium) ✅ PARTIALLY COMPLETED

| Data | TTL | Cache Key Pattern | Status |
|------|-----|-------------------|--------|
| User preferences | 5 min | `user:${userId}:preferences` | ⏳ Pending |
| Kid profiles | 5 min | `kid:${kidId}:profile` | ⏳ Pending |
| Story categories | 1 hour | `categories:all` | ✅ Implemented |
| Themes | 1 hour | `themes:all` | ✅ Implemented |
| Seasons | 1 hour | `seasons:all` | ✅ Implemented |
| Voice list | 30 min | `voices:all` | ⏳ Already exists |
| Subscription status | 1 min | `user:${userId}:subscription` | ✅ Already implemented |
| Story buddy list | 1 hour | `story-buddies:all` | ✅ Implemented |

**Completed:**
- ✅ Static content caching (categories, themes, seasons, buddies) with 1-hour TTL
- ✅ Subscription status caching (1-min TTL) - was already implemented
- ✅ Cache invalidation on CRUD operations

**Remaining:**
- [ ] Cache user preferences
- [ ] Cache kid profiles

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

### 4.1 AI Provider Calls (P1 - High) ✅ COMPLETED

**Status**: Fixed by Instance 3 (February 2026)

Added retry logic with exponential backoff to GeminiService:
- `RETRY_CONFIG`: 3 attempts, 1s base delay, 8s max delay
- `isTransientError()` - Identifies retryable errors (429, 503, 500, network issues)
- `sleep()`, `getBackoffDelay()` - Helper functions for backoff
- Circuit breaker failure only recorded after all retries exhausted

**Implementation:**
```typescript
// src/story/gemini.service.ts
const RETRY_CONFIG = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  maxDelayMs: 8000,
};

// Retry loop for transient errors
for (let attempt = 1; attempt <= RETRY_CONFIG.maxAttempts; attempt++) {
  try {
    return await this.callGemini(prompt);
  } catch (error) {
    if (!this.isTransientError(error) || attempt === RETRY_CONFIG.maxAttempts) {
      throw error;
    }
    await this.sleep(this.getBackoffDelay(attempt));
  }
}
```

**Action Items:**
- [x] Add retry logic to all AI provider calls *(Instance 3 - GeminiService)*
- [x] Implement circuit breaker for external services *(already existed in GeminiService)*
- [ ] Add request timeouts (30s max) to ElevenLabs/Deepgram
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

### 5.1 Module Lazy Loading (P2 - Medium) ⚠️ NOT RECOMMENDED FOR THIS ARCHITECTURE

**Analysis Complete**: NestJS doesn't support Angular-style lazy loading for HTTP modules. The `LazyModuleLoader` service is designed for:
- CLI applications with on-demand features
- Microservices with dynamic module loading
- CRON jobs that need modules occasionally

**Why not applicable:**
- All HTTP routes must be registered at startup
- Module dependencies require eager loading for DI to work
- Minimal benefit for monolithic REST APIs (code is already bundled)

**Better optimizations implemented:**
- ✅ Response compression (reduces payload size)
- ✅ Static content caching (categories, themes, buddies, seasons)
- ✅ Subscription status caching

**Alternative Considered:** Deferred initialization within modules (lazy service initialization). This would defer expensive operations until first request, but current services don't have expensive constructors.

### 5.2 Response Compression (P3 - Low) ✅ COMPLETED

**Implementation:** Response compression enabled for all responses > 1KB.

```typescript
// In main.ts - IMPLEMENTED
import compression from 'compression';
app.use(
  compression({
    filter: (req, res) => {
      if (req.headers['x-no-compression']) return false;
      return compression.filter(req, res);
    },
    threshold: 1024, // Only compress responses > 1KB
    level: 6,        // Balanced speed/ratio
  }),
);
```

**Benefits:**
- Gzip/deflate compression for all qualifying responses
- Configurable threshold (1KB) to avoid compressing small payloads
- Client can opt-out via `x-no-compression` header

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

### 6.1 Current State ✅

- Request logging middleware with tracing ✅
- Health checks for DB, Redis, SMTP, Queue ✅
- Request ID propagation via `X-Request-ID` header ✅

### 6.2 Metrics Implementation (P1 - High)

**Required Metrics:**

| Metric | Purpose | Priority | Implementation |
|--------|---------|----------|----------------|
| Query execution time | Identify slow queries | P1 | Prisma middleware |
| Cache hit/miss ratio | Cache effectiveness | P1 | Cache interceptor |
| External API latency | Provider performance | P1 | HTTP interceptor |
| Request duration | API performance | P1 | Already implemented |
| Memory usage | Resource planning | P2 | Health check |
| Queue depth | Processing backlog | P1 | BullMQ metrics |

**Prisma Query Logging:** ✅ IMPLEMENTED

```typescript
// prisma/prisma.service.ts - Using event-based logging (Prisma 6.x compatible)
const SLOW_QUERY_THRESHOLD_MS = 100;

// In constructor - enable query event logging in development
log: process.env.NODE_ENV === 'development'
  ? [
      { emit: 'event', level: 'query' },
      { emit: 'stdout', level: 'warn' },
      { emit: 'stdout', level: 'error' },
    ]
  : [{ emit: 'stdout', level: 'error' }],

// Set up query event listener
private setupQueryLogging(): void {
  this.$on('query', (e: Prisma.QueryEvent) => {
    if (e.duration > SLOW_QUERY_THRESHOLD_MS) {
      this.logger.warn(`Slow query detected (${e.duration}ms): ${e.query}`);
    }
  });
}
```

**Cache Metrics Interceptor:**
```typescript
@Injectable()
export class CacheMetricsInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    const cacheKey = this.getCacheKey(context);

    return from(this.cacheService.get(cacheKey)).pipe(
      tap(cached => {
        if (cached) {
          this.metrics.increment('cache.hit');
        } else {
          this.metrics.increment('cache.miss');
        }
      }),
      switchMap(() => next.handle())
    );
  }
}
```

### 6.3 APM Integration (P2 - Medium)

**Recommended: OpenTelemetry + Grafana Stack**

```typescript
// tracing.ts
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

const sdk = new NodeSDK({
  traceExporter: new OTLPTraceExporter({
    url: process.env.OTEL_EXPORTER_ENDPOINT,
  }),
  instrumentations: [
    new HttpInstrumentation(),
    new NestInstrumentation(),
    new PrismaInstrumentation(),
  ],
});

sdk.start();
```

**Dashboard Panels:**
- Request rate (req/s)
- Error rate (%)
- P50, P95, P99 latency
- Database query time
- Cache hit ratio
- Queue depth and processing time

**Action Items:**
- [x] Add Prisma query logging middleware ✅
- [ ] Implement cache metrics
- [ ] Set up OpenTelemetry SDK
- [ ] Create Grafana dashboards
- [ ] Configure alerting thresholds

---

## 7. Queue System Optimization

### 7.1 Current BullMQ Implementation ✅

**Email Queue Configuration:**
- 5 retry attempts with exponential backoff
- Delays: 30s → 1m → 2m → 4m → 8m
- Priority levels: HIGH, NORMAL, LOW
- Failed jobs retained for 7 days

### 7.2 Queue Best Practices (P1 - High)

**Job Configuration Pattern:**
```typescript
// queue/constants.ts
export const QUEUE_NAMES = {
  EMAIL: 'email-queue',
  STORY_GENERATION: 'story-generation',
  IMAGE_PROCESSING: 'image-processing',
  VOICE_SYNTHESIS: 'voice-synthesis',
} as const;

export const JOB_PRIORITY = {
  HIGH: 1,    // Auth emails, urgent notifications
  NORMAL: 5,  // Story generation, regular emails
  LOW: 10,    // Analytics, batch processing
} as const;

export const RETRY_CONFIG = {
  EMAIL: { attempts: 5, backoff: { type: 'exponential', delay: 30000 } },
  AI_GENERATION: { attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
  IMAGE: { attempts: 2, backoff: { type: 'fixed', delay: 10000 } },
} as const;
```

**Processor Pattern (WorkerHost):**
```typescript
@Processor(QUEUE_NAMES.STORY_GENERATION)
export class StoryGenerationProcessor extends WorkerHost {
  async process(job: Job<StoryGenerationData>) {
    switch (job.name) {
      case 'generate-story': return this.handleGeneration(job);
      case 'generate-images': return this.handleImages(job);
      default: throw new Error(`Unknown job: ${job.name}`);
    }
  }

  private async handleGeneration(job: Job) {
    try {
      // Processing logic
      await job.updateProgress(50);
      // More processing
      await job.updateProgress(100);
    } catch (error) {
      // Always cleanup on failure
      this.logger.error(`Job ${job.id} failed`, error.stack);
      throw error; // Re-throw for retry
    }
  }
}
```

### 7.3 Queue Health Monitoring (P1 - High)

```typescript
// health/indicators/queue.health.ts
@Injectable()
export class QueueHealthIndicator extends HealthIndicator {
  async isHealthy(key: string) {
    const stats = await this.emailQueue.getJobCounts();

    const isHealthy = stats.waiting < 1000 && stats.failed < 100;

    return this.getStatus(key, isHealthy, {
      waiting: stats.waiting,
      active: stats.active,
      completed: stats.completed,
      failed: stats.failed,
    });
  }
}
```

### 7.4 New Queue Opportunities (P2 - Medium)

| Operation | Current | Recommended |
|-----------|---------|-------------|
| Story generation | Sync | Background queue |
| Voice synthesis | Sync | Background queue |
| Image processing | Sync | Background queue |
| Report generation | Sync | Background queue |
| Bulk notifications | Sync | Background queue |

**Action Items:**
- [ ] Create `story-generation` queue for AI operations
- [ ] Create `voice-synthesis` queue for TTS operations
- [ ] Add queue dashboard (Bull Board)
- [ ] Implement queue metrics in monitoring

---

## 8. API Performance Patterns

### 8.1 Response Optimization (P1 - High)

**Use DTOs with Selective Fields:**
```typescript
// ✅ Story list DTO (minimal fields)
export class StoryListItemDto {
  @Expose() id: string;
  @Expose() title: string;
  @Expose() coverImageUrl: string;
  @Expose() createdAt: Date;
}

// ✅ Story detail DTO (full fields)
export class StoryDetailDto extends StoryListItemDto {
  @Expose() content: string;
  @Expose() audioUrl: string;
  @Expose() @Type(() => KidDto) kid: KidDto;
}
```

**Transform at Response Level:**
```typescript
@Get()
async findAll(): Promise<StoryListItemDto[]> {
  const stories = await this.storyService.findAll({
    select: { id: true, title: true, coverImageUrl: true, createdAt: true }
  });
  return plainToInstance(StoryListItemDto, stories, { excludeExtraneousValues: true });
}
```

### 8.2 Pagination Patterns (P1 - High)

**Cursor-Based Pagination (Recommended for Infinite Scroll):**
```typescript
@Get()
async findAll(
  @Query('cursor') cursor?: string,
  @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit?: number,
) {
  const maxLimit = Math.min(limit, 100); // Cap at 100

  const stories = await this.prisma.story.findMany({
    take: maxLimit + 1, // Fetch one extra to check hasMore
    ...(cursor && { skip: 1, cursor: { id: cursor } }),
    orderBy: { createdAt: 'desc' },
    where: { isDeleted: false },
  });

  const hasMore = stories.length > maxLimit;
  const items = hasMore ? stories.slice(0, -1) : stories;
  const nextCursor = hasMore ? items[items.length - 1].id : null;

  return { items, nextCursor, hasMore };
}
```

**Offset Pagination (For Admin Pages):**
```typescript
@Get()
async findAll(
  @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
  @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
) {
  const skip = (page - 1) * limit;
  const [items, total] = await Promise.all([
    this.prisma.story.findMany({ skip, take: limit }),
    this.prisma.story.count(),
  ]);

  return {
    items,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    },
  };
}
```

### 8.3 Rate Limiting Configuration (P1 - High)

```typescript
// Current throttle config - verify these are optimal
export const THROTTLE_CONFIG = {
  DEFAULT: { ttl: 60000, limit: 100 },      // 100 req/min
  AUTH: { ttl: 60000, limit: 10 },          // 10 req/min for auth
  STORY_GENERATION: { ttl: 60000, limit: 5 }, // 5 req/min for AI
  ADMIN: { ttl: 60000, limit: 200 },        // 200 req/min for admin
};
```

### 8.4 Compression & Headers (P2 - Medium)

```typescript
// main.ts
import compression from 'compression';

app.use(compression({
  filter: (req, res) => {
    if (req.headers['x-no-compression']) return false;
    return compression.filter(req, res);
  },
  threshold: 1024, // Only compress > 1KB
}));

// Security headers via Helmet
app.use(helmet());

// CORS with caching
app.enableCors({
  origin: process.env.CORS_ORIGINS?.split(','),
  maxAge: 86400, // Cache preflight for 24 hours
});
```

**Action Items:**
- [ ] Implement cursor-based pagination for list endpoints
- [ ] Add response DTOs to limit data transfer
- [ ] Configure compression threshold
- [ ] Review rate limit configurations

---

## 10. Error Handling & Domain Exceptions ✅ COMPLETED

**Status**: Implemented (February 2026)

### 10.1 Custom Domain Exceptions Hierarchy

Created a structured exception hierarchy that provides:
- Machine-readable error codes for client-side handling
- Consistent error response format across the API
- Better debugging with contextual details
- Proper HTTP status codes

**Files Created:**
- `src/shared/exceptions/domain.exception.ts` - Exception classes
- `src/shared/exceptions/index.ts` - Export barrel

**Exception Categories:**

| Category | Exceptions | HTTP Status |
|----------|------------|-------------|
| Auth | `InvalidCredentialsException`, `TokenExpiredException`, `EmailNotVerifiedException`, `InvalidTokenException`, `InvalidAdminSecretException` | 400-403 |
| Resources | `ResourceNotFoundException`, `ResourceAlreadyExistsException` | 404, 409 |
| Business Logic | `QuotaExceededException`, `SubscriptionRequiredException`, `InvalidRoleException`, `ValidationException` | 400, 402, 429 |

**Implementation:**

```typescript
// Base class
export abstract class DomainException extends HttpException {
  constructor(
    public readonly code: string,      // Machine-readable code
    message: string,                    // Human-readable message
    status: HttpStatus,
    public readonly details?: Record<string, unknown>,  // Context
  ) {
    super({ code, message, details }, status);
  }
}

// Usage example
throw new ResourceNotFoundException('User', userId);
// Returns: { code: 'RESOURCE_NOT_FOUND', message: 'User with id xyz not found', details: { resource: 'User', id: 'xyz' } }
```

### 10.2 Exception Filter Integration

Updated `HttpExceptionFilter` to extract `code` and `details` from domain exceptions:

```typescript
if (exception instanceof DomainException) {
  code = exception.code;
  details = exception.details;
}
```

Updated `ErrorResponse` DTO with optional `code` and `details` fields for structured API error responses.

### 10.3 Services Updated

| Service | Exceptions Replaced |
|---------|---------------------|
| `AuthService` | InvalidCredentialsException, EmailNotVerifiedException, InvalidTokenException, TokenExpiredException, InvalidAdminSecretException, ResourceNotFoundException, ResourceAlreadyExistsException |
| `UserService` | ResourceNotFoundException, InvalidRoleException |

**Benefits:**
- ✅ Consistent error codes across API
- ✅ Client can programmatically handle specific errors
- ✅ Better error logging with context
- ✅ Reduced error message duplication

---

## 9. Prisma v7 Upgrade Considerations

### 9.1 Breaking Changes Impact (P2 - Medium)

When upgrading from Prisma 6.19 to v7:

| Change | Impact | Action Required |
|--------|--------|-----------------|
| ESM only | High | Add `"type": "module"` to package.json |
| Generator change | Medium | Update `prisma-client-js` → `prisma-client` |
| Output required | Medium | Add `output` to generator block |
| Driver adapters | High | Install `@prisma/adapter-pg` |
| No auto .env | Low | Add `dotenv/config` import |
| Config file | Medium | Create `prisma.config.ts` |
| Middleware removed | High | Migrate `$use()` to Extensions |

### 9.2 Performance Benefits

- **ESM tree-shaking**: Smaller bundle sizes
- **Driver adapters**: Direct database connections, reduced overhead
- **No query engine**: Faster cold starts

### 9.3 Migration Checklist

```bash
# 1. Upgrade packages
pnpm add @prisma/client@7
pnpm add -D prisma@7

# 2. Update generator
# generator client {
#   provider = "prisma-client"
#   output   = "./generated/prisma/client"
# }

# 3. Install adapter
pnpm add @prisma/adapter-pg

# 4. Create config file
# prisma.config.ts

# 5. Update imports
# import { PrismaClient } from './generated/prisma/client'

# 6. Update client instantiation
# const adapter = new PrismaPg(connectionString)
# const prisma = new PrismaClient({ adapter })
```

**Action Items:**
- [ ] Test Prisma v7 in development branch
- [ ] Migrate any `$use()` middleware to Extensions
- [ ] Update all Prisma imports
- [ ] Benchmark query performance after upgrade

---

## 10. Repository Pattern Implementation

### 10.1 Overview (P2 - Medium)

The repository pattern abstracts data access logic from business logic, improving:
- **Testability**: Mock repository interfaces instead of Prisma
- **Maintainability**: Data access logic centralized in one place
- **Flexibility**: Swap implementations (e.g., different databases)
- **Separation of Concerns**: Services focus on business logic only

**Reference Implementation**: `src/age/repositories/` (completed)

### 10.2 Pattern Structure

```
src/<module>/
├── repositories/
│   ├── index.ts                    # Barrel exports
│   ├── <entity>.repository.interface.ts  # Interface + injection token
│   └── prisma-<entity>.repository.ts     # Prisma implementation
├── <module>.service.ts             # Uses repository via DI
└── <module>.module.ts              # Wires up repository provider
```

**Interface Pattern:**
```typescript
// repositories/<entity>.repository.interface.ts
import { Entity } from '@prisma/client';

export interface IEntityRepository {
  findAll(): Promise<Entity[]>;
  findById(id: string): Promise<Entity | null>;
  create(data: CreateDto): Promise<Entity>;
  update(id: string, data: UpdateDto): Promise<Entity>;
  softDelete(id: string): Promise<Entity>;
  restore(id: string): Promise<Entity>;
}

export const ENTITY_REPOSITORY = Symbol('ENTITY_REPOSITORY');
```

**Implementation Pattern:**
```typescript
// repositories/prisma-<entity>.repository.ts
@Injectable()
export class PrismaEntityRepository implements IEntityRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(): Promise<Entity[]> {
    return this.prisma.entity.findMany({
      where: { isDeleted: false },
    });
  }
  // ... other methods
}
```

**Module Wiring:**
```typescript
// <module>.module.ts
@Module({
  providers: [
    EntityService,
    {
      provide: ENTITY_REPOSITORY,
      useClass: PrismaEntityRepository,
    },
  ],
})
```

### 10.3 Implementation Candidates

| Module | Service Lines | Complexity | Priority | Status |
|--------|---------------|------------|----------|--------|
| `reward` | ~97 | Low | P1 | Pending |
| `avatar` | ~430 | Medium | P2 | Pending |
| `kid` | ~285 | Medium | P2 | Pending |
| `settings` | ~252 | Medium | P3 | Pending |
| `age` | ~113 | Low | - | ✅ Complete |

### 10.4 Task Breakdown

**Phase 1: Simple CRUD Services (P1)**
- [ ] Implement `RewardRepository` for `RewardService`
  - Interface: `IRewardRepository`
  - Methods: `findAll`, `findById`, `findByKid`, `create`, `update`, `delete`
  - Redemption methods: `createRedemption`, `updateRedemptionStatus`, `getRedemptionsForKid`

**Phase 2: Medium Complexity Services (P2)**
- [ ] Implement `AvatarRepository` for `AvatarService`
  - Interface: `IAvatarRepository`
  - Methods: `findAll`, `findById`, `findSystemAvatars`, `create`, `update`, `softDelete`, `restore`
  - Assignment methods: `assignToUser`, `assignToKid`
  - Note: File upload logic stays in service, only data access moves to repository

- [ ] Implement `KidRepository` for `KidService`
  - Interface: `IKidRepository`
  - Methods: `findAll`, `findById`, `findByParent`, `create`, `update`, `softDelete`, `restore`
  - Note: Authorization checks stay in service, data access moves to repository

**Phase 3: Settings & Additional Services (P3)**
- [ ] Implement `SettingsRepository` for `SettingsService`
  - Interface: `ISettingsRepository`
  - Methods: `getProfile`, `upsertProfile`, `updateKidLimit`, `getKidWithParentProfile`

### 10.5 Benefits Tracking

| Metric | Before | Target | Measurement |
|--------|--------|--------|-------------|
| Test coverage (services) | ~60% | 85% | Jest coverage report |
| Mock complexity | High (Prisma) | Low (Interface) | Lines of mock code |
| Service line count | Varies | -30% avg | LOC analysis |
| Data access duplication | Multiple services | Centralized | Code review |

### 10.6 Testing Strategy

With repository pattern, service tests become simpler:

```typescript
// Before: Complex Prisma mocking
const mockPrisma = {
  reward: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    // ... many more methods
  },
};

// After: Simple interface mocking
const mockRepository: IRewardRepository = {
  findAll: jest.fn(),
  findById: jest.fn(),
  create: jest.fn(),
  // Only methods used by the service
};

describe('RewardService', () => {
  beforeEach(() => {
    service = new RewardService(mockRepository);
  });

  it('should find reward by id', async () => {
    mockRepository.findById.mockResolvedValue(mockReward);
    const result = await service.findOne('123');
    expect(result).toEqual(mockReward);
  });
});
```

**Action Items:**
- [ ] Start with `RewardService` as reference implementation
- [ ] Create repository pattern documentation in CLAUDE.md
- [ ] Add unit tests for each new repository
- [ ] Update service tests to use repository mocks

---

## 11. Test Coverage Expansion

### 11.1 Current State (P1 - High)

**Coverage Analysis:**
- Total services: 51
- Services with unit tests: ~18 (35%)
- Services without tests: ~33 (65%)
- E2E test files: 3

### 11.2 Services Without Unit Tests

| Module | Service | Priority | Complexity |
|--------|---------|----------|------------|
| `achievement-progress` | `progress.service.ts` | P1 | Medium |
| `achievement-progress` | `streak.service.ts` | P1 | Medium |
| `achievement-progress` | `badge.service.ts` | P1 | Medium |
| `age` | `age.service.ts` | P2 | Low |
| `analytics` | `analytics.service.ts` | P2 | Medium |
| `auth` | `password.service.ts` | P1 | Low |
| `auth` | `token.service.ts` | P1 | Low |
| `avatar` | `avatar.service.ts` | P2 | Medium |
| `avatar` | `avatar.seeder.service.ts` | P3 | Low |
| `notification` | `email-queue.service.ts` | P2 | Medium |
| `notification` | `in-app-notification.service.ts` | P2 | Medium |
| `notification` | `notification-preference.service.ts` | P2 | Medium |
| `prisma` | `prisma.service.ts` | P3 | Low |
| `reports` | `reports.service.ts` | P2 | Medium |
| `reports` | `screen-time.service.ts` | P2 | Medium |
| `reward` | `reward.service.ts` | P2 | Low |
| `settings` | `settings.service.ts` | P2 | Medium |
| `story` | `elevenlabs.service.ts` | P2 | Medium |
| `story` | `gemini.service.ts` | P2 | Medium |
| `story` | `story-progress.service.ts` | P1 | Medium |
| `story` | `story-quota.service.ts` | P2 | Low |
| `story` | `daily-challenge.service.ts` | P2 | Medium |
| `story` | `story-generation.service.ts` | P1 | High |
| `story` | `story-recommendation.service.ts` | P2 | High |
| `story-buddy` | `buddy-selection.service.ts` | P2 | Medium |
| `story-buddy` | `story-buddy.service.ts` | P2 | Medium |
| `user` | `user-pin.service.ts` | P2 | Low |
| `user` | `user-deletion.service.ts` | P1 | Medium |
| `voice` | `voice-quota.service.ts` | P2 | Low |
| `admin` | `admin-analytics.service.ts` | P3 | High |
| `admin` | `admin-story.service.ts` | P3 | High |
| `admin` | `admin-user.service.ts` | P3 | Medium |

### 11.3 Testing Strategy by Priority

**P1 - Critical Business Logic (First Wave)**
1. `story-generation.service.ts` - Core feature, complex AI integration
2. `story-progress.service.ts` - User progress tracking
3. `progress.service.ts` - Achievement calculations
4. `user-deletion.service.ts` - Data compliance critical
5. `password.service.ts` - Security critical
6. `token.service.ts` - Auth critical

**P2 - Important Services (Second Wave)**
- Achievement tracking services
- Notification services
- Report generation
- Voice quota management

**P3 - Lower Priority (Third Wave)**
- Admin services (internal use)
- Seeder services (one-time use)
- Prisma service (framework wrapper)

### 11.4 Test Template

```typescript
// src/<module>/<service>.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { ServiceName } from './<service>';
import { PrismaService } from '@/prisma/prisma.service';

describe('ServiceName', () => {
  let service: ServiceName;
  let prisma: PrismaService;

  const mockPrisma = {
    entity: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ServiceName,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<ServiceName>(ServiceName);
    prisma = module.get<PrismaService>(PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('methodName', () => {
    it('should handle success case', async () => {
      // Arrange
      mockPrisma.entity.findUnique.mockResolvedValue({ id: '1' });

      // Act
      const result = await service.methodName('1');

      // Assert
      expect(result).toBeDefined();
      expect(mockPrisma.entity.findUnique).toHaveBeenCalledWith({
        where: { id: '1' },
      });
    });

    it('should handle error case', async () => {
      mockPrisma.entity.findUnique.mockResolvedValue(null);

      await expect(service.methodName('invalid')).rejects.toThrow();
    });
  });
});
```

**Action Items:**
- [ ] Create test files for P1 services
- [ ] Establish 80% coverage target for new code
- [ ] Add coverage gate to CI pipeline
- [ ] Document testing patterns in CLAUDE.md

---

## 12. Rate Limiting Coverage

### 12.1 Current State (P1 - High)

**Only 4 endpoints have rate limiting:**
- `POST /auth/request-otp` - 10 req/min
- `POST /auth/verify-otp` - 10 req/min
- `POST /stories/generate` - 5 req/min
- `POST /stories/generate-audio` - Rate limited

### 12.2 Endpoints Requiring Rate Limiting

| Endpoint | Risk | Suggested Limit | Priority |
|----------|------|-----------------|----------|
| `POST /auth/login` | Brute force | 10/min | P0 |
| `POST /auth/register` | Spam accounts | 5/min | P0 |
| `POST /auth/forgot-password` | Email bombing | 3/min | P0 |
| `POST /auth/reset-password` | Brute force | 5/min | P0 |
| `POST /payment/*` | Fraud | 5/min | P0 |
| `POST /kids` | Resource abuse | 10/min | P1 |
| `POST /stories` | Resource abuse | 20/min | P1 |
| `POST /voice/*` | AI abuse | 10/min | P1 |
| `GET /admin/*` | Data scraping | 100/min | P2 |
| `POST /notifications/send` | Spam | 20/min | P2 |
| `POST /help-support` | Spam | 5/min | P2 |

### 12.3 Implementation Pattern

```typescript
// In controller
import { Throttle, SkipThrottle } from '@nestjs/throttler';

@Controller('auth')
export class AuthController {
  // High-risk endpoint - strict limit
  @Post('login')
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  async login(@Body() dto: LoginDto) {}

  // Normal endpoint - use default limit
  @Get('me')
  async getMe() {}

  // Skip throttling for health checks
  @Get('health')
  @SkipThrottle()
  async health() {}
}
```

### 12.4 Throttle Configuration by Category

```typescript
// shared/config/throttle.config.ts
export const THROTTLE_LIMITS = {
  // Authentication - strict
  AUTH_LOGIN: { ttl: 60000, limit: 10 },
  AUTH_OTP: { ttl: 60000, limit: 5 },
  AUTH_REGISTER: { ttl: 60000, limit: 5 },
  AUTH_PASSWORD_RESET: { ttl: 60000, limit: 3 },

  // Resource creation - moderate
  RESOURCE_CREATE: { ttl: 60000, limit: 20 },

  // AI operations - expensive
  AI_GENERATION: { ttl: 60000, limit: 5 },
  VOICE_SYNTHESIS: { ttl: 60000, limit: 10 },

  // Admin - higher limits
  ADMIN_READ: { ttl: 60000, limit: 200 },
  ADMIN_WRITE: { ttl: 60000, limit: 50 },

  // Default
  DEFAULT: { ttl: 60000, limit: 100 },
} as const;
```

**Action Items:**
- [ ] Add rate limiting to all auth endpoints (P0)
- [ ] Add rate limiting to payment endpoints (P0)
- [ ] Add rate limiting to resource creation endpoints (P1)
- [ ] Create centralized throttle configuration
- [ ] Add rate limit headers to responses

---

## 13. Custom Domain Exceptions

### 13.1 Current State (P2 - Medium)

No custom domain exceptions found. All errors use generic NestJS exceptions:
- `BadRequestException`
- `NotFoundException`
- `ForbiddenException`
- `UnauthorizedException`

### 13.2 Proposed Exception Hierarchy

```typescript
// shared/exceptions/domain.exception.ts
export abstract class DomainException extends HttpException {
  constructor(
    public readonly code: string,
    message: string,
    status: HttpStatus,
    public readonly details?: Record<string, unknown>,
  ) {
    super({ code, message, details }, status);
  }
}

// Authentication exceptions
export class InvalidCredentialsException extends DomainException {
  constructor() {
    super('AUTH_INVALID_CREDENTIALS', 'Invalid email or password', HttpStatus.UNAUTHORIZED);
  }
}

export class TokenExpiredException extends DomainException {
  constructor() {
    super('AUTH_TOKEN_EXPIRED', 'Authentication token has expired', HttpStatus.UNAUTHORIZED);
  }
}

// Resource exceptions
export class ResourceNotFoundException extends DomainException {
  constructor(resource: string, id: string) {
    super(
      'RESOURCE_NOT_FOUND',
      `${resource} with id ${id} not found`,
      HttpStatus.NOT_FOUND,
      { resource, id },
    );
  }
}

export class ResourceAlreadyExistsException extends DomainException {
  constructor(resource: string, field: string, value: string) {
    super(
      'RESOURCE_ALREADY_EXISTS',
      `${resource} with ${field} "${value}" already exists`,
      HttpStatus.CONFLICT,
      { resource, field, value },
    );
  }
}

// Business logic exceptions
export class QuotaExceededException extends DomainException {
  constructor(quotaType: string, limit: number) {
    super(
      'QUOTA_EXCEEDED',
      `${quotaType} quota exceeded. Limit: ${limit}`,
      HttpStatus.TOO_MANY_REQUESTS,
      { quotaType, limit },
    );
  }
}

export class SubscriptionRequiredException extends DomainException {
  constructor(feature: string) {
    super(
      'SUBSCRIPTION_REQUIRED',
      `Premium subscription required for ${feature}`,
      HttpStatus.PAYMENT_REQUIRED,
      { feature },
    );
  }
}
```

### 13.3 Benefits

| Benefit | Description |
|---------|-------------|
| Consistent error codes | API clients can handle errors programmatically |
| Better logging | Error codes enable better filtering and alerting |
| Client-friendly | Structured errors improve mobile app UX |
| i18n ready | Error codes can map to localized messages |
| Debugging | Error details provide context for troubleshooting |

**Action Items:**
- [ ] Create base `DomainException` class
- [ ] Implement authentication exceptions
- [ ] Implement resource exceptions
- [ ] Implement business logic exceptions
- [ ] Update exception filter to handle domain exceptions
- [ ] Migrate critical paths to use domain exceptions

---

## 14. Event-Driven Architecture Expansion

### 14.1 Current State (P2 - Medium)

**Limited event usage:**
- 11 event-related occurrences across 3 files
- Primarily in `achievement-progress` module
- Uses `@nestjs/event-emitter` (EventEmitter2)

**Current events:**
```typescript
// achievement-progress/badge-progress.engine.ts
this.eventEmitter.emit('badge.earned', { kidId, badgeId });
this.eventEmitter.emit('streak.updated', { kidId, streak });
```

### 14.2 Event-Driven Opportunities

| Event | Trigger | Subscribers | Priority |
|-------|---------|-------------|----------|
| `user.registered` | User registration | Welcome email, analytics, onboarding | P1 |
| `user.deleted` | Account deletion | Cleanup jobs, analytics | P1 |
| `story.created` | Story generation | Recommendations, analytics, achievements | P1 |
| `story.completed` | Story listened | Progress tracking, achievements, streaks | P1 |
| `subscription.changed` | Plan change | Email notification, feature unlock | P1 |
| `payment.completed` | Payment success | Receipt email, subscription activation | P1 |
| `payment.failed` | Payment failure | Alert email, subscription suspension | P1 |
| `kid.created` | New kid profile | Recommendations setup, welcome flow | P2 |
| `notification.sent` | Any notification | Analytics, delivery tracking | P2 |

### 14.3 Implementation Pattern

```typescript
// shared/events/events.ts
export const AppEvents = {
  USER_REGISTERED: 'user.registered',
  USER_DELETED: 'user.deleted',
  STORY_CREATED: 'story.created',
  STORY_COMPLETED: 'story.completed',
  SUBSCRIPTION_CHANGED: 'subscription.changed',
  PAYMENT_COMPLETED: 'payment.completed',
  PAYMENT_FAILED: 'payment.failed',
} as const;

// Event payload types
export interface UserRegisteredEvent {
  userId: string;
  email: string;
  registeredAt: Date;
}

export interface StoryCompletedEvent {
  storyId: string;
  kidId: string;
  duration: number;
  completedAt: Date;
}

// Emitting events
@Injectable()
export class AuthService {
  constructor(private eventEmitter: EventEmitter2) {}

  async register(dto: RegisterDto) {
    const user = await this.createUser(dto);

    this.eventEmitter.emit(AppEvents.USER_REGISTERED, {
      userId: user.id,
      email: user.email,
      registeredAt: new Date(),
    } satisfies UserRegisteredEvent);

    return user;
  }
}

// Subscribing to events
@Injectable()
export class WelcomeEmailListener {
  @OnEvent(AppEvents.USER_REGISTERED)
  async handleUserRegistered(event: UserRegisteredEvent) {
    await this.emailService.sendWelcomeEmail(event.email);
  }
}

@Injectable()
export class AnalyticsListener {
  @OnEvent(AppEvents.USER_REGISTERED)
  async trackRegistration(event: UserRegisteredEvent) {
    await this.analytics.track('user_registered', event);
  }
}
```

### 14.4 Benefits

| Benefit | Description |
|---------|-------------|
| Decoupling | Services don't need to know about all side effects |
| Scalability | Listeners can be moved to separate workers |
| Maintainability | Adding new side effects doesn't modify core logic |
| Testing | Core logic testable without side effects |
| Audit trail | Events can be logged for debugging |

**Action Items:**
- [ ] Define standard event names and payloads
- [ ] Add user lifecycle events (register, delete)
- [ ] Add story lifecycle events (create, complete)
- [ ] Add payment/subscription events
- [ ] Create event listener module for cross-cutting concerns
- [ ] Document event patterns in CLAUDE.md

---

## 15. Sequential Operations Optimization ✅ COMPLETED

### 15.1 Summary

**Status**: Completed - February 2026

**Files optimized:**
1. `src/notification/services/notification-preference.service.ts` - ✅ Using `$transaction`
2. `src/story-buddy/story-buddy.seeder.ts` - ✅ Using `createMany`
3. `src/avatar/avatar.seeder.service.ts` - ✅ Using `$transaction`
4. `src/story/scripts/backfill-duration.ts` - ✅ Using batched `$transaction`

### 15.2 Optimizations Applied

| File | Before | After |
|------|--------|-------|
| `notification-preference.service.ts` | Sequential `for...of` with await | Batched `$transaction` with mapped upserts |
| `story-buddy.seeder.ts` | Sequential creates in loop | Single `createMany` with `skipDuplicates` |
| `avatar.seeder.service.ts` | Two sequential loops | Single `$transaction` with mapped upserts |
| `backfill-duration.ts` | Sequential updates | Chunked batch updates (100 per transaction) |

### 15.3 Patterns Used

**Transaction Batching (for upserts):**
```typescript
// notification-preference.service.ts & avatar.seeder.service.ts
const upsertOperations = items.map((item) =>
  this.prisma.entity.upsert({
    where: { uniqueField: item.uniqueField },
    create: { ...item },
    update: { ...item },
  }),
);
await this.prisma.$transaction(upsertOperations);
```

**CreateMany with Skip Duplicates (for seeders):**
```typescript
// story-buddy.seeder.ts
const result = await prisma.storyBuddy.createMany({
  data: storyBuddiesData,
  skipDuplicates: true,
});
```

**Chunked Batch Updates (for large datasets):**
```typescript
// backfill-duration.ts
const BATCH_SIZE = 100;
for (let i = 0; i < updates.length; i += BATCH_SIZE) {
  const batch = updates.slice(i, i + BATCH_SIZE);
  const updateOperations = batch.map((update) =>
    prisma.story.update({
      where: { id: update.id },
      data: { durationSeconds: update.durationSeconds },
    }),
  );
  await prisma.$transaction(updateOperations);
}
```

### 15.4 Best Practices Reference

```typescript
// ✅ Parallel execution (fast)
await Promise.all(items.map(item => this.processItem(item)));

// ✅ Controlled parallelism (for rate-limited APIs)
import pLimit from 'p-limit';
const limit = pLimit(5);  // Max 5 concurrent
await Promise.all(items.map(item => limit(() => this.processItem(item))));

// ✅ Batched database operations
await this.prisma.$transaction(operations);

// ✅ Bulk inserts with deduplication
await this.prisma.entity.createMany({
  data: items,
  skipDuplicates: true,
});
```

---

## Progress Tracking

### Completed ✅
- [x] Database indexes optimization (70+ indexes added) *(Instance 1)*
- [x] Email queue with retry logic (BullMQ)
- [x] Health checks implementation
- [x] Request logging middleware
- [x] Add monitoring section
- [x] Add queue optimization section
- [x] Add API performance patterns
- [x] Add Prisma v7 upgrade considerations
- [x] Transaction coverage improvement *(Instance 3 & 4)*
- [x] N+1 query fixes *(Instance 4 & 5)*
- [x] External service retry logic *(Instance 3 - GeminiService)*
- [x] Response compression middleware *(1KB threshold, level 6)*
- [x] Static content caching (categories, themes, seasons, story buddies)
- [x] Cache invalidation on CRUD operations
- [x] Sequential operations optimization (Section 15)
- [x] Prisma slow query logging (>100ms threshold in development)
- [x] Custom domain exceptions hierarchy *(AuthService, UserService)*
- [x] Query select optimization - UserService (exclude passwordHash/pinHash at DB level)
### In Progress 🔄
- [ ] User preferences caching
- [ ] Kid profiles caching

### Not Recommended ⚠️
- Module lazy loading (not beneficial for NestJS HTTP modules - see section 5.1)

### Pending 📋

**Repository Pattern (Section 10)**
- [ ] Repository pattern: RewardService (P1)
- [ ] Repository pattern: AvatarService (P2)
- [ ] Repository pattern: KidService (P2)
- [ ] Repository pattern: SettingsService (P3)

**Test Coverage (Section 11)**
- [ ] Unit tests for P1 services (story-generation, story-progress, progress, user-deletion, password, token)
- [ ] Unit tests for P2 services (achievement, notification, reports)
- [ ] Establish 80% coverage gate in CI

**Rate Limiting (Section 12)**
- [ ] Add rate limiting to auth endpoints (P0)
- [ ] Add rate limiting to payment endpoints (P0)
- [ ] Create centralized throttle configuration

**Domain Exceptions (Section 13)**
- [ ] Create base DomainException class
- [ ] Implement auth/resource/business exceptions
- [ ] Update exception filter

**Event-Driven Architecture (Section 14)**
- [ ] Define standard event names and payloads
- [ ] Add user/story/payment lifecycle events
- [ ] Create event listener module

**Infrastructure**
- [ ] Cache strategy improvements
- [ ] External service retry logic
- [ ] APM integration (OpenTelemetry + Grafana)
- [ ] Queue system expansion (story generation, voice synthesis)
- [ ] Prisma v7 upgrade

---

## Quick Wins (Can be done in < 1 day each)

1. ~~**Add transactions to subscription operations**~~ ✅ *(Instance 3)*
2. ~~**Cache subscription status**~~ ✅ Already implemented in SubscriptionService
3. ~~**Add request timeouts to AI providers**~~ ✅ *(Instance 3 - GeminiService)*
4. ~~**Use `select` in list queries**~~ ✅ Partially complete - UserService done, StoryService pending
5. ~~**Replace sequential queries with batch**~~ ✅ *(Instance 4 & 5)*
6. ~~**Add Prisma query logging**~~ ✅ Slow query logging (>100ms) in development
7. **Implement cursor pagination** - Better performance for infinite scroll
8. ~~**Add compression middleware**~~ ✅ Added with 1KB threshold

---

## References

- [Prisma Performance Guide](https://www.prisma.io/docs/guides/performance-and-optimization)
- [Prisma v7 Upgrade Guide](https://www.prisma.io/docs/orm/more/upgrade-guides/upgrading-versions/upgrading-to-prisma-7)
- [NestJS Caching](https://docs.nestjs.com/techniques/caching)
- [BullMQ Best Practices](https://docs.bullmq.io/guide/going-to-production)
- [OpenTelemetry for Node.js](https://opentelemetry.io/docs/instrumentation/js/)
- Project guidelines: `.claude/CLAUDE.md`

# QA Improvements Roadmap

This document tracks quality assurance issues, testing gaps, and code quality improvements needed in the Storytime backend.

> **Generated**: February 2026
> **Last Updated**: February 2026
> **Priority Scale**: P0 (Critical) | P1 (High) | P2 (Medium) | P3 (Low)

---

## Table of Contents

1. [Testing Gaps](#1-testing-gaps)
2. [Code Quality Issues](#2-code-quality-issues)
3. [Error Handling](#3-error-handling)
4. [Security Issues](#4-security-issues)
5. [Architecture Issues](#5-architecture-issues)
6. [Testing Strategy](#6-testing-strategy)
7. [CI/CD Integration](#7-cicd-integration)
8. [Code Review Standards](#8-code-review-standards)

---

## 1. Testing Gaps

### 1.1 Unit Test Status (P0 - Critical) ✅ LARGELY COMPLETE

Current coverage: **31+ test files** covering major services.

**Core Services with Tests:** AuthService (31), UserService (45), NotificationService (34), SubscriptionService (15), OAuthService (21), OnboardingService (22), UserDeletionService (18), UserPinService (23), PaymentService, StoryService, StoryGenerationService, VoiceService, KidService, HelpSupportService, ParentFavoritesService, AdminController, AdminStoryService, AdminUserService, AdminAnalyticsService (40), AdminSystemService (32), PasswordService (22), TokenService (24), EmailVerificationService (7), DeviceTokenService (18), NotificationPreferenceService (25).

**Services Still Needing Tests:**

| Service | Priority |
|---------|----------|
| `BadgeService` | P3 |
| `ProgressService` | P3 |

### 1.2 Missing E2E Tests (P1 - High)

| Flow | Status | Priority |
|------|--------|----------|
| Authentication (login/register) | ✅ 41 tests | Done |
| OAuth (Google/Apple) | ✅ included | Done |
| Payment processing | ❌ | P0 |
| Subscription management | ❌ | P1 |
| Story CRUD operations | ❌ | P2 |
| Kid profile management | ❌ | P2 |

### 1.3 Existing Tests Needing Review (P2)

| Test File | Issue |
|-----------|-------|
| `src/admin/tests/admin.service.spec.ts` | Review mock completeness |
| `src/story/story.service.spec.ts` | Add edge case coverage |
| `src/payment/payment.service.spec.ts` | Add failure scenario tests |

---

## 2. Code Quality Issues

### 2.1 `any` Type Usage (P1) ✅ LARGELY COMPLETE

Production code `any` types eliminated. Only test mocks remain.

**Pending:**
- [ ] Enable `noImplicitAny` in `tsconfig.json` (after test mock fixes)

### 2.2 Event-Driven Architecture (P1) ✅ COMPLETE

Fully implemented with 18+ events, typed payloads, and 6 event listeners.

**Event System:**
- `EventEmitterModule` configured globally in `app.module.ts`
- Centralized event types in `src/shared/events/app-events.ts`
- All events use standardized naming: `domain.action` (e.g., `user.registered`)
- Type-safe payloads with `satisfies` keyword

**Event Listeners:**

| Listener | Purpose |
|----------|---------|
| `AuthEventListener` | Auth notifications (welcome emails, verification) |
| `PasswordEventListener` | Password reset/change emails |
| `AnalyticsEventListener` | Business metrics tracking |
| `ActivityLogEventListener` | Database audit trail |
| `SubscriptionCacheListener` | Cache invalidation on subscription events |
| `KidCacheListener` | Cache invalidation on kid lifecycle events |
| `UserCleanupListener` | GDPR cleanup on user deletion |

**Recent additions (2026-02-23):**
- `AI_USAGE_TRACKED` event replacing direct `logAiActivity` calls
- `QUOTA_EXHAUSTED` event for quota tracking
- Event-driven cache invalidation (subscription + kid caches)
- GDPR cleanup listener for user deletion

### 2.3 Console.log Usage (P3)

| File | Issue |
|------|-------|
| `src/story-buddy/story-buddy.seeder.ts` | `console.error` → use `Logger.error()` |

### 2.4 God Services - Single Responsibility ✅ ALL COMPLETE

7 god services (7,292 lines total) refactored into 19 focused services averaging ~270 lines each. All builds and tests passing.

| Original Service | Lines | Split Into |
|-----------------|-------|------------|
| AdminService | 2,121 | AdminUserService, AdminStoryService, AdminAnalyticsService, AdminSystemService |
| StoryService | 1,787 | StoryProgressService, StoryGenerationService, StoryRecommendationService, DailyChallengeService + core |
| AuthService | 694 | OAuthService, OnboardingService, EmailVerificationService + core |
| NotificationService | 737 | NotificationPreferenceService, InAppNotificationService + core |
| UserService | 689 | UserDeletionService, UserPinService, ParentProfileService + core |
| StoryBuddyService | 728 | BuddySelectionService, BuddyMessagingService + core |
| ReportsService | 536 | ScreenTimeService + core |

### 2.5 Shared Utilities ✅ COMPLETE

Extracted common patterns into shared utilities to reduce duplication:

| Utility | Location | Replaces |
|---------|----------|----------|
| `ErrorHandler.extractMessage()` | `src/shared/utils/error-handler.util.ts` | 20+ instances of `error instanceof Error ? error.message : ...` |
| `DateFormatUtil.getCurrentMonthString()` | `src/shared/utils/date-format.util.ts` | Duplicate `getCurrentMonth()` in quota services |
| `SubscriptionService.isPremiumUser()` | `src/subscription/subscription.service.ts` | Duplicate premium checks in VoiceQuotaService |

---

## 3. Error Handling

### 3.1 Generic Error Throws ✅ LARGELY COMPLETE

All service-level generic `Error` throws replaced with NestJS exceptions:
- `DomainException` hierarchy in `src/shared/exceptions/domain.exception.ts`
- Auth exceptions: `InvalidCredentials`, `TokenExpired`, `EmailNotVerified`, `InvalidToken`, `InvalidAdminSecret`
- Resource exceptions: `NotFound`, `AlreadyExists`
- Business logic exceptions: `QuotaExceeded`, `SubscriptionRequired`, `ValidationException`
- Exception filter updated to extract `code` and `details` from domain exceptions

**Remaining (acceptable):**
1. `src/story/story-generation.service.spec.ts` — test file
2. `src/shared/config/env.validation.ts` — startup validation

### 3.2 Try-Catch & Retry Coverage ✅ LARGELY COMPLETE

- External API calls: GeminiService (retry + circuit breaker), ElevenLabs TTS (retry + backoff), StyleTTS2 (timeout wrapper), Deepgram (timeout)
- All external calls have 30s request timeouts
- HTTP latency tracking via OpenTelemetry interceptor in story, voice, notification modules
- Database operations use Prisma's built-in error handling + domain exceptions

---

## 4. Security Issues

### 4.1 Input Validation in Controllers (P2)

- [ ] Move manual `userId` checks in `avatar.controller.ts` to DTO decorators
- [ ] Use `class-validator` for all input validation

### 4.2 Type Casting in Guards (P2) ✅ COMPLETE

`AuthenticatedRequest` interface created and applied to all guards (`admin.guard.ts`, `auth.guard.ts`).

### 4.3 Session Validation (P2)

- [ ] Review OAuth callback session handling
- [ ] Add session validation to all auth flows
- [ ] Implement token refresh mechanism

### 4.4 Rate Limiting ✅ COMPLETE

Rate limiting implemented on all critical endpoints:
- Auth endpoints (`auth.controller.ts`)
- Payment endpoints (`payment.controller.ts`)
- Story generation endpoints (`story.controller.ts`)
- Device endpoints (`device.controller.ts`)

**Pending:**
- [ ] Create centralized throttle configuration file (optional consolidation)

---

## 5. Architecture Issues

### 5.1 Circular Dependencies (P1) ✅ LARGELY RESOLVED

Reduced from 7 modules to 3 modules using `forwardRef()` via event-driven architecture.

**Remaining `forwardRef` usages (3 modules):**

| Module Pair | Reason |
|-------------|--------|
| StoryModule ↔ VoiceModule | Bidirectional TTS dependency |
| AchievementProgressModule ↔ Various | Badge/progress tracking |

**Pending:**
- [ ] Consider extracting shared TTS logic to resolve Story ↔ Voice dependency (low priority)

### 5.2 Repository Pattern ✅ ALL COMPLETE

Implemented for all target services with Symbol-based injection tokens:

| Module | Repository |
|--------|-----------|
| Reward | `IRewardRepository` + `PrismaRewardRepository` |
| Avatar | `IAvatarRepository` + `PrismaAvatarRepository` |
| Kid | `IKidRepository` + `PrismaKidRepository` |
| Settings | `ISettingsRepository` + `PrismaSettingsRepository` |
| Age | Reference implementation |

Pattern: `src/<module>/repositories/` with interface + Prisma implementation + Symbol token.

---

## 6. Testing Strategy

### 6.1 Testing Pyramid

- **Unit Tests (60%)**: Pure business logic, services in isolation — `*.spec.ts`
- **Integration Tests (30%)**: API endpoints, service + repository — `*.integration-spec.ts`
- **E2E Tests (10%)**: Critical user flows (auth, payments) — `*.e2e-spec.ts`

### 6.2 Test Coverage Targets

| Component | Current | Target |
|-----------|---------|--------|
| Services | ~35% | 80% |
| Guards | ~0% | 100% |
| Controllers | ~5% | 70% |
| Utils/Helpers | ~10% | 90% |

**Pending:**
- [ ] Configure Jest coverage thresholds in CI
- [ ] Add coverage badges to README
- [ ] Create test files for remaining P1 services (story-progress, badge, progress)

---

## 7. CI/CD Integration

### 7.1 GitHub Actions ✅ IMPLEMENTED

3 workflows active:
1. **Development** (`.github/workflows/dev-deploy.yml`) — PRs to `develop-v*.*.*`, PostgreSQL 16, Redis 7, Node v22
2. **Staging** (`.github/workflows/staging-deploy.yml`) — PRs to `release-v*.*.*`
3. **Production** (`.github/workflows/deploy-prod.yml`) — PRs to `main`

### 7.2 Quality Gates

| Gate | Threshold | Blocking |
|------|-----------|----------|
| Build | Pass | Yes |
| Lint | 0 errors | Yes |
| Unit Tests | Pass | Yes |
| Coverage | 70% | No (warn) |
| E2E Tests | Pass | Yes (main only) |

---

## 8. Code Review Standards

### 8.1 PR Review Checklist

**Every PR:**
- [ ] Logic correct, edge cases handled
- [ ] Types properly defined (no `any`)
- [ ] Tests for new functionality
- [ ] Errors properly caught and typed (use domain exceptions)
- [ ] Input validation via DTOs with `class-validator`
- [ ] No N+1 queries, unnecessary loops
- [ ] Services use `@Injectable()`, constructor injection
- [ ] No circular dependencies (avoid `forwardRef`)
- [ ] Controllers use proper HTTP status codes

### 8.2 Severity Labels

| Label | Meaning | Blocking |
|-------|---------|----------|
| 🔴 `[blocking]` | Must fix | Yes |
| 🟡 `[important]` | Should fix | Discuss |
| 🟢 `[nit]` | Nice to have | No |
| 💡 `[suggestion]` | Alternative approach | No |

---

## Progress Summary

### Completed ✅
- Unit tests: 31+ test files covering all major services
- E2E tests: Authentication flows (41 tests)
- Type safety: Production `any` types eliminated
- God service refactoring: 7 → 19 focused services
- Event-driven architecture: 18+ events, 7 listeners
- Circular dependency reduction: 7 → 3 modules with `forwardRef`
- Repository pattern: All target services (Reward, Avatar, Kid, Settings, Age)
- Domain exceptions: Full hierarchy with error codes
- Rate limiting: Auth, payment, story, device controllers
- CI/CD: 3 GitHub Actions workflows
- Shared utilities: ErrorHandler, DateFormatUtil, isPremiumUser dedup
- Event-driven cache invalidation: Subscription + kid caches
- GDPR cleanup listener for user deletion
- AI usage tracking via events
- External API timeouts: 30s on ElevenLabs, Deepgram, all HTTP services
- HTTP latency tracking: OpenTelemetry interceptor on all outgoing HTTP calls
- Response DTOs: StoryListItemDto for lightweight list views
- Admin export pagination: Chunked 1000-record batches instead of 10k single fetch

### Pending 📋
- [ ] E2E tests for payment/subscription flows (P1)
- [ ] Unit tests for remaining services: BadgeService, ProgressService (P3)
- [ ] Jest coverage thresholds in CI (P2)
- [ ] Coverage badges in README (P3)
- [ ] Enable `noImplicitAny` in tsconfig (P2)

---

## References

- [NestJS Testing](https://docs.nestjs.com/fundamentals/testing)
- [NestJS Exception Filters](https://docs.nestjs.com/exception-filters)
- [NestJS Dependency Injection](https://docs.nestjs.com/fundamentals/custom-providers)
- [GitHub Actions for Node.js](https://docs.github.com/en/actions/guides/building-and-testing-nodejs)
- [Jest Testing Best Practices](https://github.com/goldbergyoni/javascript-testing-best-practices)

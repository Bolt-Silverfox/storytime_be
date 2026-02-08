# Multi-Instance Claude Coordination

**Branch**: `integration/refactor-2026-02`
**Base**: `develop-v0.0.1`
**Created**: 2026-02-08

---

## 🔄 Coordination Protocol

All Claude instances working on this codebase should:

1. **Load required skills first** (before starting any work):
   ```
   # QA & Code Quality
   /senior-qa
   /code-review-excellence
   /javascript-testing-patterns
   /nestjs-testing-expert

   # JavaScript
   /javascript-mastery
   /modern-javascript-patterns

   # Node.js & Backend
   /nodejs-backend-patterns
   /nodejs-backend
   /nodejs-express-server
   /express-rest-api

   # NestJS
   /nestjs-expert
   /nestjs-best-practices

   # Database
   /prisma-orm-v7-skills
   /database-schema-designer

   # DevOps & Infrastructure
   /devops-engineer
   /ci-cd-pipeline-builder

   # Git
   /git-workflow
   ```

2. **Before starting work**: Pull latest from `integration/refactor-2026-02`
3. **After completing work**: Push to integration branch with clear commit messages
4. **Update this file**: Log your changes in the Active Work section below

### Commands to Sync

```bash
# Sync before starting
git checkout integration/refactor-2026-02
git pull origin integration/refactor-2026-02

# After completing work
git add .
git commit -m "type(scope): description"
git push origin integration/refactor-2026-02

# Update this coordination file with your changes
```

---

## 📋 Active Work Log

### Instance 1 (This Instance) - ✅ Completed
**Focus**: Subscription caching & guard refactoring
**Timestamp**: 2026-02-08

**Changes Made**:
- `src/subscription/subscription.service.ts` - Added `isPremiumUser()` with 1-min cache, `invalidateCache()`
- `src/shared/guards/subscription-throttle.guard.ts` - Refactored to use SubscriptionService
- `src/story/story-quota.service.ts` - Now uses centralized isPremiumUser
- `src/story/story.module.ts` - Added SubscriptionModule import, SubscriptionThrottleGuard provider
- `PERFORMANCE_IMPROVEMENTS.md` - Added monitoring, queue, API, Prisma v7 sections
- `QA_IMPROVEMENTS.md` - Added testing strategy, CI/CD, code review sections

**Fixed Issues**:
- Lint errors: unused `error` variables in catch blocks
- Module wiring: StoryModule now properly imports SubscriptionModule

### Instance 2 - ✅ Completed
**Focus**: God service refactoring documentation
**Timestamp**: 2026-02-08
**Branch**: `perf/improvements`

**Changes Made**:
- `QA_IMPROVEMENTS.md` - Expanded section 2.3 with detailed god service refactoring plans:
  - AdminService (2,121 lines) → 4 services
  - StoryService (1,787 lines) → 5 services
  - AuthService (694 lines) → 3 new services
  - NotificationService (737 lines) → 4 services
  - UserService (689 lines) → 4 services
  - StoryBuddyService (728 lines) → 4 services
  - ReportsService (536 lines) → 3 services
- Added method-to-service mappings, dependencies, implementation order
- Added 4-phase action items for systematic extraction

**Status**: Documentation complete. Ready for service extraction work.

### Instance 3 - ✅ Completed
**Focus**: Payment atomicity & GeminiService retry logic
**Timestamp**: 2026-02-08
**Branch**: `feat/gemini-retry-logic` (merged)

**Changes Made**:
- `src/payment/payment.service.ts` - Combined payment + subscription in single atomic transaction
  - New `processPaymentAndSubscriptionAtomic()` method with idempotency check
  - Added cache invalidation after payment/subscription changes
  - Removed unused `upsertSubscription`, `upsertSubscriptionWithExpiry` methods
- `src/payment/payment.module.ts` - Added SubscriptionModule import for cache invalidation
- `src/story/gemini.service.ts` - Added retry logic with exponential backoff
  - RETRY_CONFIG: 3 attempts, 1s base delay, 8s max delay
  - `isTransientError()`, `sleep()`, `getBackoffDelay()` helpers
  - Retry loop for transient errors (429, 503, 500, network issues)
  - Only records circuit breaker failure after all retries exhausted

**Status**: All work complete and merged into integration branch.

### Instance 4 - ✅ Completed
**Focus**: Unit tests for critical untested services + StoryService transactions
**Timestamp**: 2026-02-08
**Branch**: `fix/bug-fixes`

**Changes Made**:
- `src/auth/auth.service.spec.ts` - NEW: 31 tests for AuthService
- `src/user/user.service.spec.ts` - NEW: 45 tests for UserService
- `src/subscription/subscription.service.spec.ts` - NEW: 15 tests for SubscriptionService
- `src/notification/notification.service.spec.ts` - NEW: 34 tests for NotificationService
- `__mocks__/uuid.ts` - NEW: Mock for uuid ESM module
- `jest.config.js` - Added transformIgnorePatterns and uuid mock mapping
- `src/story/story.service.ts` - Added atomic transactions:
  - `createStory()`: Transaction with validation for categories, themes, seasons
  - `updateStory()`: Transaction with validation for categories, themes, seasons
  - `persistGeneratedStory()`: Refactored to generate audio first with pre-generated UUID, then create story atomically with all data

**Status**: Complete - 125 unit tests passing, build passing

### Instance 5 - ✅ Completed
**Focus**: Type safety improvements & N+1 query optimization
**Timestamp**: 2026-02-08
**Branch**: `perf/resilience-improvements`
**PR**: #219

**Changes Made**:
- `src/auth/auth.service.ts` - Use Prisma `Role` enum instead of `as any` cast
- `src/user/user.service.ts` - Use `Prisma.UserUncheckedUpdateInput` for type safety
- `src/voice/providers/eleven-labs-tts.provider.ts` - Use `Promise<unknown>` instead of `Promise<any>`
- `src/story/story.service.ts` - Optimized `assignDailyChallengeToAllKids()`:
  - Before: O(N×5) queries where N = number of kids
  - After: O(4 + M) queries where M = unique stories selected
  - Used `Promise.all` for parallel data fetching
  - In-memory processing with `Map` for O(1) lookups
  - Batch `createMany` for assignments

**Status**: Complete. PR #219 open to integration branch.

---

## ⚠️ Conflict Zones (Do Not Touch)

Files currently being modified by other instances - avoid editing these:

| File | Instance | Status |
|------|----------|--------|
| `src/subscription/subscription.service.ts` | Instance 1 | ✅ Done |
| `src/story/story-quota.service.ts` | Instance 1 | ✅ Done |
| `src/shared/guards/subscription-throttle.guard.ts` | Instance 1 | ✅ Done |
| `src/payment/payment.service.ts` | Instance 3 | ✅ Done |
| `src/payment/payment.module.ts` | Instance 3 | ✅ Done |
| `src/story/gemini.service.ts` | Instance 3 | ✅ Done |
| `src/auth/auth.service.spec.ts` | Instance 4 | ✅ Done |
| `src/user/user.service.spec.ts` | Instance 4 | ✅ Done |
| `src/subscription/subscription.service.spec.ts` | Instance 4 | ✅ Done |
| `src/notification/notification.service.spec.ts` | Instance 4 | ✅ Done |
| `jest.config.js` | Instance 4 | ✅ Done |
| `src/story/story.service.ts` | Instance 4 & 5 | ✅ Done |
| `src/auth/auth.service.ts` | Instance 5 | ✅ Done |
| `src/user/user.service.ts` | Instance 5 | ✅ Done |
| `src/voice/providers/eleven-labs-tts.provider.ts` | Instance 5 | ✅ Done |

---

## 🎯 Remaining Work (Unclaimed)

Available tasks from the roadmaps:

### From PERFORMANCE_IMPROVEMENTS.md
- [x] Add transactions to SubscriptionService for plan changes *(Instance 1)*
- [x] Add transactions to PaymentService for atomic payment + subscription *(Instance 3)*
- [x] Add transactions to StoryService for story creation *(Instance 4)*
- [x] Batch sequential queries (N+1 fixes in story.service.ts) *(Instance 5)*
- [x] Add retry logic to AI provider calls (GeminiService) *(Instance 3)*
- [x] Implement circuit breaker for external services *(already existed in GeminiService)*

### From QA_IMPROVEMENTS.md
- [x] Add unit tests for AuthService *(Instance 4)*
- [x] Add unit tests for UserService *(Instance 4)*
- [x] Add unit tests for SubscriptionService *(Instance 4)*
- [x] Add unit tests for NotificationService *(Instance 4)*
- [ ] Add E2E tests for authentication flows
- [~] Replace remaining `any` types (~22 files) *(Instance 5 - partial: auth, user, voice services done)*

### God Service Extractions (see QA_IMPROVEMENTS.md section 2.3 for details)

**Phase 1: High-Impact Extractions**
- [ ] Extract `StoryProgressService` from `StoryService`
- [ ] Extract `DailyChallengeService` from `StoryService`
- [ ] Extract `AdminAnalyticsService` from `AdminService`

**Phase 2: Auth & User Domain**
- [ ] Extract `OAuthService` from `AuthService`
- [ ] Extract `OnboardingService` from `AuthService`
- [ ] Extract `UserDeletionService` from `UserService`
- [ ] Extract `UserPinService` from `UserService`

**Phase 3: Notification & Reports**
- [ ] Extract `NotificationPreferenceService` from `NotificationService`
- [ ] Extract `InAppNotificationService` from `NotificationService`
- [ ] Extract `ScreenTimeService` from `ReportsService`

**Phase 4: Remaining Extractions**
- [ ] Extract `AdminUserService` from `AdminService`
- [ ] Extract `AdminStoryService` from `AdminService`
- [ ] Extract `StoryGenerationService` from `StoryService`
- [ ] Extract `StoryRecommendationService` from `StoryService`
- [ ] Extract `BuddySelectionService` from `StoryBuddyService`
- [ ] Extract `BuddyMessagingService` from `StoryBuddyService`

---

## 🔗 Branch Strategy

```
develop-v0.0.1 (base)
    └── integration/refactor-2026-02 (shared integration)
            ├── fix/format-and-lint (merged ✅)
            ├── perf/improvements (Instance 2)
            ├── feat/gemini-retry-logic (merged ✅)
            ├── fix/bug-fixes (Instance 4)
            └── perf/resilience-improvements (Instance 5 - PR #219)
```

When all instances complete their work:
1. Verify build passes: `pnpm run build`
2. Run tests: `pnpm run test`
3. Create PR from `integration/refactor-2026-02` → `develop-v0.0.1`

---

## 📝 Notes

- All instances should follow conventional commits
- Run `pnpm run build` before pushing
- Lint errors should be fixed immediately
- Update the conflict zones table when claiming new files

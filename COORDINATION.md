# Multi-Instance Claude Coordination

**Branch**: `integration/refactor-2026-02`
**Base**: `develop-v0.0.1`
**Created**: 2026-02-08

---

## ⚠️ CRITICAL RULES (READ FIRST)

**These rules prevent merge conflicts and lost work:**

1. **ALWAYS use `git merge`, NEVER use `git rebase`**
   - Rebase rewrites history and loses merge conflict resolutions
   - This causes massive conflicts when multiple instances work together
   - If you accidentally rebase, abort with `git rebase --abort`

2. **ONE instance per file/service at a time**
   - Before starting work on a file, check the "Conflict Zones" table below
   - If a file is being modified by another instance, DO NOT touch it
   - Claim your files by adding them to the Conflict Zones table BEFORE starting

3. **Pull before starting, pull before pushing**
   - Always sync with the latest changes before starting work
   - Always sync again before pushing to catch any new changes

4. **Do NOT use `git pull --rebase`**
   - Use `git pull` (which does merge by default)
   - Or explicitly: `git pull --no-rebase origin integration/refactor-2026-02`

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
# Sync before starting (ALWAYS do this first)
git checkout integration/refactor-2026-02
git pull --no-rebase origin integration/refactor-2026-02

# After completing work
git add .
git commit -m "type(scope): description"

# Sync again before pushing (to merge any new changes from other instances)
git pull --no-rebase origin integration/refactor-2026-02

# Then push
git push origin integration/refactor-2026-02
```

⚠️ **NEVER use these commands:**
- `git rebase` - rewrites history, causes conflicts
- `git pull --rebase` - same problem
- `git push --force` - overwrites other instances' work

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
**Focus**: Unit tests + StoryService transactions + N+1 query fixes
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
- `src/story/story.service.ts` - Fixed N+1 query patterns:
  - Batched 10+ sequential validation queries using `Promise.all()` (addFavorite, setProgress, getProgress, setUserProgress, getUserProgress, restrictStory, assignDailyChallenge, startStoryPath, adjustReadingLevel, recommendStoryToKid)
  - `assignDailyChallengeToAllKids()`: Refactored from O(n*queries) to 4 upfront queries + batch creates
  - `generateStoryForKid()`: Removed duplicate kid query, batched themes/categories fetch

**Status**: Complete - 178 unit tests passing, build passing

**Additional Work (Type Safety Phase)**:
- `src/admin/admin.service.ts` - Eliminated 10 `any` types:
  - `getAllUsers()` → `PaginatedResponseDto<UserListItemDto>`
  - `getUserById()` → Proper inline type with `Omit<User, ...>`
  - `createAdmin()` → `AdminCreatedDto`
  - `updateUser()` → `UserUpdatedDto`
  - `deleteUser()` / `restoreUser()` → Explicit return types with `select`
  - `getAllStories()` → `PaginatedResponseDto<StoryListItemDto>`
  - `getStoryById()` → `StoryDetailDto`
  - `toggleStoryRecommendation()` / `deleteStory()` → `Story` type
  - Fixed security issue: `deleteUser`/`restoreUser` now use `select` to exclude `passwordHash`/`pinHash`
- `src/admin/admin.controller.ts` - Fixed 4 `as any` casts with `ApiResponseDto<T>`
- `src/admin/dto/admin-responses.dto.ts` - Added new DTOs: `UserListItemDto`, `StoryListItemDto`, `AdminCreatedDto`, `UserUpdatedDto`
- `src/notification/*.ts` - Changed `Record<string, any>` to `Record<string, unknown>`
- `src/achievement-progress/badge.service.ts` - Fixed Prisma compound key type assertion
- `src/voice/providers/eleven-labs-tts.provider.ts` - Fixed SDK type compatibility (`blob as unknown as File`)
- `src/notification/providers/in-app.provider.ts` - Fixed Prisma JSON type with proper cast

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

### Instance 6 - ✅ Completed
**Focus**: Phase 1 God Service Extractions
**Timestamp**: 2026-02-08
**Branch**: `perf/improvements`

**Changes Made**:
- `src/story/story-progress.service.ts` (NEW ~300 lines) - Extracted from StoryService
  - Methods: setProgress, getProgress, getContinueReading, getCompletedStories, getCreatedStories,
    setUserProgress, getUserProgress, getUserContinueReading, getUserCompletedStories,
    removeFromUserLibrary, getDownloads, addDownload, removeDownload, removeFromLibrary
- `src/story/daily-challenge.service.ts` (NEW ~260 lines) - Extracted from StoryService
  - Methods: setDailyChallenge, getDailyChallenge, assignDailyChallenge, completeDailyChallenge,
    getAssignmentsForKid, getAssignmentById, assignDailyChallengeToAllKids,
    handleDailyChallengeAssignment (cron), getTodaysDailyChallengeAssignment, getWeeklyDailyChallengeAssignments
- `src/admin/admin-analytics.service.ts` (NEW ~600 lines) - Extracted from AdminService
  - Methods: getDashboardStats, getUserGrowth, getStoryStats, getContentBreakdown, getSystemHealth,
    getSubscriptionAnalytics, getRevenueAnalytics, getAiCreditAnalytics, getUserGrowthMonthly, calculateChurnRate
- Updated controllers and modules to use new services

**Status**: Phase 1 complete. All three high-impact extractions done.

### Instance 7 - ✅ Completed
**Focus**: Phase 2 God Service Extractions (Auth & User Domain)
**Timestamp**: 2026-02-09
**Branch**: `perf/improvements`

**Changes Made**:
- `src/auth/services/oauth.service.ts` (NEW ~250 lines) - Extracted from AuthService
  - Methods: loginWithGoogleIdToken, handleGoogleOAuthPayload, loginWithAppleIdToken, upsertOrReturnUserFromOAuthPayload
- `src/auth/services/onboarding.service.ts` (NEW ~190 lines) - Extracted from AuthService
  - Methods: completeProfile, getLearningExpectations, updateProfile
- `src/user/services/user-deletion.service.ts` (NEW ~280 lines) - Extracted from UserService
  - Methods: deleteUser, terminateUserSessions, deleteUserAccount, verifyPasswordAndLogDeletion, undoDeleteUser, undoDeleteMyAccount
- `src/user/services/user-pin.service.ts` (NEW ~200 lines) - Extracted from UserService
  - Methods: setPin, verifyPin, requestPinResetOtp, validatePinResetOtp, resetPinWithOtp
- Updated AuthModule, AuthController, UserModule, UserController to use new services
- Updated test files to remove tests for moved methods
- AuthService reduced from ~694 lines to ~264 lines
- UserService reduced from ~448 lines to ~256 lines

**Status**: Phase 2 complete. All four Auth & User domain extractions done.

### Instance 8 - ✅ Completed
**Focus**: Phase 3 God Service Extractions (Notification & Reports Domain)
**Timestamp**: 2026-02-09
**Branch**: `perf/improvements`

**Changes Made**:
- `src/notification/services/notification-preference.service.ts` (NEW ~370 lines) - Extracted from NotificationService
  - Methods: create, update, getForUser, getForKid, getById, toggleCategoryPreference, getUserPreferencesGrouped, updateUserPreferences, seedDefaultPreferences, delete, undoDelete
- `src/notification/services/in-app-notification.service.ts` (NEW ~65 lines) - Extracted from NotificationService
  - Methods: getInAppNotifications, markAsRead, markAllAsRead
- `src/reports/services/screen-time.service.ts` (NEW ~175 lines) - Extracted from ReportsService
  - Methods: startScreenTimeSession, endScreenTimeSession, getTodayScreenTime, getScreenTimeForRange, getEffectiveDailyLimit, getDailyLimitStatus
- Updated NotificationModule with new services as providers and exports
- Updated NotificationController to use NotificationPreferenceService
- Updated UserPreferencesController to use NotificationPreferenceService
- Updated InAppNotificationController to use InAppNotificationService
- Updated ReportsModule to include ScreenTimeService
- Updated ReportsController to use ScreenTimeService for screen time endpoints
- Updated ReportsService to delegate to ScreenTimeService
- NotificationService reduced to core notification sending functionality (~323 lines)
- ReportsService reduced from ~536 lines to ~337 lines

**Status**: Phase 3 complete. All Notification & Reports domain extractions done.

### Instance 9 - ✅ Completed
**Focus**: E2E Tests for Authentication Flows
**Timestamp**: 2026-02-09
**Branch**: `fix/bug-fixes`

**Changes Made**:
- `test/auth.e2e-spec.ts` (NEW ~850 lines) - Comprehensive E2E tests for auth flows:
  - Registration tests: valid registration, invalid email, weak password, single name, missing fields, duplicate email, email sanitization
  - Login tests: valid credentials, invalid password, non-existent email, missing fields, email case handling
  - Token refresh tests: valid refresh, invalid token, missing token
  - Protected routes tests: with/without token, invalid token, malformed header
  - Logout tests: single session and all devices
  - Email verification tests: invalid token, missing token, send verification
  - Password reset tests: request reset, validate token, reset with weak password
  - Change password tests: with token, incorrect old password, without auth
  - OAuth tests: Google and Apple with missing/invalid id_token
  - Learning expectations: public endpoint access
- `test/jest-e2e.json` - Added moduleNameMapper for googleapis and uuid mocks
- Mock PrismaService with in-memory storage for user, session, token, profile models
- Mock EmailQueueService, EmailProcessor, EmailProvider for email testing

**Status**: Complete - 41 E2E tests passing, build passing

### Instance 10 - ✅ Completed
**Focus**: Phase 4 God Service Extractions (Admin Domain)
**Timestamp**: 2026-02-09
**Branch**: `fix/bug-fixes`

**Changes Made**:
- `src/admin/admin-user.service.ts` (NEW ~370 lines) - Extracted from AdminService
  - Methods: getAllUsers, getUserById, createAdmin, updateUser, deleteUser, restoreUser, bulkUserAction
- `src/admin/admin-story.service.ts` (NEW ~240 lines) - Extracted from AdminService
  - Methods: getAllStories, getStoryById, toggleStoryRecommendation, deleteStory, getCategories, getThemes
- `src/admin/admin.module.ts` - Added new services to providers and exports
- `src/admin/admin.controller.ts` - Updated to use AdminUserService and AdminStoryService
- `src/admin/tests/admin.controller.spec.ts` - Updated test file with mock providers for new services

**Status**: Complete - Build passing, admin controller tests passing

### Instance 11 - ✅ Completed
**Focus**: Phase 4 God Service Extractions (StoryRecommendationService)
**Timestamp**: 2026-02-09
**Branch**: `perf/improvements`

**Changes Made**:
- `src/story/story-recommendation.service.ts` (NEW ~510 lines) - Extracted from StoryService
  - Methods: getHomePageStories, getRelevantSeasons, restrictStory, unrestrictStory, getRestrictedStories,
    recommendStoryToKid, getKidRecommendations, deleteRecommendation, getRecommendationStats,
    getTopPicksFromParents, getTopPicksFromUs, getRandomStoryIds, toRecommendationResponse (private)
  - Constant: RECENT_SEASON_THRESHOLD_DAYS
- `src/story/story.service.ts` - Removed extracted methods, added delegation via forwardRef injection:
  - getStories() now delegates getRelevantSeasons() and getRandomStoryIds() to StoryRecommendationService
  - StoryService reduced from ~1984 lines to ~1505 lines
- `src/story/story.module.ts` - Added StoryRecommendationService to providers and exports
- `src/story/story.controller.ts` - Updated 10 endpoints to use StoryRecommendationService:
  - getHomePageStories, restrictStory, unrestrictStory, getRestrictedStories,
    recommendStoryToKid, getKidRecommendations, deleteRecommendation,
    getRecommendationStats, getTopPicksFromParents, getTopPicksFromUs

**Status**: Complete - Build passing

### Instance 12 - ✅ Completed
**Focus**: Unit Tests for Extracted Auth & User Services
**Timestamp**: 2026-02-09
**Branch**: `fix/bug-fixes`

**Changes Made**:
- `src/auth/services/oauth.service.spec.ts` (NEW ~870 lines) - Comprehensive unit tests for OAuthService
  - 21 tests covering:
    - Google OAuth: token validation, existing user login, email linking, new user creation
    - Apple OAuth: token validation, existing user login, new user creation with/without names
    - Avatar handling: creating, reusing, and updating avatars during OAuth
    - Error scenarios: invalid tokens, unverified emails, missing payloads
  - Mocks for google-auth-library (OAuth2Client), apple-signin-auth, PrismaService, TokenService, PasswordService, NotificationPreferenceService
- `src/auth/services/onboarding.service.spec.ts` (NEW ~650 lines) - Comprehensive unit tests for OnboardingService
  - 22 tests covering:
    - completeProfile: profile completion with learning expectations, categories, avatars
    - getLearningExpectations: fetching active learning expectations
    - updateProfile: partial updates, profile creation, upsert behavior
    - Error scenarios: user not found, duplicate onboarding, invalid learning expectations
- `src/user/services/user-deletion.service.spec.ts` (NEW ~350 lines) - Comprehensive unit tests for UserDeletionService
  - 18 tests covering:
    - deleteUser: soft delete, permanent delete with session termination, error handling
    - verifyPasswordAndLogDeletion: password verification, support ticket creation
    - undoDeleteUser: admin restore of soft-deleted users
    - undoDeleteMyAccount: self-restoration of soft-deleted accounts
    - Error scenarios: user not found, already deleted, foreign key constraints
- `src/user/services/user-pin.service.spec.ts` (NEW ~380 lines) - Comprehensive unit tests for UserPinService
  - 23 tests covering:
    - setPin: PIN validation, onboarding status check, hash storage
    - verifyPin: PIN verification against bcrypt hash
    - requestPinResetOtp: OTP generation, email sending via NotificationService
    - validatePinResetOtp: OTP format validation, expiry checking
    - resetPinWithOtp: full PIN reset flow with OTP verification
    - Error scenarios: invalid format, expired OTP, same PIN as old

**Status**: Complete - All 84 tests passing (43 auth + 41 user), build passing

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
| `src/story/story-progress.service.ts` | Instance 6 | ✅ Done |
| `src/story/daily-challenge.service.ts` | Instance 6 | ✅ Done |
| `src/admin/admin-analytics.service.ts` | Instance 6 | ✅ Done |
| `src/admin/admin.service.ts` | Instance 4 | ✅ Done |
| `src/admin/admin.controller.ts` | Instance 4 | ✅ Done |
| `src/admin/dto/admin-responses.dto.ts` | Instance 4 | ✅ Done |
| `src/notification/notification.service.ts` | Instance 4 | ✅ Done |
| `src/notification/notification.registry.ts` | Instance 4 | ✅ Done |
| `src/notification/providers/*` | Instance 4 | ✅ Done |
| `src/achievement-progress/badge.service.ts` | Instance 4 | ✅ Done |
| `src/auth/services/oauth.service.ts` | Instance 7 | ✅ Done |
| `src/auth/services/onboarding.service.ts` | Instance 7 | ✅ Done |
| `src/user/services/user-deletion.service.ts` | Instance 7 | ✅ Done |
| `src/user/services/user-pin.service.ts` | Instance 7 | ✅ Done |
| `src/auth/auth.module.ts` | Instance 7 | ✅ Done |
| `src/auth/auth.controller.ts` | Instance 7 | ✅ Done |
| `src/user/user.module.ts` | Instance 7 | ✅ Done |
| `src/user/user.controller.ts` | Instance 7 | ✅ Done |
| `src/notification/services/notification-preference.service.ts` | Instance 8 | ✅ Done |
| `src/notification/services/in-app-notification.service.ts` | Instance 8 | ✅ Done |
| `src/notification/notification.module.ts` | Instance 8 | ✅ Done |
| `src/notification/notification.controller.ts` | Instance 8 | ✅ Done |
| `src/notification/user-preferences.controller.ts` | Instance 8 | ✅ Done |
| `src/notification/in-app-notification.controller.ts` | Instance 8 | ✅ Done |
| `src/reports/services/screen-time.service.ts` | Instance 8 | ✅ Done |
| `src/reports/reports.service.ts` | Instance 8 | ✅ Done |
| `src/reports/reports.module.ts` | Instance 8 | ✅ Done |
| `src/reports/reports.controller.ts` | Instance 8 | ✅ Done |
| `test/auth.e2e-spec.ts` | Instance 9 | ✅ Done |
| `test/jest-e2e.json` | Instance 9 | ✅ Done |
| `src/admin/admin-user.service.ts` | Instance 10 | ✅ Done |
| `src/admin/admin-story.service.ts` | Instance 10 | ✅ Done |
| `src/admin/admin.module.ts` | Instance 10 | ✅ Done |
| `src/admin/admin.controller.ts` | Instance 10 | ✅ Done |
| `src/admin/tests/admin.controller.spec.ts` | Instance 10 | ✅ Done |
| `src/story/story-recommendation.service.ts` | Instance 11 | ✅ Done |
| `src/story/story.service.ts` | Instance 11 | ✅ Done |
| `src/story/story.module.ts` | Instance 11 | ✅ Done |
| `src/story/story.controller.ts` | Instance 11 | ✅ Done |
| `src/auth/services/oauth.service.spec.ts` | Instance 12 | ✅ Done |
| `src/auth/services/onboarding.service.spec.ts` | Instance 12 | ✅ Done |
| `src/user/services/user-deletion.service.spec.ts` | Instance 12 | ✅ Done |
| `src/user/services/user-pin.service.spec.ts` | Instance 12 | ✅ Done |

---

## 🎯 Remaining Work (Unclaimed)

Available tasks from the roadmaps:

### From PERFORMANCE_IMPROVEMENTS.md
- [x] Add transactions to SubscriptionService for plan changes *(Instance 1)*
- [x] Add transactions to PaymentService for atomic payment + subscription *(Instance 3)*
- [x] Add transactions to StoryService for story creation *(Instance 4)*
- [x] Batch sequential queries (N+1 fixes in story.service.ts) *(Instance 4 & 5)*
- [x] Add retry logic to AI provider calls (GeminiService) *(Instance 3)*
- [x] Implement circuit breaker for external services *(already existed in GeminiService)*

### From QA_IMPROVEMENTS.md
- [x] Add unit tests for AuthService *(Instance 4)*
- [x] Add unit tests for UserService *(Instance 4)*
- [x] Add unit tests for SubscriptionService *(Instance 4)*
- [x] Add unit tests for NotificationService *(Instance 4)*
- [x] Add E2E tests for authentication flows *(Instance 9)*
- [x] Replace remaining `any` types (~22 files) *(Instance 4 & 5 - production code complete, only test mocks remain)*

### God Service Extractions (see QA_IMPROVEMENTS.md section 2.3 for details)

**Phase 1: High-Impact Extractions** ✅ COMPLETE *(Instance 6)*
- [x] Extract `StoryProgressService` from `StoryService`
- [x] Extract `DailyChallengeService` from `StoryService`
- [x] Extract `AdminAnalyticsService` from `AdminService`

**Phase 2: Auth & User Domain** ✅ COMPLETE *(Instance 7)*
- [x] Extract `OAuthService` from `AuthService`
- [x] Extract `OnboardingService` from `AuthService`
- [x] Extract `UserDeletionService` from `UserService`
- [x] Extract `UserPinService` from `UserService`

**Phase 3: Notification & Reports** ✅ COMPLETE *(Instance 8)*
- [x] Extract `NotificationPreferenceService` from `NotificationService` *(Instance 8)*
- [x] Extract `InAppNotificationService` from `NotificationService` *(Instance 8)*
- [x] Extract `ScreenTimeService` from `ReportsService` *(Instance 8)*

**Phase 4: Remaining Extractions** (Partially Complete - Instance 10 & 11)
- [x] Extract `AdminUserService` from `AdminService` *(Instance 10)*
- [x] Extract `AdminStoryService` from `AdminService` *(Instance 10)*
- [ ] Extract `StoryGenerationService` from `StoryService`
- [x] Extract `StoryRecommendationService` from `StoryService` *(Instance 11)*
- [ ] Extract `BuddySelectionService` from `StoryBuddyService`
- [ ] Extract `BuddyMessagingService` from `StoryBuddyService`

---

## 🔗 Branch Strategy

```
develop-v0.0.1 (base)
    └── integration/refactor-2026-02 (shared integration - source of truth)
            ├── fix/format-and-lint (merged ✅)
            ├── perf/improvements (Instance 2, 6, 7, 8 & 11)
            ├── feat/gemini-retry-logic (merged ✅)
            ├── fix/bug-fixes (Instance 4, 9 & 10)
            └── perf/resilience-improvements (Instance 5 - PR #219)
```

### Workflow for Each Instance

Each instance works on a **separate worktree** with their own **feature branch**, using the integration branch as the source of truth:

1. **Pull from integration** to see what's left and what others are doing:
   ```bash
   git fetch origin
   git merge origin/integration/refactor-2026-02
   ```

2. **Do your work** on your feature branch (one file/service at a time - check Conflict Zones first!)

3. **Merge back to integration** to let others know what you're doing:
   ```bash
   git checkout integration/refactor-2026-02
   git merge your-feature-branch
   git push origin integration/refactor-2026-02
   ```

4. **Update COORDINATION.md** - log your changes and update Conflict Zones table

### Final Merge to develop-v0.0.1

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

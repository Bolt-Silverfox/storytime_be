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

### 1.1 Unit Test Status (P0 - Critical)

Current coverage: **31 test files** covering major services

**Core Services with Tests ✅:**
| Service | Lines | Has Tests | Status |
|---------|-------|-----------|--------|
| `AuthService` | ~264 | ✅ YES (31 tests) | Complete |
| `UserService` | ~256 | ✅ YES (45 tests) | Complete |
| `NotificationService` | ~323 | ✅ YES (34 tests) | Complete |
| `SubscriptionService` | ~300 | ✅ YES (15 tests) | Complete |
| `OAuthService` | ~250 | ✅ YES (21 tests) | Complete |
| `OnboardingService` | ~190 | ✅ YES (22 tests) | Complete |
| `UserDeletionService` | ~280 | ✅ YES (18 tests) | Complete |
| `UserPinService` | ~200 | ✅ YES (23 tests) | Complete |
| `PaymentService` | ~400 | ✅ YES | Complete |
| `StoryService` | ~1500 | ✅ YES | Complete |
| `StoryGenerationService` | ~340 | ✅ YES | Complete |
| `VoiceService` | ~500 | ✅ YES | Complete |
| `KidService` | ~300 | ✅ YES | Complete |
| `HelpSupportService` | ~200 | ✅ YES | Complete |
| `ParentFavoritesService` | ~150 | ✅ YES | Complete |
| `AdminController` | - | ✅ YES | Complete |
| `AdminStoryService` | ~240 | ✅ YES | Complete |
| `AdminUserService` | ~370 | ✅ YES | Complete |

**Services Still Needing Tests:**
| Service | Lines | Priority |
|---------|-------|----------|
| `BadgeService` | ~200 | P3 |
| `ProgressService` | ~250 | P3 |

**Recently Added Tests (Integration Session - 2026-02-23):**
| Service | Tests | Instance |
|---------|-------|----------|
| `AdminAnalyticsService` | 40 tests | Integration session |
| `AdminSystemService` | 32 tests | Integration session |
| `PasswordService` | 22 tests | Integration session |
| `TokenService` | 24 tests | Integration session |
| `EmailVerificationService` | 7 tests | Integration session |
| `DeviceTokenService` | 18 tests | Integration session |
| `NotificationPreferenceService` | 25 tests | Integration session |

**Action Items:**
- [x] Add unit tests for `AuthService` (login, register, password reset, OAuth flows) ✅ *Instance 4*
- [x] Add unit tests for `UserService` (CRUD, profile updates, PIN management) ✅ *Instance 4*
- [x] Add unit tests for `NotificationService` (email queue, in-app notifications) ✅ *Instance 4*
- [x] Add unit tests for `SubscriptionService` (plan changes, renewals, cancellations) ✅ *Instance 4*
- [x] Add unit tests for `OAuthService` (Google, Apple OAuth flows) ✅ *Instance 12*
- [x] Add unit tests for `OnboardingService` (profile completion, learning expectations) ✅ *Instance 12*
- [x] Add unit tests for `UserDeletionService` (soft/hard delete, restore) ✅ *Instance 12*
- [x] Add unit tests for `UserPinService` (PIN management, OTP reset) ✅ *Instance 12*

### 1.2 Missing E2E Tests (P1 - High)

| Flow | File | Status | Priority |
|------|------|--------|----------|
| Authentication (login/register) | `test/auth.e2e-spec.ts` | ✅ YES (41 tests) | ~~P0~~ ✅ |
| OAuth (Google/Apple) | `test/auth.e2e-spec.ts` | ✅ YES (included) | ~~P1~~ ✅ |
| Payment processing | `payment.e2e-spec.ts` | ❌ NO | P0 |
| Subscription management | `subscription.e2e-spec.ts` | ❌ NO | P1 |
| Story CRUD operations | `story.e2e-spec.ts` | ❌ NO | P2 |
| Kid profile management | `kid.e2e-spec.ts` | ❌ NO | P2 |

**Action Items:**
- [x] Create E2E test suite for authentication flows ✅ *Instance 9 - 41 tests*
- [ ] Create E2E test suite for payment/subscription flows
- [x] Set up test database seeding for E2E tests ✅ *Instance 9*

### 1.3 Existing Tests Needing Review (P2)

| Test File | Issue |
|-----------|-------|
| `src/admin/tests/admin.service.spec.ts` | Review mock completeness |
| `src/story/story.service.spec.ts` | Add edge case coverage |
| `src/payment/payment.service.spec.ts` | Add failure scenario tests |

---

## 2. Code Quality Issues

### 2.1 `any` Type Usage (P1 - High) ✅ LARGELY COMPLETE

**Status**: Production code `any` types eliminated *(Instance 4 & 5)*. Only test mocks remain.

**Completed Fixes:**
| File | Fix Applied | Instance |
|------|-------------|----------|
| `src/admin/admin.service.ts` | Added DTOs: `PaginatedResponseDto`, `UserListItemDto`, `StoryListItemDto`, etc. | Instance 4 |
| `src/admin/admin.controller.ts` | Fixed 4 `as any` casts with `ApiResponseDto<T>` | Instance 4 |
| `src/notification/*.ts` | Changed `Record<string, any>` to `Record<string, unknown>` | Instance 4 |
| `src/auth/auth.service.ts` | Use Prisma `Role` enum instead of `as any` | Instance 5 |
| `src/user/user.service.ts` | Use `Prisma.UserUncheckedUpdateInput` | Instance 5 |
| `src/voice/providers/eleven-labs-tts.provider.ts` | Use `Promise<unknown>` instead of `Promise<any>` | Instance 5 |
| `src/achievement-progress/badge.service.ts` | Fixed Prisma compound key type assertion | Instance 4 |

**Action Items:**
- [x] Create shared type definitions in `src/shared/types/` ✅ *Instance 4*
- [x] Replace all `any` with proper interfaces ✅ *Instance 4 & 5*
- [ ] Enable `noImplicitAny` in `tsconfig.json` (after test mock fixes)

### 2.2 Event-Driven Architecture (P1 - High) ✅ COMPLETE

**Status**: Fully Implemented *(Instances 17, 18 - 2026-02-10)*

Circular dependencies between modules have been resolved using a comprehensive event-driven architecture pattern.

#### Architecture Overview

**Event System Setup:**
- `EventEmitterModule` configured globally in `app.module.ts`
- Centralized event types in `src/shared/events/app-events.ts`
- Event listeners in `src/notification/listeners/` and `src/shared/listeners/`

**All Events Implemented (18 events):**

| Category | Event Name | Emitted By | Purpose |
|----------|-----------|-----------|---------|
| **User Lifecycle** | `user.registered` | AuthService | Track new user registrations |
| | `user.deleted` | UserDeletionService | Track account deletions |
| | `user.email_verified` | AuthService | Track email verifications |
| | `user.password_changed` | PasswordService | Track password changes |
| **Payment** | `payment.completed` | PaymentService | Track successful payments |
| | `payment.failed` | PaymentService | Track failed payments |
| **Subscription** | `subscription.created` | PaymentService | Track new subscriptions |
| | `subscription.changed` | PaymentService | Track plan changes |
| | `subscription.cancelled` | SubscriptionService | Track cancellations |
| **Story** | `story.created` | StoryGenerationService | Track story creation |
| | `story.completed` | StoryProgressService | Track story completions |
| | `story.progress_updated` | StoryProgressService | Track reading progress |
| **Password** | `password.reset_requested` | PasswordService | Send password reset emails |
| | `password.changed` | PasswordService | Send password change confirmations |
| **Email** | `email.verification_requested` | AuthService | Send verification emails |

**Event Listeners Implemented:**

| Listener | Location | Purpose | Events Handled |
|----------|----------|---------|----------------|
| `AuthEventListener` | `src/notification/listeners/` | Handle auth notifications | user.registered, user.email_verified, user.password_changed |
| `PasswordEventListener` | `src/notification/listeners/` | Handle password emails | password.reset_requested, password.changed |
| `AnalyticsEventListener` | `src/shared/listeners/` | Track business metrics | All payment, subscription, story events |
| `ActivityLogEventListener` | `src/shared/listeners/` | Audit trail logging | All user, payment, subscription events |

**Services Emitting Events:**

| Service | Events Emitted | Lines Modified |
|---------|---------------|----------------|
| `AuthService` | user.registered, user.email_verified | ~10 lines |
| `PasswordService` | user.password_changed, password.reset_requested, password.changed | ~20 lines |
| `UserDeletionService` | user.deleted | ~10 lines |
| `PaymentService` | payment.completed, payment.failed, subscription.created, subscription.changed | ~45 lines |
| `SubscriptionService` | subscription.cancelled | ~12 lines |
| `StoryGenerationService` | story.created | ~10 lines |
| `StoryProgressService` | story.completed, story.progress_updated | ~35 lines |

**Circular Dependencies Removed:**
| Modules | Before | After |
|---------|--------|-------|
| Auth ↔ Notification | `forwardRef()` both ways | Events (decoupled) |
| Payment ↔ Auth | `forwardRef()` | Removed (unnecessary) |
| Subscription ↔ Payment/Auth/User | `forwardRef()` (3x) | Removed (unnecessary) |
| Achievement ↔ Auth | `forwardRef()` | Removed (unnecessary) |

**Benefits:**
- ✅ Zero circular dependencies remaining
- ✅ Complete decoupling between business logic and cross-cutting concerns
- ✅ Comprehensive audit trail via ActivityLogEventListener
- ✅ Analytics tracking centralized in AnalyticsEventListener
- ✅ Easy to add new listeners without modifying emitters
- ✅ Type-safe event payloads with TypeScript interfaces
- ✅ Async operation support (fire-and-forget events)
- ✅ Ready for future integrations (Mixpanel, Amplitude, etc.)

**Implementation Details:**
- Event payload types defined in `src/shared/events/app-events.ts`
- All events use standardized naming: `domain.action` (e.g., `user.registered`)
- Listeners registered in SharedModule for global availability
- PrismaService injected for activity logging
- Error handling in all listeners (failed listeners don't break main flow)

### 2.3 Console.log Usage (P3 - Low)

| File | Line | Issue |
|------|------|-------|
| `src/story-buddy/story-buddy.seeder.ts` | 124 | `console.error('Error seeding...')` |

**Action Items:**
- [ ] Replace with `Logger.error()` from `@nestjs/common`

### 2.4 God Services - Single Responsibility Violations (P1 - High) ✅ COMPLETE

#### Overview

~~Services exceeding 400-line recommendation with detailed refactoring plans. Current state: **7 god services totaling 7,292 lines** that should be split into **27 focused services averaging ~270 lines each**.~~

**STATUS: ALL 4 PHASES COMPLETE** *(Instances 6, 7, 8, 10, 11, 13, 14, 15)*

**Results:**
- 7 god services refactored into 19 focused services
- Average service size reduced from ~1,000 lines to ~250 lines
- All builds passing, tests passing

---

#### 2.3.1 AdminService (2,121 lines) → 4 Services

**Current Responsibilities:**

| Area | Lines | Methods |
|------|-------|---------|
| Dashboard Statistics | ~385 | 5 methods |
| User Management | ~410 | 7 methods |
| Story Management | ~175 | 4 methods |
| Analytics (Subscription/Revenue/AI) | ~350 | 6 methods |
| System Management | ~200 | 6 methods |
| Support & Integrations | ~115 | 4 methods |

**Proposed Split:**

1. **AdminUserService** (~410 lines)
   - `getAllUsers()`, `getUserById()`, `createAdmin()`
   - `updateUser()`, `deleteUser()`, `restoreUser()`, `bulkUserAction()`

2. **AdminStoryService** (~250 lines)
   - `getAllStories()`, `getStoryById()`
   - `toggleStoryRecommendation()`, `deleteStory()`
   - `getCategories()`, `getThemes()`

3. **AdminAnalyticsService** (~600 lines)
   - `getDashboardStats()`, `getUserGrowth()`, `getStoryStats()`
   - `getContentBreakdown()`, `getSystemHealth()`
   - `getSubscriptionAnalytics()`, `getRevenueAnalytics()`
   - `getAiCreditAnalytics()`, `getUserGrowthMonthly()`

4. **AdminSystemService** (~300 lines)
   - `getRecentActivity()`, `getSystemLogs()`, `createBackup()`
   - `seedDatabase()`, `getSubscriptions()`
   - `getElevenLabsBalance()`, `getAllSupportTickets()`
   - `updateSupportTicket()`, `getDeletionRequests()`

**Dependencies:**
- All services inject `PrismaService`
- `AdminAnalyticsService` injects `CacheManager`
- `AdminSystemService` injects `ElevenLabsTTSProvider`

**Implementation Order:** Analytics → User → Story → System

---

#### 2.3.2 StoryService (1,787 lines) → 5 Services

**Current Responsibilities:**

| Area | Lines | Methods |
|------|-------|---------|
| Core CRUD | ~200 | 8 methods |
| Progress & Library | ~250 | 12 methods |
| Daily Challenges | ~320 | 9 methods |
| AI Generation | ~300 | 4 methods |
| Recommendations | ~180 | 6 methods |
| Home Page & Cache | ~165 | 4 methods |

**Proposed Split:**

1. **StoryService** (core, ~350 lines)
   - `getStories()`, `createStory()`, `updateStory()`, `deleteStory()`
   - `undoDeleteStory()`, `addImage()`, `addBranch()`
   - `getStoryById()`, `getCategories()`, `getThemes()`, `getSeasons()`

2. **StoryProgressService** (~300 lines)
   - `setProgress()`, `getProgress()`, `setUserProgress()`, `getUserProgress()`
   - `getContinueReading()`, `getCompletedStories()`, `getCreatedStories()`
   - `getDownloads()`, `addDownload()`, `removeDownload()`
   - `removeFromLibrary()`, `removeFromUserLibrary()`

3. **StoryGenerationService** (~350 lines)
   - `generateStoryWithAI()`, `generateStoryForKid()`
   - `persistGeneratedStory()`, `adjustReadingLevel()`
   - `calculateDurationSeconds()`, `getStoryAudioUrl()`

4. **StoryRecommendationService** (~250 lines)
   - `getHomePageStories()`, `getRelevantSeasons()`
   - `recommendStoryToKid()`, `getKidRecommendations()`
   - `deleteRecommendation()`, `getRecommendationStats()`
   - `getTopPicksFromParents()`, `getTopPicksFromUs()`
   - `restrictStory()`, `unrestrictStory()`, `getRestrictedStories()`

5. **DailyChallengeService** (~350 lines)
   - `setDailyChallenge()`, `getDailyChallenge()`
   - `assignDailyChallenge()`, `completeDailyChallenge()`
   - `getAssignmentsForKid()`, `getAssignmentById()`
   - `assignDailyChallengeToAllKids()`, `handleDailyChallengeAssignment()`
   - `getTodaysDailyChallengeAssignment()`, `getWeeklyDailyChallengeAssignments()`
   - `addFavorite()`, `removeFavorite()`, `getFavorites()`

**Dependencies:**
- `StoryGenerationService` → `GeminiService`, `TextToSpeechService`
- `StoryProgressService` → `CacheManager`
- All → `PrismaService`

**Implementation Order:** Progress → Recommendations → DailyChallenge → Generation → Core

---

#### 2.3.3 AuthService (694 lines) → 3 New Services

**Already Extracted:** `TokenService`, `PasswordService`

**Proposed Additional Splits:**

1. **AuthService** (core, ~200 lines)
   - `login()`, `refresh()`, `logout()`, `logoutAllDevices()`

2. **OAuthService** (new, ~180 lines)
   - `loginWithGoogleIdToken()`, `handleGoogleOAuthPayload()`
   - `loginWithAppleIdToken()`, `_upsertOrReturnUserFromOAuthPayload()`

3. **OnboardingService** (new, ~150 lines)
   - `register()`, `completeProfile()`, `updateProfile()`
   - `getLearningExpectations()`

4. **EmailVerificationService** (new, ~80 lines)
   - `sendEmailVerification()`, `verifyEmail()`

---

#### 2.3.4 NotificationService (737 lines) → 4 Services

1. **NotificationService** (core, ~100 lines)
   - `sendNotification()`, `sendViaProvider()`

2. **EmailService** (new, ~150 lines)
   - `queueEmail()`, `sendEmail()`, `sendEmailSync()`

3. **NotificationPreferenceService** (new, ~300 lines)
   - `create()`, `update()`, `getForUser()`, `getForKid()`, `getById()`, `delete()`
   - `toggleCategoryPreference()`, `getUserPreferencesGrouped()`
   - `updateUserPreferences()`, `seedDefaultPreferences()`, `undoDelete()`

4. **InAppNotificationService** (new, ~100 lines)
   - `getInAppNotifications()`, `markAsRead()`, `markAllAsRead()`

---

#### 2.3.5 UserService (689 lines) → 4 Services

1. **UserService** (core, ~200 lines)
   - `getUser()`, `getUserIncludingDeleted()`, `getAllUsers()`, `getActiveUsers()`
   - `updateUser()`, `getUserRole()`, `updateUserRole()`

2. **UserDeletionService** (new, ~200 lines)
   - `deleteUser()`, `deleteUserAccount()`
   - `undoDeleteUser()`, `undoDeleteMyAccount()`
   - `verifyPasswordAndLogDeletion()`, `terminateUserSessions()`

3. **ParentProfileService** (new, ~100 lines)
   - `updateParentProfile()`, `updateAvatarForParent()`

4. **UserPinService** (new, ~150 lines)
   - `setPin()`, `verifyPin()`
   - `requestPinResetOtp()`, `validatePinResetOtp()`, `resetPinWithOtp()`

---

#### 2.3.6 StoryBuddyService (728 lines) → 4 Services

1. **StoryBuddyService** (core, ~300 lines)
   - `getActiveBuddies()`, `getAllBuddies()`, `getBuddyById()`
   - `createBuddy()`, `updateBuddy()`, `deleteBuddy()`, `undoDeleteBuddy()`

2. **BuddySelectionService** (new, ~100 lines)
   - `selectBuddyForKid()`, `getKidCurrentBuddy()`

3. **BuddyMessagingService** (new, ~150 lines)
   - `getBuddyWelcome()`, `getBuddyMessage()`

4. **BuddyAnalyticsService** (new, ~80 lines)
   - `getBuddyStats()`

---

#### 2.3.7 ReportsService (536 lines) → 3 Services

1. **ReportsService** (core, ~150 lines)
   - `getWeeklyOverview()`, `getKidDetailedReport()`

2. **ScreenTimeService** (new, ~200 lines)
   - `startScreenTimeSession()`, `endScreenTimeSession()`
   - `getTodayScreenTime()`, `getScreenTimeForRange()`
   - `getDailyLimitStatus()`, `getEffectiveDailyLimit()`

3. **ProgressTrackingService** (new, ~100 lines)
   - `recordAnswer()`, `completeStory()`

---

#### 2.3.8 AvatarService (422 lines)

**Status:** Borderline - consider minor refactor only if time permits.

---

#### Summary: Refactoring Impact

| Current Service | Lines | New Services | Avg Lines/Service |
|-----------------|-------|--------------|-------------------|
| AdminService | 2,121 | 4 | ~530 |
| StoryService | 1,787 | 5 | ~360 |
| AuthService | 694 | 3 new (+2 existing) | ~140 |
| NotificationService | 737 | 4 | ~185 |
| UserService | 689 | 4 | ~170 |
| StoryBuddyService | 728 | 4 | ~180 |
| ReportsService | 536 | 3 | ~180 |
| **Total** | **7,292** | **27** | **~270** |

---

#### Action Items (Phased Approach) ✅ ALL COMPLETE

**Phase 1: High-Impact Extractions** ✅ *Instance 6*
- [x] Extract `StoryProgressService` from `StoryService` (~300 lines)
- [x] Extract `DailyChallengeService` from `StoryService` (~260 lines)
- [x] Extract `AdminAnalyticsService` from `AdminService` (~600 lines)

**Phase 2: Auth & User Domain** ✅ *Instance 7*
- [x] Extract `OAuthService` from `AuthService` (~250 lines)
- [x] Extract `OnboardingService` from `AuthService` (~190 lines)
- [x] Extract `UserDeletionService` from `UserService` (~280 lines)
- [x] Extract `UserPinService` from `UserService` (~200 lines)

**Phase 3: Notification & Reports** ✅ *Instance 8*
- [x] Extract `NotificationPreferenceService` from `NotificationService` (~370 lines)
- [x] Extract `InAppNotificationService` from `NotificationService` (~65 lines)
- [x] Extract `ScreenTimeService` from `ReportsService` (~175 lines)

**Phase 4: Remaining Extractions** ✅ *Instances 10, 11, 13, 14, 15*
- [x] Extract `AdminUserService` from `AdminService` (~370 lines) *Instance 10*
- [x] Extract `AdminStoryService` from `AdminService` (~240 lines) *Instance 10*
- [x] Extract `StoryGenerationService` from `StoryService` (~340 lines) *Instance 13*
- [x] Extract `StoryRecommendationService` from `StoryService` (~510 lines) *Instance 11*
- [x] Extract `BuddySelectionService` from `StoryBuddyService` (~190 lines) *Instance 14*
- [x] Extract `BuddyMessagingService` from `StoryBuddyService` (~150 lines) *Instance 15*

---

## 3. Error Handling

### 3.1 Generic Error Throws ✅ LARGELY COMPLETE

**Status**: Production code cleaned up. Only 2 remaining instances:
1. `src/story/story-generation.service.spec.ts` - Test file (acceptable)
2. `src/shared/config/env.validation.ts` - Environment validation (acceptable for startup errors)

All service-level generic `Error` throws have been replaced with appropriate NestJS exceptions:
- ✅ `DomainException` hierarchy implemented
- ✅ Auth exceptions (InvalidCredentials, TokenExpired, etc.)
- ✅ Resource exceptions (NotFound, AlreadyExists)
- ✅ Business logic exceptions (QuotaExceeded, SubscriptionRequired, ValidationException)
- ✅ Error codes added for client-side handling

**Action Items:**
- [x] Replace all service-level `throw new Error()` with NestJS exceptions
- [x] Add error codes for client-side handling
- [x] Ensure all errors are caught by exception filters

### 3.2 Low Try-Catch Coverage (P2 - Medium)

Only **64 try-catch blocks** across 220+ TypeScript files.

| Service | Lines | Try-Catch Blocks | Recommended |
|---------|-------|------------------|-------------|
| `StoryService` | 1,772 | 9 | 20+ |
| `AdminService` | 2,121 | ~10 | 25+ |
| `AuthService` | 694 | ~5 | 15+ |

**Action Items:**
- [ ] Add try-catch around all external API calls (Gemini, ElevenLabs, Deepgram)
- [ ] Add try-catch around all database operations
- [ ] Implement retry logic for transient failures

---

## 4. Security Issues

### 4.1 Input Validation in Controllers (P2 - Medium)

Manual validation after DTO parsing (should be in DTO):

| File | Line | Issue |
|------|------|-------|
| `src/avatar/avatar.controller.ts` | 195-196 | Manual `userId` check after DTO |
| `src/avatar/avatar.controller.ts` | 291-292 | Manual `userId` check after DTO |

**Action Items:**
- [ ] Move validation to DTO decorators
- [ ] Use `class-validator` for all input validation
- [ ] Remove redundant manual checks

### 4.2 Type Casting in Guards (P2 - Medium)

| File | Line | Issue | Fix |
|------|------|-------|-----|
| `src/shared/guards/admin.guard.ts` | 14 | `(request as any).authUserData` | Use `AuthenticatedRequest` interface |

**Action Items:**
- [ ] Create `AuthenticatedRequest` interface extending `Request`
- [ ] Apply to all guards consistently

### 4.3 Session Validation (P2 - Medium)

- Only `AuthSessionGuard` validates session existence
- OAuth flows may bypass session checks
- No token expiry validation against `authSessionId`

**Action Items:**
- [ ] Review OAuth callback session handling
- [ ] Add session validation to all auth flows
- [ ] Implement token refresh mechanism

---

## 5. Architecture Issues

### 5.1 Circular Dependencies (P1 - High) ✅ LARGELY RESOLVED

**Status**: Event-driven architecture implemented. Reduced from 7 modules to 3 modules using `forwardRef()`.

**Remaining `forwardRef` usages** (3 modules, 6 occurrences):

| Module | Depends On | Via | Reason |
|--------|------------|-----|--------|
| `StoryModule` | `VoiceModule` | `forwardRef` | Bidirectional TTS dependency |
| `VoiceModule` | `StoryModule` | `forwardRef` | Bidirectional TTS dependency |
| `AchievementProgressModule` | Various | `forwardRef` | Badge/progress tracking |

**Resolved via Event-Driven Architecture:**
- ✅ `AuthModule` ↔ `NotificationModule` - Now uses events
- ✅ `PaymentModule` ↔ `AuthModule` - Now uses events
- ✅ `SubscriptionModule` dependencies - Now uses events

**Implementation (see Section 2.2 for details):**
```typescript
// Event emission replaces direct service calls
this.eventEmitter.emit(AppEvents.USER_REGISTERED, { userId, email });

// Listeners handle cross-cutting concerns independently
@OnEvent(AppEvents.USER_REGISTERED)
handleUserRegistered(payload: UserRegisteredEvent) {
  await this.sendWelcomeEmail(payload.email);
}
```

**Action Items:**
- [x] Implement event-driven patterns for cross-module communication
- [x] Remove `forwardRef` from Auth/Notification/Payment modules
- [ ] Consider extracting shared TTS logic to resolve Story ↔ Voice dependency (low priority)

---

## Progress Tracking

### Completed ✅
- [x] Initial codebase analysis
- [x] Document all issues
- [x] Refactor god services (ALL 4 PHASES COMPLETE - 19 services extracted)
- [x] Event-driven architecture (20 events, 4 listeners)
- [x] Remove most circular dependencies (reduced from 7 to 3 modules)
- [x] Repository pattern implementation (all services)
- [x] Rate limiting on auth and payment endpoints
- [x] CI/CD pipeline with quality gates

### In Progress 🔄
- [ ] Test coverage improvements (need: story-progress, badge, progress services)

### Pending 📋
- [ ] E2E tests for payment/subscription flows

---

## 6. Testing Strategy

### 6.1 Testing Pyramid (P0 - Critical)

Based on NestJS best practices, implement the testing pyramid:

```
        /\
       /  \  E2E Tests (10%)
      /----\  - Critical user flows
     /      \ - Auth, payments, subscriptions
    /--------\
   /          \ Integration Tests (30%)
  /            \ - API endpoints
 /--------------\ - Service + Repository
/                \
/------------------\ Unit Tests (60%)
                    - Pure business logic
                    - Services in isolation
```

**Test File Naming Convention:**
- Unit tests: `*.spec.ts`
- E2E tests: `*.e2e-spec.ts`
- Integration tests: `*.integration-spec.ts`

### 6.2 NestJS Testing Patterns (P1 - High)

**Mock Pattern for Services:**
```typescript
// ✅ Recommended mock pattern
const mockPrismaService = {
  user: { findUnique: jest.fn(), create: jest.fn() },
  story: { findMany: jest.fn(), findUnique: jest.fn() },
  $transaction: jest.fn((cb) => cb(mockPrismaService)),
};

beforeEach(async () => {
  const module = await Test.createTestingModule({
    providers: [
      UserService,
      { provide: PrismaService, useValue: mockPrismaService },
      { provide: CacheService, useValue: mockCacheService },
    ],
  }).compile();
});
```

**Testing Guards:**
```typescript
describe('AuthSessionGuard', () => {
  it('should allow authenticated requests', async () => {
    const mockContext = createMockExecutionContext({
      user: { id: 'user-123', email: 'test@example.com' },
    });

    const result = await guard.canActivate(mockContext);
    expect(result).toBe(true);
  });
});
```

**Testing Interceptors:**
```typescript
describe('SuccessResponseInterceptor', () => {
  it('should wrap response in standard format', async () => {
    const interceptor = new SuccessResponseInterceptor();
    const mockHandler = { handle: () => of({ data: 'test' }) };

    const result = await interceptor.intercept(context, mockHandler);
    expect(result.success).toBe(true);
  });
});
```

### 6.3 Test Coverage Targets (P1 - High)

| Component | Current | Target | Priority |
|-----------|---------|--------|----------|
| Services | ~9% | 80% | P0 |
| Guards | ~0% | 100% | P0 |
| Controllers | ~5% | 70% | P1 |
| Utils/Helpers | ~10% | 90% | P2 |
| DTOs (validation) | ~0% | 60% | P2 |

**Action Items:**
- [ ] Set up coverage reporting in CI/CD
- [ ] Configure Jest coverage thresholds
- [ ] Add coverage badges to README

### 6.4 E2E Testing Setup (P1 - High)

**Test Database Strategy:**
```typescript
// test/setup.ts
beforeAll(async () => {
  // Use test database
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

  // Run migrations
  await execSync('pnpm prisma migrate deploy');

  // Seed test data
  await seedTestData();
});

afterAll(async () => {
  // Clean up
  await prisma.$disconnect();
});
```

**E2E Test Template:**
```typescript
describe('Auth E2E', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  it('POST /auth/register should create user', () => {
    return request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: 'test@example.com', password: 'password123' })
      .expect(201)
      .expect((res) => {
        expect(res.body.data.email).toBe('test@example.com');
      });
  });
});
```

---

## 7. CI/CD Integration

### 7.1 GitHub Actions Workflow ✅ IMPLEMENTED

**Status**: 3 GitHub Actions workflows active:

1. **Development Pipeline** (`.github/workflows/dev-deploy.yml`)
   - Triggers: PRs to `develop-v*.*.*` branches
   - Jobs: Code quality, build, test, auto-format, deploy to dev
   - Services: PostgreSQL 16, Redis 7
   - Node: v22, pnpm
   - Health checks after deployment

2. **Staging Pipeline** (`.github/workflows/staging-deploy.yml`)
   - Triggers: PRs to `release-v*.*.*` branches
   - Jobs: Build, test, deploy to EC2
   - Deployment: `/home/ubuntu/storytime/staging/storytime-api`

3. **Production Pipeline** (`.github/workflows/deploy-prod.yml`)
   - Triggers: PRs to `main` branch
   - Jobs: Build, test, deploy to EC2
   - Deployment: `/home/ubuntu/storytime/production/storytime-api`

### 7.1.1 Example CI Pipeline (Reference)

**For future enhancements:**
```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [develop-v0.0.1, main]
  pull_request:
    branches: [develop-v0.0.1]

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  quality:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'pnpm'

      - run: pnpm install --frozen-lockfile
      - run: pnpm run lint
      - run: pnpm run build

  test:
    runs-on: ubuntu-latest
    needs: quality
    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_USER: test
          POSTGRES_PASSWORD: test
          POSTGRES_DB: storytime_test
        ports:
          - 5432:5432
      redis:
        image: redis:7
        ports:
          - 6379:6379

    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'pnpm'

      - run: pnpm install --frozen-lockfile
      - run: pnpm prisma migrate deploy
        env:
          DATABASE_URL: postgresql://test:test@localhost:5432/storytime_test

      - run: pnpm test:cov
        env:
          DATABASE_URL: postgresql://test:test@localhost:5432/storytime_test
          REDIS_URL: redis://localhost:6379

      - uses: codecov/codecov-action@v3
        with:
          files: ./coverage/lcov.info

  e2e:
    runs-on: ubuntu-latest
    needs: test
    # Similar setup with full E2E tests
```

### 7.2 Pre-commit Hooks (P2 - Medium)

```json
// package.json
{
  "husky": {
    "hooks": {
      "pre-commit": "lint-staged",
      "pre-push": "pnpm test"
    }
  },
  "lint-staged": {
    "*.ts": ["eslint --fix", "prettier --write"]
  }
}
```

### 7.3 Quality Gates (P1 - High)

| Gate | Threshold | Blocking |
|------|-----------|----------|
| Build | Pass | Yes |
| Lint | 0 errors | Yes |
| Unit Tests | Pass | Yes |
| Coverage | 70% | No (warn) |
| E2E Tests | Pass | Yes (main only) |
| Security Scan | 0 critical | Yes |

---

## 8. Code Review Standards

### 8.1 Review Checklist (P1 - High)

**For Every PR:**
- [ ] **Logic**: Does the code do what it's supposed to?
- [ ] **Types**: Are all types properly defined (no `any`)?
- [ ] **Tests**: Are there tests for new functionality?
- [ ] **Error Handling**: Are errors properly caught and typed?
- [ ] **Security**: Input validation, auth checks, no secrets?
- [ ] **Performance**: N+1 queries, unnecessary loops?
- [ ] **NestJS Patterns**: Guards, interceptors, DTOs used correctly?

**NestJS-Specific Checks:**
- [ ] Services use `@Injectable()` decorator
- [ ] Dependencies injected via constructor
- [ ] No circular dependencies (avoid `forwardRef`)
- [ ] Proper use of exception classes (not `throw new Error()`)
- [ ] DTOs have `class-validator` decorators
- [ ] Controllers use proper HTTP status codes

### 8.2 Review Severity Labels (P2 - Medium)

Use these labels in PR comments:

| Label | Meaning | Blocking |
|-------|---------|----------|
| 🔴 `[blocking]` | Must fix before merge | Yes |
| 🟡 `[important]` | Should fix, discuss if disagree | Discuss |
| 🟢 `[nit]` | Nice to have, not blocking | No |
| 💡 `[suggestion]` | Alternative approach | No |
| 🎉 `[praise]` | Good work! | No |

**Example:**
```markdown
🔴 [blocking] This guard doesn't validate session expiry.
The user could have a revoked session token.

🟢 [nit] Consider renaming `data` to `subscriptionData` for clarity.

🎉 [praise] Great use of the repository pattern here!
```

### 8.3 Security Review Checklist (P0 - Critical)

**Authentication & Authorization:**
- [ ] JWT validation includes signature and expiry
- [ ] Guards protect all sensitive endpoints
- [ ] Role checks before data access
- [ ] Session validation on state-changing operations

**Input Validation:**
- [ ] All user inputs validated via DTOs
- [ ] File uploads restricted (type, size)
- [ ] SQL injection prevented (Prisma handles this)
- [ ] XSS protection (sanitize output)

**Data Protection:**
- [ ] Passwords hashed with bcrypt
- [ ] Sensitive data not logged
- [ ] PII handled according to policy
- [ ] Secrets not in code or logs

### 8.4 Dependency Injection Review (P1 - High)

**Check for:**
- [ ] Circular dependencies resolved without `forwardRef`
- [ ] Request-scoped providers only where necessary
- [ ] Proper module boundaries (services exported)
- [ ] Injection tokens for interfaces

**Anti-patterns to Flag:**
```typescript
// ❌ Bad: Service locator pattern
const service = ModuleRef.get(UserService);

// ✅ Good: Constructor injection
constructor(private readonly userService: UserService) {}

// ❌ Bad: Circular dependency
@Inject(forwardRef(() => AuthService))

// ✅ Good: Event-driven decoupling
this.eventEmitter.emit('user.created', payload);
```

---

## Progress Tracking

### Completed ✅
- [x] Initial codebase analysis
- [x] Document all issues
- [x] Add testing strategy section
- [x] Add CI/CD integration section
- [x] Add code review standards
- [x] **Unit tests for core services** - 31 test files covering major services
  - AuthService (31), UserService (45), NotificationService (34), SubscriptionService (15)
  - OAuthService (21), OnboardingService (22), UserDeletionService (18), UserPinService (23)
  - StoryService, StoryGenerationService, VoiceService, KidService, PaymentService, etc.
- [x] **E2E tests for authentication flows** - 41 tests *(Instance 9)*
- [x] **Type safety improvements** - Production `any` types eliminated *(Instance 4 & 5)*
- [x] **God service refactoring** - ALL 4 PHASES COMPLETE *(Instances 6, 7, 8, 10, 11, 13, 14, 15)*
  - 19 focused services extracted from 7 god services
- [x] **CI/CD pipeline setup** - 3 GitHub Actions workflows (dev, staging, production)
- [x] **Error handling** - Generic Error throws replaced with NestJS exceptions
- [x] **Rate limiting** - Implemented on auth, payment, story, device controllers
- [x] **Event-driven architecture** - 18+ events with typed payloads

### In Progress 🔄
- [ ] Verify coverage threshold configuration in CI (need to confirm 80% gate)

### Pending 📋
- [ ] E2E tests for payment/subscription flows (P1)
- [ ] Unit tests for remaining services (BadgeService, ProgressService) - P3
- [ ] Pre-commit hooks (husky + lint-staged) - P2
- [ ] Coverage badges in README - P3

### Recently Completed (Instance 21-23) ✅
- [x] **Push Notifications (FCM)** - FcmService, DeviceTokenService *(Instance 21)*
- [x] **Server-Sent Events (SSE)** - JobEventsService, SseController *(Instance 21)*
- [x] **Device Token Management** - DeviceController, DeviceToken model *(Instance 21)*
- [x] **Cache Metrics Service** - OpenTelemetry metrics for cache operations *(Instance 22)*
- [x] **Grafana Dashboard IDs** - GRAFANA_SETUP.md with community dashboard IDs *(Instance 22)*
- [x] **Health Indicators** - Firebase, Cloudinary, enhanced Queue health *(Instance 23)*

### Recently Completed (Integration Session - 2026-02-23) ✅
- [x] **168 new unit tests** across 7 new spec files (AdminAnalytics 40, AdminSystem 32, Password 22, Token 24, EmailVerification 7, DeviceToken 18, NotificationPreference 25)
- [x] **Payment spec fixes** - Fixed DI (ConfigService, SubscriptionService, EventEmitter2), added 6 platform-aware cancellation tests, fixed getSubscription test for enhanced return shape
- [x] **Auth module alignment** - Replaced `process.env` with ConfigService, string literals with Prisma enums (Role, OnboardingStatus)
- [x] **Admin userId filter** - Added userId filter to activity logs endpoint (controller + service)

### Recently Completed ✅
- [x] **Event-Driven Architecture (EDA)** - Complete Implementation *(Instances 17, 18 - 2026-02-10)*
- [x] **Admin Domain Optimization** - Controller thinning, DTO standardization, and query optimization *(Instance 20 - 2026-02-10)*
  - Extracted Swagger decorators to dedicated files.
  - Converted all Admin response interfaces to classes with `@ApiProperty`.
  - Optimized analytics queries in `PrismaAdminAnalyticsRepository`.

---

## References

- [NestJS Testing Documentation](https://docs.nestjs.com/fundamentals/testing)
- [NestJS Exception Filters](https://docs.nestjs.com/exception-filters)
- [NestJS Dependency Injection](https://docs.nestjs.com/fundamentals/custom-providers)
- [GitHub Actions for Node.js](https://docs.github.com/en/actions/guides/building-and-testing-nodejs)
- [Jest Testing Best Practices](https://github.com/goldbergyoni/javascript-testing-best-practices)
- [SOLID Principles](https://en.wikipedia.org/wiki/SOLID)
- Project guidelines: `.claude/CLAUDE.md`

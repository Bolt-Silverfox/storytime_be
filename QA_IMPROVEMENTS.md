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

### 1.1 Missing Unit Tests (P0 - Critical)

Current coverage: **~9%** (20 spec files out of 220+ TypeScript files)

| Service | Lines | Has Tests | Priority |
|---------|-------|-----------|----------|
| `AuthService` | 694 | ❌ NO | P0 |
| `UserService` | 689 | ❌ NO | P0 |
| `NotificationService` | 737 | ❌ NO | P0 |
| `SubscriptionService` | ~300 | ❌ NO | P0 |
| `AvatarService` | 422 | ❌ NO | P1 |
| `ReportsService` | 536 | ❌ NO | P1 |
| `StoryBuddyService` | 728 | ❌ NO | P1 |

**Action Items:**
- [ ] Add unit tests for `AuthService` (login, register, password reset, OAuth flows)
- [ ] Add unit tests for `UserService` (CRUD, profile updates, PIN management)
- [ ] Add unit tests for `NotificationService` (email queue, in-app notifications)
- [ ] Add unit tests for `SubscriptionService` (plan changes, renewals, cancellations)

### 1.2 Missing E2E Tests (P1 - High)

No E2E tests found for critical business flows:

| Flow | File Needed | Priority |
|------|-------------|----------|
| Authentication (login/register) | `auth.e2e-spec.ts` | P0 |
| OAuth (Google/Apple) | `oauth.e2e-spec.ts` | P1 |
| Payment processing | `payment.e2e-spec.ts` | P0 |
| Subscription management | `subscription.e2e-spec.ts` | P1 |
| Story CRUD operations | `story.e2e-spec.ts` | P2 |
| Kid profile management | `kid.e2e-spec.ts` | P2 |

**Action Items:**
- [ ] Create E2E test suite for authentication flows
- [ ] Create E2E test suite for payment/subscription flows
- [ ] Set up test database seeding for E2E tests

### 1.3 Existing Tests Needing Review (P2)

| Test File | Issue |
|-----------|-------|
| `src/admin/tests/admin.service.spec.ts` | Review mock completeness |
| `src/story/story.service.spec.ts` | Add edge case coverage |
| `src/payment/payment.service.spec.ts` | Add failure scenario tests |

---

## 2. Code Quality Issues

### 2.1 `any` Type Usage (P1 - High)

**22 files** with `any` type usage violating type safety:

| File | Line | Current Code | Suggested Fix |
|------|------|--------------|---------------|
| `src/admin/admin.service.ts` | 2018 | `const where: any = {}` | Define `WhereClause` interface |
| `src/notification/notification.service.ts` | 69 | `data: Record<string, any>` | Define `NotificationData` interface |
| `src/notification/notification.service.ts` | 662 | `const where: any = {}` | Define `NotificationWhereClause` interface |
| `src/shared/guards/admin.guard.ts` | 14 | `(request as any).authUserData` | Use `AuthenticatedRequest` type |
| `src/shared/filters/http-exception.filter.ts` | 40 | `exceptionResponse as any` | Define `ExceptionResponseShape` interface |

**Action Items:**
- [ ] Create shared type definitions in `src/shared/types/`
- [ ] Replace all `any` with proper interfaces
- [ ] Enable `noImplicitAny` in `tsconfig.json` (after fixes)

### 2.2 Console.log Usage (P3 - Low)

| File | Line | Issue |
|------|------|-------|
| `src/story-buddy/story-buddy.seeder.ts` | 124 | `console.error('Error seeding...')` |

**Action Items:**
- [ ] Replace with `Logger.error()` from `@nestjs/common`

### 2.3 God Services - Single Responsibility Violations (P1 - High)

#### Overview

Services exceeding 400-line recommendation with detailed refactoring plans. Current state: **7 god services totaling 7,292 lines** that should be split into **27 focused services averaging ~270 lines each**.

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

#### Action Items (Phased Approach)

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

## 3. Error Handling

### 3.1 Generic Error Throws (P1 - High)

**18+ instances** of plain `Error` instead of NestJS exceptions:

| File | Line | Current | Should Be |
|------|------|---------|-----------|
| `src/user/utils/pin.util.ts` | 10 | `throw new Error('PIN must be exactly 6 digits')` | `throw new BadRequestException('PIN must be exactly 6 digits')` |
| `src/user/user.service.ts` | 415 | `throw new Error('Invalid role')` | `throw new BadRequestException('Invalid role')` |
| `src/story/gemini.service.ts` | 152 | `throw new Error(...)` | `throw new InternalServerErrorException(...)` |
| `src/story/gemini.service.ts` | 181 | `throw new Error(...)` | `throw new InternalServerErrorException(...)` |
| `src/notification/notification.service.ts` | 79 | `throw new Error('Invalid notification type')` | `throw new BadRequestException(...)` |
| `src/notification/notification.service.ts` | 84 | `throw new Error(...)` | `throw new BadRequestException(...)` |
| `src/notification/queue/email.processor.ts` | 96 | `throw new Error(...)` | `throw new InternalServerErrorException(...)` |
| `src/voice/providers/deepgram-stt.provider.ts` | various | `throw new Error(...)` | `throw new InternalServerErrorException(...)` |
| `src/voice/providers/eleven-labs-tts.provider.ts` | various | `throw new Error(...)` | `throw new InternalServerErrorException(...)` |

**Action Items:**
- [ ] Replace all `throw new Error()` with appropriate NestJS exceptions
- [ ] Add error codes for client-side handling
- [ ] Ensure all errors are caught by exception filters

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

### 5.1 Circular Dependencies (P1 - High)

**7 modules** using `forwardRef()`:

| Module | Depends On | Via |
|--------|------------|-----|
| `StoryModule` | `VoiceModule` | `forwardRef` |
| `VoiceModule` | `StoryModule` | `forwardRef` |
| `SubscriptionModule` | `PaymentModule`, `UserModule`, `AuthModule` | `forwardRef` |
| `NotificationModule` | `AuthModule` | `forwardRef` |
| `PaymentModule` | `AuthModule` | `forwardRef` |
| `AchievementProgressModule` | `AuthModule` | `forwardRef` |
| `AuthModule` | `NotificationModule` | `forwardRef` |

**Recommended Solution:**
Use event-driven architecture with `@nestjs/event-emitter`:

```typescript
// Instead of direct service calls
// this.notificationService.sendEmail(...)

// Use events
this.eventEmitter.emit('user.registered', { userId, email });

// NotificationModule listens independently
@OnEvent('user.registered')
handleUserRegistered(payload: UserRegisteredEvent) {
  await this.sendWelcomeEmail(payload.email);
}
```

**Action Items:**
- [ ] Identify shared dependencies that cause cycles
- [ ] Implement event-driven patterns for cross-module communication
- [ ] Remove all `forwardRef` usages

---

## Progress Tracking

### Completed
- [x] Initial codebase analysis
- [x] Document all issues

### In Progress
- [ ] Test coverage improvements

### Pending
- [ ] Refactor god services
- [ ] Fix error handling
- [ ] Remove circular dependencies

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

### 7.1 GitHub Actions Workflow (P0 - Critical)

**Recommended CI Pipeline:**
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

### In Progress 🔄
- [ ] Test coverage improvements
- [ ] CI/CD pipeline setup

### Pending 📋
- [ ] Refactor god services
- [ ] Fix error handling
- [ ] Remove circular dependencies
- [ ] Security audit implementation

---

## References

- [NestJS Testing Documentation](https://docs.nestjs.com/fundamentals/testing)
- [NestJS Exception Filters](https://docs.nestjs.com/exception-filters)
- [NestJS Dependency Injection](https://docs.nestjs.com/fundamentals/custom-providers)
- [GitHub Actions for Node.js](https://docs.github.com/en/actions/guides/building-and-testing-nodejs)
- [Jest Testing Best Practices](https://github.com/goldbergyoni/javascript-testing-best-practices)
- [SOLID Principles](https://en.wikipedia.org/wiki/SOLID)
- Project guidelines: `.claude/CLAUDE.md`

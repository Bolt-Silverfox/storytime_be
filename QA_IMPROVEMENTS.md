# QA Improvements Roadmap

This document tracks quality assurance issues, testing gaps, and code quality improvements needed in the Storytime backend.

> **Generated**: February 2026
> **Priority Scale**: P0 (Critical) | P1 (High) | P2 (Medium) | P3 (Low)

---

## Table of Contents

1. [Testing Gaps](#1-testing-gaps)
2. [Code Quality Issues](#2-code-quality-issues)
3. [Error Handling](#3-error-handling)
4. [Security Issues](#4-security-issues)
5. [Architecture Issues](#5-architecture-issues)

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

Services exceeding 400-line recommendation:

| Service | Lines | Suggested Split |
|---------|-------|-----------------|
| `AdminService` | **2,121** | Split into: `AdminUserService`, `AdminStoryService`, `AdminAnalyticsService`, `AdminReportsService` |
| `StoryService` | **1,772** | Split into: `StoryService`, `StoryRecommendationService`, `StoryGenerationService`, `StoryCacheService` |
| `NotificationService` | **737** | Split into: `NotificationService`, `NotificationTemplateService`, `NotificationPreferenceService` |
| `StoryBuddyService` | **728** | Split into: `StoryBuddyService`, `BuddyInteractionService`, `BuddyRecommendationService` |
| `AuthService` | **694** | Split into: `AuthService`, `OAuthService`, `SessionService`, `TokenService` |
| `UserService` | **689** | Split into: `UserService`, `UserProfileService`, `UserPreferencesService` |
| `ReportsService` | **536** | Split into: `ReportsService`, `ReportGenerationService` |
| `AvatarService` | **422** | Consider minor refactor |

**Action Items:**
- [ ] Refactor `AdminService` into domain-specific services
- [ ] Refactor `StoryService` into focused services
- [ ] Refactor `AuthService` to extract OAuth and session logic

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

## References

- [NestJS Testing Documentation](https://docs.nestjs.com/fundamentals/testing)
- [NestJS Exception Filters](https://docs.nestjs.com/exception-filters)
- [SOLID Principles](https://en.wikipedia.org/wiki/SOLID)
- Project guidelines: `.claude/CLAUDE.md`

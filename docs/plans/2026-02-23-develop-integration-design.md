# Design: Develop-v0.0.1 Integration into Refactored Branch

**Date:** 2026-02-23
**Branch:** integration/refactor-2026-02
**Source:** develop-v0.0.1 (40 commits to port)
**Timeline:** 1-2 weeks to complete, then this branch becomes the standard

---

## Context

The `develop-v0.0.1` branch is the active development branch where multiple developers add features. The `integration/refactor-2026-02` branch contains architectural improvements: extracted services, repository pattern, event-driven architecture, domain exceptions, and comprehensive testing.

We need to port new business logic from develop into our refactored structure without losing our architectural improvements.

**Approach:** Module-by-module cherry-pick (Approach A). For each module, we extract the new features/bugfixes from develop and place them into our refactored service structure.

---

## Phase 0: Schema & Migrations

### Changes to Port
1. **Subscription model** - 3 new fields:
   - `platform String?` - "google" or "apple"
   - `productId String?` - store-specific product ID
   - `purchaseToken String?` - token needed for store API calls (cancellation/status)
2. **User model** - 2 new fields:
   - `isSuspended Boolean @default(false)`
   - `suspendedAt DateTime?`
3. **DeviceToken model** - Remove redundant `@@index([token])` (already has `@unique`)

### Implementation
- Add fields to prisma/schema.prisma
- Run `prisma migrate dev` to generate clean migrations
- Do NOT cherry-pick develop's migrations (our schema baseline differs)

### Dependencies
- None. This is the foundation for all other phases.

---

## Phase 1: Payment Module

### Priority: CRITICAL
### Source Commits: `051f6bf`, `af32889`, `d33b2f0`

### New Features to Port

#### 1.1 Apple Subscription Status Check
**Source:** `apple-verification.service.ts`
**Target:** Same file (not extracted in our branch)

New interface:
```typescript
interface AppleSubscriptionStatus {
  autoRenewActive: boolean;
  expirationTime?: Date | null;
  error?: string;
}
```

New methods:
- `getSubscriptionStatus(originalTransactionId)` - Public, calls Apple StoreKit v1 API
- `fetchSubscriptionStatus(originalTransactionId, token)` - Private, HTTPS request to Apple

#### 1.2 Google Play Subscription Cancellation
**Source:** `google-verification.service.ts`
**Target:** Same file

New interfaces:
```typescript
interface GoogleCancelResult { success: boolean; error?: string; }
interface CancelParams { packageName: string; productId: string; purchaseToken: string; }
```

New method:
- `cancelSubscription(params: CancelParams)` - Calls Python script with 'cancel' action

Script change: `verify_purchase()` now called via `verify` action, new `cancel_subscription()` function added. Backward-compatible with old 3-arg format.

#### 1.3 Platform-Aware Subscription Tracking
**Source:** `payment.service.ts`
**Target:** Same file

Changes:
- `upsertSubscription()` and `upsertSubscriptionWithExpiry()` gain `platformDetails?` parameter
- `verifyGooglePurchase()` passes `{ platform: 'google', productId, purchaseToken }`
- `verifyApplePurchase()` passes `{ platform: 'apple', productId, purchaseToken: originalTxId }`
- Subscription create/update includes platform, productId, purchaseToken fields

#### 1.4 Enhanced cancelSubscription()
**Source:** `payment.service.ts`
**Target:** Same file

Logic:
1. If platform === 'google' with productId + purchaseToken: call Google Play cancel API
2. If platform === 'apple' with purchaseToken: check Apple auto-renewal status
3. If Apple auto-renewal active: return warning + manageUrl
4. Always perform local cancellation regardless of platform API results

#### 1.5 Enhanced getSubscription()
**Source:** `payment.service.ts`
**Target:** Same file

Changes:
- Fetches latest successful transaction for price/currency info
- Returns enhanced object with price, currency, platform fields

#### 1.6 Race-Condition-Safe Transaction Creation
**Source:** `payment.service.ts`
**Target:** Same file

New private method: `createTransactionAtomic()` - Handles P2002 unique constraint errors atomically.

#### 1.7 New DTO
- `subscription-status-response.dto.ts` with price, currency, platform fields

#### 1.8 ConfigService Injection
- Add `ConfigService` to PaymentService constructor
- Used for `GOOGLE_PLAY_PACKAGE_NAME`

#### 1.9 Python Script Updates
- `scripts/verify_google_purchase.py` - Extract `_get_credentials()`, add `cancel_subscription()`, update main with action routing

#### 1.10 Tests
- 6 new test cases for platform-aware cancellation in `payment.service.spec.ts`
- Mock additions: `cancelSubscription`, `getSubscriptionStatus`, `ConfigService`

---

## Phase 2: Notification Module

### Priority: HIGH
### Source Commits: `9aafff9`, `3701185`, `d33b2f0`, `5a66c7e`, `051f6bf`

### New Features to Port

#### 2.1 Device Token Deduplication
**Source:** `notification.service.ts` (monolithic)
**Target:** `services/device-token.service.ts` (our extracted service)

Logic: In `registerDeviceToken()`, wrap in `$transaction`:
- If deviceName provided, deactivate old tokens for same userId + platform + deviceName
- Then create new token

#### 2.2 Bulk Notification Preference Update
**Source:** `notification.service.ts` (monolithic)
**Target:** `services/notification-preference.service.ts` (our extracted service)

New DTO: `BulkUpdateNotificationPreferenceDto` with `id` and `enabled?` fields
New method: `bulkUpdate(userId, dtos)` - Validates ownership, performs atomic updates
New endpoint: `PATCH /notifications` on NotificationController

#### 2.3 DTO Validation Fixes
**Target:** `dto/notification.dto.ts`

- `MarkReadDto`: Add `@IsArray()` and `@IsUUID('4', { each: true })`
- `UpdateNotificationPreferenceDto`: Add `@IsOptional()` and `@IsBoolean()`

#### 2.4 Push Provider Improvements
**Target:** `providers/push.provider.ts` and `services/fcm.service.ts`

- Add APNS priority header (`apns-priority: 10`)
- Add badge count to APS payload (`badge: 1`)
- Propagate FCM error details in `NotificationResult.error`
- Enhanced logging for send operations

#### 2.5 Auth Guard Alignment
**Target:** `device-token.controller.ts`

- Remove local `AuthenticatedRequest` interface
- Import from `@/shared/guards/auth.guard`
- Change `req.user.userId` to `req.authUserData.userId` (4 occurrences)

---

## Phase 3: Auth Module

### Priority: MEDIUM
### Source Commits: `7826f69`, `4c144b3`, `051f6bf`

### New Features to Port

#### 3.1 ConfigService Integration
**Source:** `auth.service.ts` (monolithic)
**Target:** `auth.service.ts` + `services/oauth.service.ts` (our extracted services)

Replace all `process.env.X` with `this.configService.get<string>('X')` for:
- GOOGLE_CLIENT_ID, ADMIN_SECRET, APPLE_CLIENT_ID, APPLE_SERVICE_ID

#### 3.2 Prisma Enum Usage
**Target:** `auth.service.ts`, `services/oauth.service.ts`, `services/onboarding.service.ts`

Replace string literals:
- `'parent'` -> `Role.parent`, `'admin'` -> `Role.admin`
- `'account_created'` -> `OnboardingStatus.account_created`, etc.

#### 3.3 Multi-Platform Google OAuth
**Target:** `services/oauth.service.ts`

Build array of valid audiences from:
- GOOGLE_CLIENT_ID, GOOGLE_WEB_CLIENT_ID, GOOGLE_ANDROID_CLIENT_ID, GOOGLE_IOS_CLIENT_ID
- Pass array to `verifyIdToken({ audience: validAudiences })`
- Enhanced debug logging showing expected vs actual audience

#### 3.4 Apple OAuth Nonce Fix
**Target:** `services/oauth.service.ts`

- Remove hardcoded `nonce: 'NONCE'`
- Use `audience` array with both APPLE_CLIENT_ID and APPLE_SERVICE_ID

#### 3.5 RefreshTokenDto
New DTO with `@IsString() @IsNotEmpty() token: string`
Controller change: `refresh(@Body() body: RefreshTokenDto)` instead of `@Body('token')`

#### 3.6 Env Validation
**Target:** `src/shared/config/env.validation.ts`

Add optional env vars:
- GOOGLE_WEB_CLIENT_ID, GOOGLE_ANDROID_CLIENT_ID, GOOGLE_IOS_CLIENT_ID

---

## Phase 4: Admin Module

### Priority: MEDIUM
### Source Commits: `dced9a8`, `d33b2f0`, `d679abd`, `3ef7ba8`, `a6530e8`, `3243cde`, `f95ba8b`, `bfc3b41`

### New Features to Port

#### 4.1 User Suspension
**Source:** `admin.service.ts` (monolithic)
**Target:** `admin-user.service.ts` (our extracted service)

New methods:
- `suspendUser(userId)` - Validates not admin, not already suspended
- `unsuspendUser(userId)` - Validates currently suspended
New endpoints: `PATCH /admin/users/:userId/suspend` and `/unsuspend`

#### 4.2 Export Endpoints
**Source:** `admin.service.ts` + `admin.controller.ts`
**Target:** `admin-analytics.service.ts` (analytics export) + `admin-user.service.ts` (user export)

New DTO: `ExportAnalyticsDto` (type, format, startDate, endDate)
New methods:
- `exportAnalyticsData(type, format, startDate, endDate)` -> AdminAnalyticsService
- `exportUsersAsCsv(filters)` -> AdminUserService
New endpoints: `GET /admin/dashboard/export`, `GET /admin/users/export`
Includes CSV injection prevention.

#### 4.3 Analytics Duration Parameters
**Target:** `admin-analytics.service.ts`

Enhanced methods:
- `getAiCreditAnalytics(duration)` - Supports daily/weekly/monthly/quarterly/yearly
- `getUserGrowthMonthly(duration)` - Supports last_year/last_month/last_week
Controller adds `@Query('duration')` parameter with validation.

#### 4.4 Additional Filters
**Target:** `admin-story.service.ts`, `admin.controller.ts`

- `categoryId` filter for stories endpoint
- `userId` filter for activity logs endpoint
- `isAiGenerated` alias for backward compatibility

---

## Phase 5: Story Module

### Priority: LOW-MEDIUM
### Source Commits: `a9f71ef`, `ca2246b`, `b0fe414`

### New Features to Port

#### 5.1 TTS Text Preprocessing
**Target:** `text-to-speech.service.ts`

New function: `preprocessTextForTTS(text)`:
- Removes double-quote variants (Unicode + ASCII)
- Removes single-quote variants at word boundaries (preserves contractions)
- Collapses whitespace
Applied in `generateAudio()` before passing text to providers.

#### 5.2 Story Query Filters
**Target:** `story.controller.ts`, `story.service.ts`

New query parameters: `isMostLiked`, `isSeasonal` (string -> boolean conversion)
Pass to service for filtering.

---

## Phase 6: Shared/Config Cleanup

### Priority: LOW
### Changes

#### 6.1 Auth Guard Alignment
Audit all controllers for local `AuthenticatedRequest` interfaces. Replace with import from `@/shared/guards/auth.guard`. Ensure consistent use of `req.authUserData`.

#### 6.2 Env Validation
Already covered in Phase 3 (Google platform client IDs).

---

## Risk Mitigation

1. **After each phase:** Run `pnpm build` to catch compile errors
2. **After each phase:** Run relevant tests `pnpm test -- --testPathPattern=<module>`
3. **Schema changes first:** All subsequent phases depend on correct schema
4. **Commit per phase:** Each module gets its own commit for easy rollback
5. **Auth guard alignment:** Do a project-wide audit after all modules are ported

---

## Success Criteria

- All new features from develop-v0.0.1 are present in the integration branch
- All features are placed in the correct extracted services (not monolithic)
- `pnpm build` succeeds
- Existing tests pass
- New tests from develop are ported and pass
- No regression in refactored architecture (repositories, events, exceptions intact)

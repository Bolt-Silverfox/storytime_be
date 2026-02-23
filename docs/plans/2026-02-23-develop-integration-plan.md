# Develop-v0.0.1 Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Port all new features and bugfixes from develop-v0.0.1 into the refactored integration branch, placing code into the correct extracted services.

**Architecture:** Module-by-module cherry-pick. Each phase targets one module, extracts new business logic from develop's monolithic services, and places it into our refactored structure (extracted services, repositories, proper separation of concerns).

**Tech Stack:** NestJS, Prisma ORM, TypeScript, Jest, BullMQ

**Source branch:** develop-v0.0.1 (40 commits)
**Target branch:** integration/refactor-2026-02

---

## Task 1: Schema & Migrations

**Files:**
- Modify: `prisma/schema.prisma:473-489` (Subscription model)
- Modify: `prisma/schema.prisma:72-126` (User model)
- Modify: `prisma/schema.prisma:1124-1125` (DeviceToken indexes)

**Step 1: Add platform fields to Subscription model**

In `prisma/schema.prisma`, update the Subscription model (line 473) to add platform tracking fields before the soft delete section:

```prisma
model Subscription {
  id            String    @id @default(uuid())
  userId        String    @unique
  user          User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  plan          String
  status        String    @default("active")
  startedAt     DateTime  @default(now())
  endsAt        DateTime?
  // Store platform-specific data for subscription management
  platform      String?   // "google" or "apple"
  productId     String?   // e.g. "com.storytime.monthly"
  purchaseToken String?   // token from the platform for cancellation/status
  // SOFT DELETE FIELDS
  isDeleted     Boolean   @default(false)
  deletedAt     DateTime?

  @@index([userId, status])
  @@index([status, isDeleted])
  @@index([isDeleted])
  @@map("subscriptions")
}
```

**Step 2: Add suspension fields to User model**

In `prisma/schema.prisma`, add after `biometricsEnabled` (line 86):

```prisma
  biometricsEnabled       Boolean                  @default(false)
  // SUSPENSION FIELDS
  isSuspended             Boolean                  @default(false)
  suspendedAt             DateTime?
```

**Step 3: Remove redundant DeviceToken index**

In `prisma/schema.prisma`, remove line 1125 (`@@index([token])`) since `token` already has `@unique` which creates an implicit index.

**Step 4: Generate migration**

Run: `npx prisma migrate dev --name add_subscription_platform_and_user_suspension`

Expected: Migration created successfully, Prisma client regenerated.

**Step 5: Verify build**

Run: `pnpm build`
Expected: Build succeeds with new Prisma types available.

**Step 6: Commit**

```bash
git add prisma/
git commit -m "feat(schema): add subscription platform tracking and user suspension fields"
```

---

## Task 2: Payment Module - Verification Services

**Files:**
- Modify: `src/payment/google-verification.service.ts`
- Modify: `src/payment/apple-verification.service.ts`
- Modify: `scripts/verify_google_purchase.py`

**Step 1: Add cancellation interfaces and method to GoogleVerificationService**

At the top of `src/payment/google-verification.service.ts`, add interfaces:

```typescript
/** Result from Google subscription cancellation */
export interface GoogleCancelResult {
  success: boolean;
  error?: string;
}

/** Parameters for cancellation */
export interface CancelParams {
  packageName: string;
  productId: string;
  purchaseToken: string;
}
```

Add method to the class:

```typescript
async cancelSubscription(params: CancelParams): Promise<GoogleCancelResult> {
  const packageName = (params?.packageName ?? '').trim();
  const productId = (params?.productId ?? '').trim();
  const purchaseToken = (params?.purchaseToken ?? '').trim();

  if (!packageName || !productId || !purchaseToken) {
    return {
      success: false,
      error: 'packageName, productId, and purchaseToken are required',
    };
  }

  this.logger.log(
    `Cancelling Google subscription for package ${this.sanitizeForLog(packageName)} product ${this.sanitizeForLog(productId)}`,
  );

  try {
    const { stdout, stderr } = await execFileAsync(
      this.pythonPath,
      [this.scriptPath, 'cancel', packageName, productId, purchaseToken],
      { timeout: 10000, encoding: 'utf8' },
    );

    if (stderr) {
      this.logger.warn(`Python cancel script stderr received (len=${stderr.length})`);
    }

    const result = JSON.parse(stdout.trim()) as GoogleCancelResult;
    return result;
  } catch (error) {
    this.logger.error(`Google cancel failed: ${this.errorMessage(error)}`);
    return { success: false, error: this.errorMessage(error) };
  }
}
```

Also update the existing `verify()` method's script invocation to include the `'verify'` action argument:
```typescript
// Change from: [this.scriptPath, packageName, productId, purchaseToken]
// Change to:
[this.scriptPath, 'verify', packageName, productId, purchaseToken]
```

**Step 2: Add subscription status check to AppleVerificationService**

Add interface at top of `src/payment/apple-verification.service.ts`:

```typescript
/** Result from Apple subscription status check */
export interface AppleSubscriptionStatus {
  autoRenewActive: boolean;
  expirationTime?: Date | null;
  error?: string;
}
```

Add public method:

```typescript
async getSubscriptionStatus(
  originalTransactionId: string,
): Promise<AppleSubscriptionStatus> {
  if (!this.keyId || !this.issuerId || !this.bundleId || !this.privateKey) {
    return { autoRenewActive: false, error: 'Apple credentials not configured' };
  }

  this.logger.log(
    `Checking Apple subscription status for ${this.sanitizeForLog(originalTransactionId)}`,
  );

  try {
    const token = this.generateJWT();
    const statusData = await this.fetchSubscriptionStatus(originalTransactionId, token);

    if (!statusData) {
      return { autoRenewActive: false, error: 'Subscription not found' };
    }

    return statusData;
  } catch (error) {
    this.logger.error(
      `Apple subscription status check failed: ${this.errorMessage(error)}`,
    );
    return { autoRenewActive: false, error: this.errorMessage(error) };
  }
}
```

Add private method `fetchSubscriptionStatus()` that calls Apple StoreKit v1 API at `/inApps/v1/subscriptions/{originalTransactionId}`. Reference the develop branch implementation for the full HTTPS request logic including JWS token decoding.

**Step 3: Update Python script**

In `scripts/verify_google_purchase.py`:
- Extract `_get_credentials()` helper function from `verify_purchase()`
- Add `cancel_subscription(package_name, product_id, purchase_token)` function
- Update main block to route `verify` and `cancel` actions, with backward compatibility for old 3-arg format

**Step 4: Verify build**

Run: `pnpm build`
Expected: Build succeeds.

**Step 5: Commit**

```bash
git add src/payment/google-verification.service.ts src/payment/apple-verification.service.ts scripts/verify_google_purchase.py
git commit -m "feat(payment): add Google cancellation and Apple subscription status check"
```

---

## Task 3: Payment Module - PaymentService Enhancements

**Files:**
- Modify: `src/payment/payment.service.ts`
- Create: `src/payment/dto/subscription-status-response.dto.ts`
- Modify: `src/payment/payment.controller.ts`
- Modify: `src/payment/payment.service.spec.ts`

**Step 1: Add ConfigService to PaymentService constructor**

In `src/payment/payment.service.ts`, add import and constructor parameter:

```typescript
import { ConfigService } from '@nestjs/config';

// In constructor (line 40):
constructor(
  private readonly prisma: PrismaService,
  private readonly subscriptionService: SubscriptionService,
  private readonly googleVerificationService: GoogleVerificationService,
  private readonly appleVerificationService: AppleVerificationService,
  private readonly eventEmitter: EventEmitter2,
  private readonly configService: ConfigService,  // ADD
) {}
```

**Step 2: Add platform tracking to subscription upsert methods**

Add `platformDetails?` parameter to `upsertSubscription()` and `upsertSubscriptionWithExpiry()`:

```typescript
private upsertSubscription(
  userId: string,
  plan: string,
  transaction: TransactionRecord,
  platformDetails?: { platform: string; productId: string; purchaseToken: string },
)
```

Include platform fields in the Prisma create/update data:

```typescript
const data = {
  plan,
  status: 'active',
  startedAt: now,
  endsAt,
  platform: platformDetails?.platform ?? null,
  productId: platformDetails?.productId ?? null,
  purchaseToken: platformDetails?.purchaseToken ?? null,
};
```

**Step 3: Pass platform details from verify methods**

In `verifyGooglePurchase()`:
```typescript
const googleDetails = {
  platform: 'google',
  productId: dto.productId,
  purchaseToken: dto.purchaseToken,
};
// Pass to upsertSubscription/upsertSubscriptionWithExpiry calls
```

In `verifyApplePurchase()`:
```typescript
const appleDetails = {
  platform: 'apple',
  productId: dto.productId,
  purchaseToken: result.originalTxId ?? dto.purchaseToken,
};
```

**Step 4: Enhance cancelSubscription() with platform-aware logic**

Replace the `cancelSubscription()` method to:
1. Check `existing.platform` and call Google Play cancel API if google
2. Check Apple auto-renewal status if apple
3. Return warning + manageUrl if Apple auto-renewal is still active
4. Always perform local cancellation regardless of platform API results

Reference the develop branch implementation for exact logic flow.

**Step 5: Enhance getSubscription() with price/currency**

Update to fetch latest successful transaction and include price, currency, platform in return object.

**Step 6: Create SubscriptionStatusResponseDto**

Create `src/payment/dto/subscription-status-response.dto.ts`:

```typescript
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SubscriptionStatusResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() plan: string;
  @ApiProperty() status: string;
  @ApiProperty() startedAt: Date;
  @ApiPropertyOptional() endsAt: Date | null;
  @ApiPropertyOptional() platform: string | null;
  @ApiProperty({ description: 'Amount paid', example: 4.99 }) price: number;
  @ApiProperty({ description: 'Currency code', example: 'USD' }) currency: string;
}
```

**Step 7: Update PaymentController**

Add `@ApiOkResponse({ type: SubscriptionStatusResponseDto })` to the `GET /payment/status` endpoint.

**Step 8: Update tests**

In `src/payment/payment.service.spec.ts`:
- Add `ConfigService` mock to providers
- Add `cancelSubscription` mock to GoogleVerificationService
- Add `getSubscriptionStatus` mock to AppleVerificationService
- Add 6 new test cases for platform-aware cancellation (Google cancel, Apple warning, fallback behavior)

**Step 9: Run tests**

Run: `pnpm test -- --testPathPattern=payment`
Expected: All tests pass.

**Step 10: Commit**

```bash
git add src/payment/ scripts/
git commit -m "feat(payment): add platform-aware subscription management with store API integration"
```

---

## Task 4: Notification Module - Device Token Dedup & Validation

**Files:**
- Modify: `src/notification/services/device-token.service.ts`
- Modify: `src/notification/device-token.controller.ts`
- Modify: `src/notification/dto/notification.dto.ts` (or equivalent DTO file)

**Step 1: Add device token deduplication**

In `src/notification/services/device-token.service.ts`, update `registerDeviceToken()` to wrap operations in a transaction and deactivate old tokens:

```typescript
async registerDeviceToken(
  userId: string,
  dto: RegisterDeviceDto & { deviceName?: string },
): Promise<DeviceTokenResponse> {
  const { token, platform, deviceName } = dto;

  // Check if token already exists
  const existingToken = await this.prisma.deviceToken.findUnique({
    where: { token },
  });

  if (existingToken) {
    if (existingToken.userId === userId) {
      const updated = await this.prisma.deviceToken.update({
        where: { token },
        data: { isActive: true, platform, lastUsed: new Date(), deviceName },
      });
      this.logger.log(`Reactivated device token for user ${userId} (${platform})`);
      return this.toResponse(updated);
    }

    const reassigned = await this.prisma.deviceToken.update({
      where: { token },
      data: { userId, platform, isActive: true, lastUsed: new Date(), deviceName },
    });
    this.logger.log(`Reassigned device token to user ${userId} (${platform})`);
    return this.toResponse(reassigned);
  }

  // Create new token with deduplication in a transaction
  const created = await this.prisma.$transaction(async (tx) => {
    // Deactivate old tokens for same device/platform
    if (deviceName) {
      await tx.deviceToken.updateMany({
        where: {
          userId,
          platform,
          deviceName,
          isDeleted: false,
          token: { not: token },
        },
        data: { isActive: false, isDeleted: true, deletedAt: new Date() },
      });
    }
    return tx.deviceToken.create({
      data: { userId, token, platform, isActive: true, deviceName },
    });
  });

  this.logger.log(`Registered new device token for user ${userId} (${platform})`);
  return this.toResponse(created);
}
```

**Step 2: Fix auth guard alignment in device-token.controller.ts**

In `src/notification/device-token.controller.ts`:
- Remove the local `AuthenticatedRequest` interface (around line 29)
- Import from shared guard: `import { AuthSessionGuard, AuthenticatedRequest } from '@/shared/guards/auth.guard';`
- Change all `req.user.userId` to `req.authUserData.userId` (4 occurrences)

**Step 3: Add DTO validation decorators**

In the notification DTOs file, add validators:

```typescript
// MarkReadDto
export class MarkReadDto {
  @IsArray()
  @IsUUID('4', { each: true })
  notificationIds: string[];
}

// UpdateNotificationPreferenceDto
export class UpdateNotificationPreferenceDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
```

**Step 4: Verify build**

Run: `pnpm build`
Expected: Build succeeds.

**Step 5: Commit**

```bash
git add src/notification/
git commit -m "feat(notification): add device token dedup, fix auth guard, add DTO validation"
```

---

## Task 5: Notification Module - Bulk Preferences & Push Improvements

**Files:**
- Modify: `src/notification/services/notification-preference.service.ts`
- Modify: `src/notification/notification.controller.ts`
- Modify: `src/notification/providers/push.provider.ts` (or `services/fcm.service.ts`)

**Step 1: Add BulkUpdateNotificationPreferenceDto**

In the notification DTOs file:

```typescript
export class BulkUpdateNotificationPreferenceDto {
  @ApiProperty()
  @IsUUID()
  id: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
```

**Step 2: Add bulkUpdate method to NotificationPreferenceService**

In `src/notification/services/notification-preference.service.ts`:

```typescript
async bulkUpdate(
  userId: string,
  dtos: BulkUpdateNotificationPreferenceDto[],
): Promise<NotificationPreference[]> {
  // Verify all preferences belong to the user
  const prefIds = dtos.map((d) => d.id);
  const existing = await this.prisma.notificationPreference.findMany({
    where: { id: { in: prefIds }, userId },
  });

  if (existing.length !== prefIds.length) {
    throw new NotFoundException('One or more notification preferences not found');
  }

  // Perform atomic update
  const updates = dtos.map((dto) =>
    this.prisma.notificationPreference.update({
      where: { id: dto.id },
      data: { enabled: dto.enabled },
    }),
  );

  return this.prisma.$transaction(updates);
}
```

**Step 3: Add bulk update endpoint to NotificationController**

```typescript
@Patch()
@UseGuards(AuthSessionGuard)
@ApiBearerAuth()
@ApiOperation({ summary: 'Bulk update notification preferences' })
async bulkUpdate(
  @Req() req: AuthenticatedRequest,
  @Body() dtos: BulkUpdateNotificationPreferenceDto[],
) {
  return this.notificationPreferenceService.bulkUpdate(
    req.authUserData.userId,
    dtos,
  );
}
```

**Step 4: Improve push provider**

In the FCM/push service:
- Add `apns-priority: '10'` header for iOS notifications
- Add `badge: 1` to APNS payload
- Propagate FCM error details in notification result
- Add enhanced logging for send operations

**Step 5: Verify build and test**

Run: `pnpm build && pnpm test -- --testPathPattern=notification`
Expected: Build and tests pass.

**Step 6: Commit**

```bash
git add src/notification/
git commit -m "feat(notification): add bulk preference update and push provider improvements"
```

---

## Task 6: Auth Module - ConfigService, Enums, Multi-Platform OAuth

**Files:**
- Modify: `src/auth/auth.service.ts`
- Modify: `src/auth/services/oauth.service.ts`
- Modify: `src/auth/auth.controller.ts`
- Modify: `src/auth/dto/auth.dto.ts`
- Modify: `src/shared/config/env.validation.ts`

**Step 1: Add env vars for multi-platform Google OAuth**

In `src/shared/config/env.validation.ts`, add:

```typescript
GOOGLE_WEB_CLIENT_ID: z.string().optional(),
GOOGLE_ANDROID_CLIENT_ID: z.string().optional(),
GOOGLE_IOS_CLIENT_ID: z.string().optional(),
```

**Step 2: Replace process.env with ConfigService in auth services**

In `src/auth/auth.service.ts` and `src/auth/services/oauth.service.ts`:
- Add `ConfigService` to constructor if not already present
- Replace all `process.env.GOOGLE_CLIENT_ID` with `this.configService.get<string>('GOOGLE_CLIENT_ID')`
- Same for ADMIN_SECRET, APPLE_CLIENT_ID, APPLE_SERVICE_ID

**Step 3: Use Prisma enums instead of string literals**

In auth service files, replace:
- `'parent'` -> `Role.parent`
- `'admin'` -> `Role.admin`
- `'account_created'` -> `OnboardingStatus.account_created`
- `'email_verified'` -> `OnboardingStatus.email_verified`
- `'pin_setup'` -> `OnboardingStatus.pin_setup`
- `'profile_setup'` -> `OnboardingStatus.profile_setup`

Add import: `import { Role, OnboardingStatus } from '@prisma/client';`

**Step 4: Multi-platform Google OAuth in OAuthService**

Update `verifyIdToken()` (or equivalent Google verification method):

```typescript
const validAudiences = [
  this.configService.get<string>('GOOGLE_CLIENT_ID'),
  this.configService.get<string>('GOOGLE_WEB_CLIENT_ID'),
  this.configService.get<string>('GOOGLE_ANDROID_CLIENT_ID'),
  this.configService.get<string>('GOOGLE_IOS_CLIENT_ID'),
].filter((id): id is string => Boolean(id));

ticket = await this.googleClient.verifyIdToken({
  idToken,
  audience: validAudiences,
});
```

**Step 5: Apple OAuth nonce fix**

In the Apple OAuth verification, remove hardcoded `nonce: 'NONCE'` and use `audience` array with both APPLE_CLIENT_ID and APPLE_SERVICE_ID.

**Step 6: Add RefreshTokenDto**

In `src/auth/dto/auth.dto.ts`:

```typescript
export class RefreshTokenDto {
  @ApiProperty({ description: 'Refresh token', example: 'eyJhbGci...' })
  @IsString()
  @IsNotEmpty()
  token: string;
}
```

Update controller: `async refresh(@Body() body: RefreshTokenDto)` with `@ApiBody({ type: RefreshTokenDto })`.

**Step 7: Verify build and test**

Run: `pnpm build && pnpm test -- --testPathPattern=auth`
Expected: Build and tests pass.

**Step 8: Commit**

```bash
git add src/auth/ src/shared/config/env.validation.ts
git commit -m "feat(auth): add ConfigService, Prisma enums, multi-platform OAuth, RefreshTokenDto"
```

---

## Task 7: Admin Module - User Suspension

**Files:**
- Modify: `src/admin/admin-user.service.ts`
- Modify: `src/admin/admin.controller.ts`

**Step 1: Add suspension methods to AdminUserService**

In `src/admin/admin-user.service.ts`:

```typescript
async suspendUser(userId: string) {
  const user = await this.prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new NotFoundException(`User ${userId} not found`);
  if (user.role === 'admin') throw new BadRequestException('Cannot suspend admin users');
  if (user.isSuspended) throw new BadRequestException('User is already suspended');

  return this.prisma.user.update({
    where: { id: userId },
    data: { isSuspended: true, suspendedAt: new Date() },
  });
}

async unsuspendUser(userId: string) {
  const user = await this.prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new NotFoundException(`User ${userId} not found`);
  if (!user.isSuspended) throw new BadRequestException('User is not suspended');

  return this.prisma.user.update({
    where: { id: userId },
    data: { isSuspended: false, suspendedAt: null },
  });
}
```

**Step 2: Add endpoints to AdminController**

```typescript
@Patch('users/:userId/suspend')
@ApiBearerAuth()
@ApiOperation({ summary: 'Suspend a user' })
async suspendUser(@Param('userId') userId: string) {
  return this.adminUserService.suspendUser(userId);
}

@Patch('users/:userId/unsuspend')
@ApiBearerAuth()
@ApiOperation({ summary: 'Unsuspend a user' })
async unsuspendUser(@Param('userId') userId: string) {
  return this.adminUserService.unsuspendUser(userId);
}
```

**Step 3: Verify build**

Run: `pnpm build`
Expected: Build succeeds.

**Step 4: Commit**

```bash
git add src/admin/
git commit -m "feat(admin): add user suspension and unsuspension endpoints"
```

---

## Task 8: Admin Module - Export Endpoints & Analytics Enhancements

**Files:**
- Create: `src/admin/dto/admin-export.dto.ts`
- Modify: `src/admin/admin-analytics.service.ts`
- Modify: `src/admin/admin-user.service.ts`
- Modify: `src/admin/admin-story.service.ts`
- Modify: `src/admin/admin.controller.ts`
- Modify: `src/admin/dto/admin-filters.dto.ts`

**Step 1: Create ExportAnalyticsDto**

Create `src/admin/dto/admin-export.dto.ts`:

```typescript
import { IsEnum, IsOptional, IsDateString } from 'class-validator';

export class ExportAnalyticsDto {
  @IsEnum(['users', 'revenue', 'subscriptions'])
  type: 'users' | 'revenue' | 'subscriptions';

  @IsOptional()
  @IsEnum(['csv', 'json'])
  format?: 'csv' | 'json' = 'csv';

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;
}
```

**Step 2: Add analytics duration support**

In `src/admin/admin-analytics.service.ts`, update `getAiCreditAnalytics()` to accept a `duration` parameter supporting: daily, weekly, monthly, quarterly, yearly.

Update `getUserGrowthMonthly()` to accept a `duration` parameter supporting: last_year, last_month, last_week.

Add `exportAnalyticsData()` method for CSV/JSON export.

**Step 3: Add user export to AdminUserService**

In `src/admin/admin-user.service.ts`, add `exportUsersAsCsv(filters)`:
- Paginates through users in chunks of 1000
- Generates CSV with headers: ID, Email, Name, Role, etc.
- Includes CSV injection prevention (prefix with `\t` for formula characters)

**Step 4: Add categoryId filter to AdminStoryService**

In story filter DTO, add: `@IsOptional() categoryId?: string;`

In the story query, add: `where.categories = { some: { id: categoryId } }` when categoryId is provided.

**Step 5: Add userId filter to activity logs**

In the admin controller's activity logs endpoint, add `@Query('userId') userId?: string` parameter.

**Step 6: Add new endpoints to AdminController**

- `GET /dashboard/export` - Analytics export
- `GET /users/export` - User export as CSV
- Duration params on analytics endpoints
- categoryId param on stories endpoint

**Step 7: Verify build and test**

Run: `pnpm build && pnpm test -- --testPathPattern=admin`
Expected: Build and tests pass.

**Step 8: Commit**

```bash
git add src/admin/
git commit -m "feat(admin): add export endpoints, analytics duration filters, and story categoryId filter"
```

---

## Task 9: Story Module - TTS Preprocessing & Query Filters

**Files:**
- Modify: `src/story/text-to-speech.service.ts`
- Modify: `src/story/story.controller.ts`
- Modify: `src/story/story.service.ts`

**Step 1: Add TTS text preprocessing**

In `src/story/text-to-speech.service.ts`, add the function before the class:

```typescript
/**
 * Normalize text for TTS providers by stripping literal quote characters
 * and collapsing whitespace. Without this, engines may read "quote" aloud.
 * Preserves contractions (don't, it's) and prosody-affecting punctuation.
 */
function preprocessTextForTTS(text: string): string {
  return (
    text
      .replace(/[\u201C\u201D\u201E\u201F"]/g, '')
      .replace(
        /(?<!\w)[\u2018\u2019\u201A\u201B']|[\u2018\u2019\u201A\u201B'](?!\w)/g,
        '',
      )
      .replace(/\s+/g, ' ')
      .trim()
  );
}
```

In `generateAudio()`, apply before passing to providers:

```typescript
const cleanedText = preprocessTextForTTS(text);
// Pass cleanedText to ElevenLabs/Deepgram instead of raw text
```

**Step 2: Add story query filters**

In `src/story/story.controller.ts`, add query parameters for `isMostLiked` and `isSeasonal` if not already present. Convert string to boolean and pass to service.

In `src/story/story.service.ts`, handle the new filter parameters in the query `where` clause.

**Step 3: Verify build**

Run: `pnpm build`
Expected: Build succeeds.

**Step 4: Commit**

```bash
git add src/story/
git commit -m "feat(story): add TTS text preprocessing and isMostLiked/isSeasonal filters"
```

---

## Task 10: Shared - Auth Guard Alignment Audit

**Files:**
- Modify: `src/shared/guards/admin.guard.ts`
- Audit: All controllers for local AuthenticatedRequest definitions

**Step 1: Remove local AuthenticatedRequest from admin guard**

In `src/shared/guards/admin.guard.ts`, remove the local interface and import from auth guard:

```typescript
import { AuthenticatedRequest } from './auth.guard';
```

**Step 2: Audit all controllers**

Search for any remaining `interface AuthenticatedRequest` definitions or `req.user.userId` usage. Replace with import from `@/shared/guards/auth.guard` and `req.authUserData.userId`.

**Step 3: Verify build**

Run: `pnpm build`
Expected: Build succeeds.

**Step 4: Run full test suite**

Run: `pnpm test`
Expected: All tests pass.

**Step 5: Commit**

```bash
git add src/
git commit -m "refactor: align all controllers to shared AuthenticatedRequest interface"
```

---

## Task 11: Final Verification

**Step 1: Full build**

Run: `pnpm build`
Expected: Clean build with no errors.

**Step 2: Full test suite**

Run: `pnpm test`
Expected: All tests pass.

**Step 3: Verify no missing features**

Run: `git diff integration/refactor-2026-02...develop-v0.0.1 --stat` and verify all significant changes have been ported.

**Step 4: Push**

```bash
git push origin integration/refactor-2026-02
```

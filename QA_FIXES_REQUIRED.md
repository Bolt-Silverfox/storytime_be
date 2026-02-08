# QA Fixes Required - Payment/Subscription Refactoring

This document contains actionable fixes identified during QA review. Address these issues in order of priority.

---

## Critical Issues

### 1. Fix SubscriptionService to Use Injected PrismaService

**File:** `src/subscription/subscription.service.ts`

**Problem:** The service creates a raw `PrismaClient` instance instead of using dependency injection.

**Current Code (line 6):**
```typescript
const prisma = new PrismaClient();
```

**Required Fix:**
1. Remove the direct `PrismaClient` instantiation
2. Add constructor with `PrismaService` injection
3. Replace all `prisma.` calls with `this.prisma.`

**Expected Result:**
```typescript
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SUBSCRIPTION_STATUS } from './subscription.constants';
import { PAYMENT_CONSTANTS } from '../payment/payment.constants';

export const PLANS = PAYMENT_CONSTANTS.PLANS;

@Injectable()
export class SubscriptionService {
  constructor(private readonly prisma: PrismaService) {}

  // ... rest of methods using this.prisma instead of prisma
}
```

**Also update:** `src/subscription/subscription.module.ts` to import `PrismaModule`:
```typescript
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule, forwardRef(() => UserModule), forwardRef(() => AuthModule)],
  // ...
})
```

---

## High Priority Issues

### 2. Generate Prisma Migration for PaymentMethod Removal

**Problem:** The `PaymentMethod` model was removed from `prisma/schema.prisma` but no migration exists.

**Action Required:**
```bash
npx prisma migrate dev --name remove_payment_method
```

**Verify:** The migration should drop the `payment_methods` table and remove the `paymentMethodId` column from `payment_transactions`.

---

### 3. Remove Duplicate Cancel Endpoint from PaymentController

**Problem:** Both controllers have cancel endpoints that do the same thing:
- `POST /payment/cancel` in `PaymentController`
- `POST /subscription/cancel` in `SubscriptionController`

**File to modify:** `src/payment/payment.controller.ts`

**Action:** Remove the `cancel` method from `PaymentController`. The subscription cancel endpoint is the canonical one.

**Remove this code:**
```typescript
@Post('cancel')
@UseGuards(AuthSessionGuard)
@Throttle({
  default: {
    limit: THROTTLE_LIMITS.PAYMENT.CANCEL.LIMIT,
    ttl: THROTTLE_LIMITS.PAYMENT.CANCEL.TTL,
  },
})
@ApiBearerAuth()
@ApiOperation({ summary: 'Cancel subscription (keeps access until endsAt)' })
async cancel(@Req() req: any) {
  return this.paymentService.cancelSubscription(req.authUserData.userId);
}
```

**Also remove** the `cancelSubscription` method from `src/payment/payment.service.ts` and its test from `src/payment/payment.service.spec.ts`.

---

## Medium Priority Issues

### 4. Add SubscriptionService Unit Tests

**File to create:** `src/subscription/subscription.service.spec.ts`

**Test cases to cover:**

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SubscriptionService } from './subscription.service';
import { PrismaService } from '../prisma/prisma.service';
import { SUBSCRIPTION_STATUS } from './subscription.constants';

describe('SubscriptionService', () => {
  let service: SubscriptionService;
  let mockPrisma: any;

  beforeEach(async () => {
    mockPrisma = {
      subscription: {
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      paymentTransaction: {
        findMany: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<SubscriptionService>(SubscriptionService);
  });

  describe('getPlans', () => {
    it('should return all available plans', () => {
      const plans = service.getPlans();
      expect(plans).toHaveProperty('free');
      expect(plans).toHaveProperty('monthly');
      expect(plans).toHaveProperty('yearly');
    });
  });

  describe('subscribe', () => {
    it('should allow subscription to free plan', async () => {
      mockPrisma.subscription.findFirst.mockResolvedValue(null);
      mockPrisma.subscription.create.mockResolvedValue({ id: 'sub-1', plan: 'free' });

      const result = await service.subscribe('user-1', 'free');

      expect(result.subscription.plan).toBe('free');
      expect(mockPrisma.subscription.create).toHaveBeenCalled();
    });

    it('should reject paid plans with BadRequestException', async () => {
      await expect(service.subscribe('user-1', 'monthly'))
        .rejects.toThrow(BadRequestException);
      await expect(service.subscribe('user-1', 'yearly'))
        .rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for invalid plan', async () => {
      await expect(service.subscribe('user-1', 'invalid-plan'))
        .rejects.toThrow(BadRequestException);
    });

    it('should update existing subscription instead of creating new', async () => {
      mockPrisma.subscription.findFirst.mockResolvedValue({ id: 'existing-sub' });
      mockPrisma.subscription.update.mockResolvedValue({ id: 'existing-sub', plan: 'free' });

      await service.subscribe('user-1', 'free');

      expect(mockPrisma.subscription.update).toHaveBeenCalled();
      expect(mockPrisma.subscription.create).not.toHaveBeenCalled();
    });
  });

  describe('cancel', () => {
    it('should throw NotFoundException if no subscription exists', async () => {
      mockPrisma.subscription.findFirst.mockResolvedValue(null);

      await expect(service.cancel('user-1')).rejects.toThrow(NotFoundException);
    });

    it('should preserve future endsAt when cancelling', async () => {
      const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      mockPrisma.subscription.findFirst.mockResolvedValue({ id: 'sub-1', endsAt: futureDate });
      mockPrisma.subscription.update.mockResolvedValue({ status: 'cancelled', endsAt: futureDate });

      const result = await service.cancel('user-1');

      expect(mockPrisma.subscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: SUBSCRIPTION_STATUS.CANCELLED,
            endsAt: futureDate,
          }),
        }),
      );
    });
  });

  describe('listHistory', () => {
    it('should return payment transactions for user', async () => {
      const mockTransactions = [{ id: 'tx-1' }, { id: 'tx-2' }];
      mockPrisma.paymentTransaction.findMany.mockResolvedValue(mockTransactions);

      const result = await service.listHistory('user-1');

      expect(result).toEqual(mockTransactions);
      expect(mockPrisma.paymentTransaction.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        orderBy: { createdAt: 'desc' },
      });
    });
  });
});
```

---

### 5. Use Stronger Receipt Hashing

**File:** `src/payment/payment.service.ts`

**Problem:** The current `hashReceipt` method uses a weak hash that could have collisions.

**Current Code (lines 99-108):**
```typescript
private hashReceipt(receipt: string): string {
  let hash = 0;
  for (let i = 0; i < receipt.length; i++) {
    const char = receipt.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16);
}
```

**Replace with:**
```typescript
import { createHash } from 'crypto';

private hashReceipt(receipt: string): string {
  return createHash('sha256').update(receipt).digest('hex').substring(0, 16);
}
```

---

### 6. Use Status Constants Consistently

**File:** `src/payment/payment.service.ts`

**Problem:** Hardcoded status strings instead of using constants.

**Changes needed:**

1. Add import at top:
```typescript
import { SUBSCRIPTION_STATUS } from '../subscription/subscription.constants';
```

2. Replace in `cancelSubscription` method (line 30):
```typescript
// Before
data: { status: 'cancelled', endsAt },

// After
data: { status: SUBSCRIPTION_STATUS.CANCELLED, endsAt },
```

3. Replace in `upsertSubscription` method (lines 123, 131):
```typescript
// Before
status: 'active',

// After
status: SUBSCRIPTION_STATUS.ACTIVE,
```

---

## Verification Checklist

After completing all fixes, verify:

- [ ] `npm run build` passes without errors
- [ ] `npm test` passes all tests
- [ ] `npm run test -- --testPathPattern="subscription.service"` passes
- [ ] `npm run test -- --testPathPattern="payment.service"` passes
- [ ] Prisma migration generated and applied successfully
- [ ] No TypeScript errors in IDE

---

## Files Modified Summary

| File | Action |
|------|--------|
| `src/subscription/subscription.service.ts` | Fix DI, use constants |
| `src/subscription/subscription.module.ts` | Add PrismaModule import |
| `src/subscription/subscription.service.spec.ts` | Create new file |
| `src/payment/payment.controller.ts` | Remove cancel endpoint |
| `src/payment/payment.service.ts` | Remove cancelSubscription, fix hash, use constants |
| `src/payment/payment.service.spec.ts` | Remove cancelSubscription tests |
| `prisma/migrations/*` | New migration for PaymentMethod removal |

---

# Security Issues

Identified during security audit on 2026-02-02.

---

## Critical Security Issues

### SEC-1. DTOs Missing Input Validators

**Files:**
- `src/help-support/dto/create-support-ticket.dto.ts:5,8` - `subject`, `message` fields have no validators
- `src/reward/dto/reward.dto.ts:5,8,11,13` - `name`, `description`, `points`, `imageUrl` missing validators
- `src/payment/dto/charge-subscription.dto.ts:3-11` - All fields missing validators

**Risk:** Injection attacks, XSS, database errors from null/undefined values

**Fix:** Add `@IsString()`, `@IsNotEmpty()`, `@MaxLength()` decorators to all fields

---

### SEC-2. Sensitive Data Exposed in Payment Response

**File:** `src/payment/payment.service.ts:56`

**Problem:** `listPaymentMethods()` returns full payment method objects including the `details` field which may contain tokens.

**Current Code:**
```typescript
async listPaymentMethods(userId: string) {
  return this.prisma.paymentMethod.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });
}
```

**Fix:** Select only safe fields:
```typescript
async listPaymentMethods(userId: string) {
  return this.prisma.paymentMethod.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      type: true,
      provider: true,
      last4: true,
      expiry: true,
      createdAt: true,
    },
  });
}
```

---

### SEC-3. Admin Secret Vulnerable to Timing Attack

**File:** `src/auth/auth.service.ts:121`

**Problem:** String comparison using `!==` is vulnerable to timing attacks.

**Current Code:**
```typescript
if (data.adminSecret !== process.env.ADMIN_SECRET) {
  throw new ForbiddenException('Invalid admin secret');
}
```

**Fix:** Use constant-time comparison with ConfigService:
```typescript
import { timingSafeEqual } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { EnvConfig } from '@/shared/config/env.validation';

// Inject ConfigService in constructor
constructor(private readonly configService: ConfigService<EnvConfig, true>) {}

// In the method:
const secretBuffer = Buffer.from(data.adminSecret || '');
const expectedBuffer = Buffer.from(this.configService.get('ADMIN_SECRET', { infer: true }));

if (secretBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(secretBuffer, expectedBuffer)) {
  throw new ForbiddenException('Invalid admin secret');
}
```

**Note:** Always use `ConfigService<EnvConfig, true>` instead of `process.env` directly for type safety and testability.

---

### SEC-4. No Transaction PIN Brute-Force Protection

**File:** `src/payment/payment.service.ts:82-86`

**Problem:** Transaction PIN verification has no rate limiting or lockout mechanism.

**Fix:**
1. Add throttling to charge endpoints (already done via `@Throttle`)
2. Implement PIN attempt tracking with lockout after 5 failed attempts
3. Add exponential backoff for repeated failures

---

## High Priority Security Issues

### SEC-5. No Request Body Size Limit

**File:** `src/main.ts`

**Problem:** No global body size limit. Large payloads can cause DoS.

**Fix:** Add in `main.ts` with configurable limits:
```typescript
import { ConfigService } from '@nestjs/config';
import { EnvConfig } from '@/shared/config/env.validation';

const configService = app.get(ConfigService<EnvConfig, true>);
const bodyLimit = configService.get('BODY_SIZE_LIMIT', { infer: true });

app.use(express.json({ limit: bodyLimit }));
app.use(express.urlencoded({ limit: bodyLimit, extended: true }));
```

**Also add to env validation** (`src/shared/config/env.validation.ts`):
```typescript
BODY_SIZE_LIMIT: z.string().default('1mb'),
```

**Note:** Use `1mb` as default for general API requests. For file upload endpoints, override with route-specific middleware if larger payloads are needed.

---

### SEC-6. `any` Type in Guards Bypasses Type Safety

**Files:**
- `src/shared/guards/admin.guard.ts:14` - `(request as any).authUserData`
- `src/payment/payment.controller.ts:29,54,63,92` - `@Req() req: any`
- `src/user/user.controller.ts:85` - `@Req() req: any`

**Fix:** Use `AuthenticatedRequest` interface (defined in `auth.guard.ts:23`):
```typescript
import { AuthenticatedRequest } from '@/shared/guards/auth.guard';

@Get('me')
async getMe(@Req() req: AuthenticatedRequest) {
  return this.userService.findById(req.authUserData.userId);
}
```

---

### SEC-7. Missing Query Parameter Validation

**File:** `src/admin/admin.controller.ts:454`

**Problem:** `limit` query param not validated via DTO.

**Fix:** Create `PaginationQueryDto`:
```typescript
export class PaginationQueryDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  limit?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  offset?: number;
}
```

---

### SEC-8. No Session Expiration Check

**File:** `src/shared/guards/auth.guard.ts:66-68`

**Problem:** Guard checks if session exists but doesn't verify expiration.

**Fix:** Add expiration check:
```typescript
if (!session || session.expiresAt < new Date()) {
  throw new UnauthorizedException('Session expired');
}
```

---

### SEC-9. Refresh Token Endpoint Missing Throttle

**File:** `src/auth/auth.controller.ts:73`

**Problem:** Refresh token endpoint has no rate limiting.

**Fix:** Add throttle decorator:
```typescript
@Throttle({ default: { limit: 10, ttl: 60000 } })
@Post('refresh')
async refresh(@Body() dto: RefreshTokenDto) {
  // ...
}
```

---

## Medium Priority Security Issues

### SEC-10. Rate Limiting Gaps on GET Endpoints

**Endpoints missing throttling:**
- `GET /user/me`
- `GET /stories/:id`
- `GET /subscription/status`

**Fix:** Add soft throttling (100 req/min) to prevent enumeration attacks.

---

### SEC-11. No CSRF Protection

**Problem:** POST/PUT/DELETE endpoints lack CSRF token validation.

**Fix:** If using cookie-based sessions, add CSRF protection:
```typescript
import * as csurf from 'csurf';
app.use(csurf());
```

---

### SEC-12. User-Generated Content Not Sanitized

**File:** `src/story/dto/story.dto.ts:102`

**Problem:** `textContent` field accepted as raw string. XSS risk if rendered as HTML.

**Fix:** Either:
1. Sanitize with DOMPurify before storage
2. Ensure frontend escapes content before rendering
3. Add `@Transform()` decorator to strip HTML tags

---

### SEC-13. Payment Details Field Unbounded

**File:** `src/payment/dto/create-payment-method.dto.ts:11-14`

**Problem:** No length validation on `details` field.

**Fix:**
```typescript
@IsString()
@IsNotEmpty()
@MinLength(1)
@MaxLength(500)
details: string;
```

---

### SEC-14. Meta Field Accepts Arbitrary JSON

**File:** `src/payment/dto/create-payment-method.dto.ts:35-38`

**Problem:** `meta` field accepts any JSON structure.

**Fix:** Either validate against strict schema or limit size:
```typescript
@IsObject()
@IsOptional()
@MaxLength(1000, { message: 'Meta JSON too large' })
meta?: Prisma.InputJsonValue;
```

---

## Security Verification Checklist

After completing security fixes, verify:

- [ ] All DTOs have proper class-validator decorators
- [ ] Sensitive fields excluded from API responses
- [ ] Constant-time comparison used for secrets
- [ ] Request body size limits configured
- [ ] Rate limiting applied to all sensitive endpoints
- [ ] Session expiration enforced
- [ ] No `any` types in authentication/authorization code
- [ ] CSRF protection enabled (if using cookies)
- [ ] User input sanitized before storage/display

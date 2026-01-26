# Storytime Backend - Development Guidelines

## Architecture Overview

This is a **NestJS 11** backend with **Prisma ORM**, **PostgreSQL**, and **Redis** caching. The codebase follows a **feature-based (domain-driven) module organization**.

### Tech Stack
- **Framework**: NestJS 11.0.1
- **ORM**: Prisma 6.19.0
- **Database**: PostgreSQL
- **Cache**: Redis + In-Memory (two-tier)
- **Queue**: BullMQ (Redis-backed job queue for emails)
- **Health Checks**: @nestjs/terminus (DB, Redis, SMTP, Queue, Memory, Disk)
- **Auth**: JWT + Sessions, Google OAuth
- **External Services**: ElevenLabs, Deepgram, Google Gemini, Cloudinary

## Code Conventions

### Import Paths
Use the `@/` alias for all internal imports:
```typescript
// CORRECT
import { PrismaService } from '@/prisma/prisma.service';

// AVOID
import { PrismaService } from 'src/prisma/prisma.service';
import { PrismaService } from '../../../prisma/prisma.service';
```

### Type Safety
**Never use `any` type.** Always define proper types or interfaces:
```typescript
// BAD
const payload = (req as any).user;
const updateData: any = {};

// GOOD
interface JwtPayload {
  id: string;
  userId: string;
  email: string;
  userRole: Role;
}
const payload = req.user as JwtPayload;
```

### Service Structure
- Keep services under 400 lines
- Single responsibility: one domain concern per service
- Extract complex logic into helper services

### Error Handling
Use specific NestJS exceptions with meaningful messages:
```typescript
// GOOD
throw new NotFoundException(`Story with ID ${storyId} not found`);
throw new ConflictException('Email already registered');
throw new ForbiddenException('You do not have access to this resource');

// BAD
throw new Error('Not found');
throw new HttpException('Error', 400);
```

### Logging
Use the NestJS Logger, never `console.log`:
```typescript
// GOOD
private readonly logger = new Logger(MyService.name);
this.logger.log('Processing request');
this.logger.error('Failed to process', error.stack);

// BAD
console.log('Processing request');
```

### Database Operations
- Always use transactions for multi-step operations
- Filter soft-deleted records: `isDeleted: false`
- Use `select` to limit returned fields for performance

```typescript
// Transaction example
await this.prisma.$transaction(async (tx) => {
  await tx.user.update({ where: { id }, data });
  await tx.session.deleteMany({ where: { userId: id } });
});
```

### DTOs and Validation
- All controller inputs must have DTOs with class-validator decorators
- Use Swagger decorators for API documentation
```typescript
export class CreateStoryDto {
  @ApiProperty({ description: 'Story title' })
  @IsString()
  @IsNotEmpty()
  title: string;
}
```

## Module Structure

### Feature Modules
Each feature module follows this structure:
```
feature/
├── dto/
│   ├── create-feature.dto.ts
│   └── update-feature.dto.ts
├── guards/                    # Module-specific guards (e.g., auth/guards/google-auth.guard.ts)
├── utils/                     # Module-specific utilities
├── feature.controller.ts
├── feature.service.ts
├── feature.module.ts
└── feature.service.spec.ts
```

### Shared Module (`src/shared/`)
Cross-cutting concerns are centralized in the shared module:
```
shared/
├── config/                    # App configuration (env validation, throttle config)
│   ├── env.validation.ts
│   └── throttle.config.ts
├── constants/                 # Shared constants
│   ├── ai-providers.constants.ts
│   └── throttle.constants.ts
├── decorators/                # Custom decorators (@Public, etc.)
│   └── public.decorator.ts
├── dtos/                      # Shared DTOs (API response wrapper)
│   └── api-response.dto.ts
├── filters/                   # Exception filters
│   ├── http-exception.filter.ts
│   ├── prisma-exception.filter.ts
│   └── throttler-exception.filter.ts
├── guards/                    # Global guards (auth, admin, throttle)
│   ├── admin.guard.ts
│   ├── auth.guard.ts
│   ├── auth-throttle.guard.ts
│   └── subscription-throttle.guard.ts
├── interceptors/              # Response interceptors
│   └── success-response.interceptor.ts
├── middleware/                # Global middleware
│   └── request-logger.middleware.ts
├── types/                     # TypeScript type definitions
│   └── index.ts
└── shared.module.ts           # Exports all shared utilities (marked @Global)
```

### Import Patterns
```typescript
// Shared utilities - use @/shared/
import { AuthSessionGuard } from '@/shared/guards/auth.guard';
import { Public } from '@/shared/decorators/public.decorator';

// Feature DTOs - use relative ./dto/
import { CreateStoryDto } from './dto/story.dto';

// Cross-module imports - use @/ alias
import { UserDto } from '@/auth/dto/auth.dto';
```

## Testing Requirements

- **Unit tests**: Required for all services
- **E2E tests**: Required for critical flows (auth, payments)
- **Naming**: `*.spec.ts` for unit, `*.e2e-spec.ts` for E2E
- **Coverage target**: Aim for 80%+ on business logic

Mock pattern:
```typescript
const mockPrismaService = {
  user: { findUnique: jest.fn(), create: jest.fn() },
  $transaction: jest.fn((cb) => cb(mockPrismaService)),
};
```

## API Response Format

All responses use the standardized wrapper from `SuccessResponseInterceptor`:
```typescript
// Success
{
  statusCode: 200,
  success: true,
  data: { ... },
  timestamp: "2024-01-26T..."
}

// Error
{
  statusCode: 400,
  success: false,
  error: "Bad Request",
  message: "Validation failed",
  timestamp: "2024-01-26T...",
  path: "/api/v1/..."
}
```

## Email Queue System

The application uses **BullMQ** for reliable async email delivery with automatic retries.

### Architecture
```
notification/
├── queue/
│   ├── email-queue.constants.ts  # Queue names, retry config
│   ├── email-job.interface.ts    # Job data types, priorities
│   ├── email-queue.service.ts    # Queue producer (adds jobs)
│   ├── email.processor.ts        # Queue consumer (processes jobs)
│   └── index.ts
├── providers/
│   └── email.provider.ts         # Direct SMTP (used by processor)
└── notification.service.ts       # Public API (queueEmail, sendEmail)
```

### Usage
```typescript
// RECOMMENDED: Queue email for async delivery with retries
await this.notificationService.queueEmail(
  'user@example.com',
  'Subject',
  '<p>HTML content</p>',
  { userId: user.id, category: 'EMAIL_VERIFICATION' }
);

// Legacy: Sync send (only when immediate confirmation needed)
await this.notificationService.sendEmail(email, subject, html, true);
```

### Retry Configuration
- **5 retry attempts** with exponential backoff
- **Delays**: 30s → 1m → 2m → 4m → 8m
- **Priority levels**: HIGH (auth emails), NORMAL, LOW (marketing)
- Failed jobs kept for 7 days for debugging

### Monitoring
```typescript
// Get queue statistics
const stats = await emailQueueService.getQueueStats();
// { waiting: 5, active: 1, completed: 100, failed: 2, delayed: 0 }
```

## Health Checks

The application uses **@nestjs/terminus** for comprehensive health monitoring.

### Endpoints
| Endpoint | Purpose | Checks |
|----------|---------|--------|
| `GET /health` | Liveness probe | Service is running |
| `GET /health/ready` | Readiness probe | Database, Redis, Email Queue |
| `GET /health/db` | Database health | Prisma connection |
| `GET /health/redis` | Redis health | Cache connectivity |
| `GET /health/smtp` | SMTP health | Email server verification |
| `GET /health/queue` | Queue health | BullMQ email queue metrics |
| `GET /health/system` | System resources | Memory heap/RSS, Disk space |
| `GET /health/full` | Complete check | All indicators combined |

### Architecture
```
health/
├── indicators/
│   ├── prisma.health.ts     # Database connectivity
│   ├── redis.health.ts      # Redis ping + memory info
│   ├── smtp.health.ts       # SMTP verification
│   ├── queue.health.ts      # BullMQ queue statistics
│   └── index.ts
├── health.controller.ts
└── health.module.ts
```

### Kubernetes Integration
```yaml
# Example liveness/readiness probes
livenessProbe:
  httpGet:
    path: /api/v1/health
    port: 3000
  initialDelaySeconds: 30
  periodSeconds: 10

readinessProbe:
  httpGet:
    path: /api/v1/health/ready
    port: 3000
  initialDelaySeconds: 5
  periodSeconds: 5
```

## Request Logging Middleware

The application logs all HTTP requests with tracing support via `RequestLoggerMiddleware`.

### Features
- **Request ID generation**: UUID per request (or uses `X-Request-ID` header)
- **Response timing**: Millisecond precision duration logging
- **User tracking**: Logs authenticated user ID (first 8 chars)
- **Status-based log levels**: INFO (2xx/3xx), WARN (4xx), ERROR (5xx)
- **Smart filtering**: Skips health check endpoints to reduce noise

### Log Format
```
→ GET /api/v1/users [a1b2c3d4] from 192.168.1.1      # Incoming request
← GET /api/v1/users 200 45ms [a1b2c3d4] user:5e6f7g8h # Success response
⚠ POST /api/v1/auth 401 12ms [a1b2c3d4]              # Client error
✗ GET /api/v1/stories 500 230ms [a1b2c3d4]           # Server error
```

### Client Correlation
The middleware sets `X-Request-ID` response header, allowing clients to trace requests through logs.

## Security Guidelines

1. **Never commit secrets** - Use environment variables
2. **Validate all inputs** - DTOs with class-validator
3. **Use guards** - `@UseGuards(AuthSessionGuard)` for protected routes
4. **Rate limit** - Apply throttling to public endpoints
5. **Sanitize outputs** - Never expose internal IDs or sensitive data

## Known Technical Debt

### High Priority
- [ ] Reduce `any` type usage (~117 instances)
- [ ] Increase test coverage (currently ~15%)
- [ ] Split large services (AuthService: 848 lines)
- [ ] Resolve circular dependencies (use events instead of forwardRef)
- [ ] Fix notification service Prisma schema mismatch (`category` field removed)

### Medium Priority
- [x] ~~Standardize import paths to use `@/` alias~~ (Completed)
- [x] ~~Consolidate common utilities into shared module~~ (Completed)
- [x] ~~Implement retry logic for email service~~ (BullMQ queue with exponential backoff)
- [x] ~~Add request logging middleware~~ (RequestLoggerMiddleware with tracing)
- [x] ~~Add health checks for external dependencies~~ (@nestjs/terminus - DB, Redis, SMTP, Queue)
- [ ] Implement retry logic for other external services (AI, TTS)

### Low Priority
- [ ] Fix typo: `generete-token.ts` → `generate-token.ts`
- [x] ~~Consolidate `support/` and `help-support/` modules~~ (support/ removed, help-support/ retained)
- [ ] Add JSDoc comments to public service methods

### Completed Refactoring (January 2026)
- ✅ Created centralized `shared/` module for cross-cutting concerns
- ✅ Moved guards, filters, interceptors from `common/` → `shared/`
- ✅ Moved config and decorators to `shared/`
- ✅ Standardized DTO locations to `module/dto/` subdirectories
- ✅ Updated all import paths to use `@/` alias pattern
- ✅ Implemented BullMQ email queue with retry logic and exponential backoff
- ✅ Fixed TLS validation (enabled in production, disabled in dev)
- ✅ Added @nestjs/terminus health checks (DB, Redis, SMTP, Queue, System)
- ✅ Added request logging middleware with request ID tracing

## Refactoring Guidelines

When making changes:
1. **Small PRs** - One concern per PR
2. **No breaking changes** - Maintain API compatibility
3. **Add tests** - For any new or modified code
4. **Update types** - Replace `any` with proper types
5. **Document** - Update Swagger and add code comments for complex logic

## Environment Variables

Required variables are validated in `src/shared/config/env.validation.ts` using Zod. Key variables:
- `NODE_ENV`: development | staging | production
- `DATABASE_URL`: PostgreSQL connection string
- `REDIS_URL`: Redis connection string (for caching)
- `JWT_SECRET`: Secret for JWT signing
- `GOOGLE_CLIENT_ID/SECRET`: OAuth credentials

## Running the Application

```bash
# Development
pnpm run start:dev

# Production
pnpm run build && pnpm run start:prod

# Tests
pnpm run test          # Unit tests
pnpm run test:e2e      # E2E tests
pnpm run test:cov      # Coverage report
```


## INSTRUCTIONS

You're a senior developer with 25+ years of experience working on highly scalable and performant applications. 

# Storytime Backend - Development Guidelines

## Architecture Overview

This is a **NestJS 11** backend with **Prisma ORM**, **PostgreSQL**, and **Redis** caching. The codebase follows a **feature-based (domain-driven) module organization**.

### Tech Stack
- **Framework**: NestJS 11.0.1
- **ORM**: Prisma 6.19.0
- **Database**: PostgreSQL
- **Cache**: Redis + In-Memory (two-tier)
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

Each feature module should follow this structure:
```
feature/
├── dto/
│   ├── create-feature.dto.ts
│   └── update-feature.dto.ts
├── feature.controller.ts
├── feature.service.ts
├── feature.module.ts
└── feature.service.spec.ts
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

### Medium Priority
- [ ] Standardize import paths to use `@/` alias
- [ ] Add request logging middleware
- [ ] Implement retry logic for external services
- [ ] Add health checks for external dependencies

### Low Priority
- [ ] Fix typo: `generete-token.ts` → `generate-token.ts`
- [ ] Consolidate `support/` and `help-support/` modules
- [ ] Add JSDoc comments to public service methods

## Refactoring Guidelines

When making changes:
1. **Small PRs** - One concern per PR
2. **No breaking changes** - Maintain API compatibility
3. **Add tests** - For any new or modified code
4. **Update types** - Replace `any` with proper types
5. **Document** - Update Swagger and add code comments for complex logic

## Environment Variables

Required variables are validated in `src/config/env.validation.ts` using Zod. Key variables:
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

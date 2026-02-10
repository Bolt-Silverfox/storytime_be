# Code Style and Conventions

## Formatting (Prettier)
- Single quotes for strings
- Trailing commas in all multiline structures
- Configuration in `.prettierrc`

## Linting (ESLint)
- TypeScript with type-checked rules
- Prettier integration
- Some `any` rules relaxed (but prefer proper types)
- Floating promises should be handled (warning)

## TypeScript Conventions
- Use Prisma types and enums (e.g., `Role` from `@prisma/client`)
- Prefer `unknown` over `any` when type is truly unknown
- Use proper DTO types for API responses
- Use `Prisma.*Input` types for update operations

## NestJS Patterns
- Controllers: Handle HTTP, use decorators, delegate to services
- Services: Business logic, database operations
- DTOs: Request/response validation with class-validator
- Guards: Authentication and authorization
- Interceptors: Cross-cutting concerns (logging, caching)

## Prisma Patterns
- Always filter `isDeleted: false` for soft-deleted records
- Use transactions for multi-step operations
- Prefer `select` for list queries to limit data transfer
- Use `include` sparingly, prefer explicit `select`
- Batch queries with `Promise.all()` to avoid N+1 problems

## Error Handling
- Use NestJS exceptions (HttpException, BadRequestException, etc.)
- Log errors with context using Logger
- Catch blocks should use descriptive variable names (avoid unused `error`)

## Caching
- Two-tier: Redis (distributed) + In-Memory (local)
- Invalidate cache on mutations
- Use specific keys, not broad patterns when possible

## Testing
- Jest for unit and e2e tests
- Mock Prisma with in-memory storage for e2e
- Use descriptive test names
- Group related tests with `describe` blocks

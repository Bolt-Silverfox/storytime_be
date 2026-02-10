# Task Completion Checklist

## Before Committing Code

### 1. Build Verification
```bash
pnpm build
```
- Ensure no TypeScript compilation errors
- Verify no missing imports or exports

### 2. Linting
```bash
pnpm lint
```
- Fix all lint errors
- Address warnings where practical

### 3. Testing
```bash
pnpm test
```
- Ensure all existing tests pass
- Add tests for new functionality if appropriate

### 4. Code Review Checklist
- [ ] No hardcoded secrets or credentials
- [ ] No `console.log` statements (use Logger)
- [ ] Proper error handling
- [ ] No N+1 queries (batch where possible)
- [ ] Transactions for multi-step operations
- [ ] DTOs for API inputs/outputs
- [ ] Soft delete filter (`isDeleted: false`) where needed

## Committing

### Commit Message Format
```
type(scope): short description

[optional body with more details]
```

Types: `feat`, `fix`, `perf`, `refactor`, `test`, `docs`, `chore`

### After Committing
1. Update COORDINATION.md if working on multi-instance project
2. Push to remote branch
3. Verify CI passes (if configured)

## For Service Extractions

When extracting services from "god services":

1. Create new service file in appropriate `services/` subdirectory
2. Move relevant methods and their dependencies
3. Update module to include new service as provider and export
4. Update controller to inject new service
5. Update original service to delegate if needed for backwards compatibility
6. Update any tests that reference moved methods
7. Verify all imports are correct
8. Run build and tests

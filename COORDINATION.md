# Multi-Instance Claude Coordination

**Branch**: `integration/refactor-2026-02`
**Base**: `develop-v0.0.1`
**Created**: 2026-02-08

---

## 🔄 Coordination Protocol

All Claude instances working on this codebase should:

1. **Before starting work**: Pull latest from `integration/refactor-2026-02`
2. **After completing work**: Push to integration branch with clear commit messages
3. **Update this file**: Log your changes in the Active Work section below

### Commands to Sync

```bash
# Sync before starting
git checkout integration/refactor-2026-02
git pull origin integration/refactor-2026-02

# After completing work
git add .
git commit -m "type(scope): description"
git push origin integration/refactor-2026-02

# Update this coordination file with your changes
```

---

## 📋 Active Work Log

### Instance 1 (This Instance) - ✅ Completed
**Focus**: Subscription caching & guard refactoring
**Timestamp**: 2026-02-08

**Changes Made**:
- `src/subscription/subscription.service.ts` - Added `isPremiumUser()` with 1-min cache, `invalidateCache()`
- `src/shared/guards/subscription-throttle.guard.ts` - Refactored to use SubscriptionService
- `src/story/story-quota.service.ts` - Now uses centralized isPremiumUser
- `src/story/story.module.ts` - Added SubscriptionModule import, SubscriptionThrottleGuard provider
- `PERFORMANCE_IMPROVEMENTS.md` - Added monitoring, queue, API, Prisma v7 sections
- `QA_IMPROVEMENTS.md` - Added testing strategy, CI/CD, code review sections

**Fixed Issues**:
- Lint errors: unused `error` variables in catch blocks
- Module wiring: StoryModule now properly imports SubscriptionModule

### Instance 2 - ✅ Completed
**Focus**: God service refactoring documentation
**Timestamp**: 2026-02-08
**Branch**: `perf/improvements`

**Changes Made**:
- `QA_IMPROVEMENTS.md` - Expanded section 2.3 with detailed god service refactoring plans:
  - AdminService (2,121 lines) → 4 services
  - StoryService (1,787 lines) → 5 services
  - AuthService (694 lines) → 3 new services
  - NotificationService (737 lines) → 4 services
  - UserService (689 lines) → 4 services
  - StoryBuddyService (728 lines) → 4 services
  - ReportsService (536 lines) → 3 services
- Added method-to-service mappings, dependencies, implementation order
- Added 4-phase action items for systematic extraction

**Status**: Documentation complete. Ready for service extraction work.

### Instance 3 - 🔄 In Progress
**Focus**: [Describe your work area]
**Timestamp**:

**Changes Made**:
- [List files being modified]

**Status**:

---

## ⚠️ Conflict Zones (Do Not Touch)

Files currently being modified by other instances - avoid editing these:

| File | Instance | Status |
|------|----------|--------|
| `src/subscription/subscription.service.ts` | Instance 1 | ✅ Done |
| `src/story/story-quota.service.ts` | Instance 1 | ✅ Done |
| `src/shared/guards/subscription-throttle.guard.ts` | Instance 1 | ✅ Done |

---

## 🎯 Remaining Work (Unclaimed)

Available tasks from the roadmaps:

### From PERFORMANCE_IMPROVEMENTS.md
- [ ] Add transactions to SubscriptionService for plan changes
- [ ] Add transactions to StoryService for story creation
- [ ] Batch sequential queries (N+1 fixes in story.service.ts)
- [ ] Add retry logic to AI provider calls (GeminiService)
- [ ] Implement circuit breaker for external services

### From QA_IMPROVEMENTS.md
- [ ] Add unit tests for AuthService
- [ ] Add unit tests for UserService
- [ ] Add E2E tests for authentication flows
- [ ] Replace remaining `any` types (~22 files)

### God Service Extractions (see QA_IMPROVEMENTS.md section 2.3 for details)

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

## 🔗 Branch Strategy

```
develop-v0.0.1 (base)
    └── integration/refactor-2026-02 (shared integration)
            ├── fix/format-and-lint (merged ✅)
            ├── [instance-2-branch]
            └── [instance-3-branch]
```

When all instances complete their work:
1. Verify build passes: `pnpm run build`
2. Run tests: `pnpm run test`
3. Create PR from `integration/refactor-2026-02` → `develop-v0.0.1`

---

## 📝 Notes

- All instances should follow conventional commits
- Run `pnpm run build` before pushing
- Lint errors should be fixed immediately
- Update the conflict zones table when claiming new files

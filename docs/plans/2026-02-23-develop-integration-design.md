# Design: Develop-v0.0.1 Integration into Refactored Branch

**Date:** 2026-02-23
**Branch:** integration/refactor-2026-02
**Source:** develop-v0.0.1 (40+ commits to port)
**Timeline:** 1-2 weeks to complete, then this branch becomes the standard

### Completion Status
- [x] Phase 0: Schema & Migrations (done)
- [x] Phase 1: Payment Module (done)
- [x] Phase 2: Notification Module (done)
- [x] Phase 3: Auth Module (done)
- [x] Phase 4: Admin Module (done)
- [x] Phase 5: Story Module (done)
- [x] Phase 6: Shared/Config Cleanup (done)
- [x] Phase 7: Voice — New TTS Providers (done 2026-02-23)
- [x] Phase 8: Voice — TTS Service & Constants (done 2026-02-23)
- [x] Phase 9: Payment — Google Play Acknowledgement & Mobile IDs (done 2026-02-23)
- [x] Phase 10: Auth Guard & Session Improvements (done 2026-02-23)
- [ ] Phase 11: Story — Categories & Library Endpoints
- [ ] Phase 12: Cleanup & Dead Code Removal

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

## Phase 7: Voice Module Overhaul — New TTS Providers

### Priority: CRITICAL
### Source Commits: `df7fb7d`, `736eb6f`, `d3d18ba`, `1b2bcb4`, `b6c443a`, `c59fc63`, `05622d7`, `f9b6077`

### Context
Develop replaced Deepgram TTS with StyleTTS2 (HuggingFace Gradio) and Edge TTS (Microsoft). Our branch has a voice queue (BullMQ) and repository pattern that develop never had — these must be preserved while porting the new providers.

### Changes to Port

#### 7.1 Add StyleTTS2 TTS Provider
**New file:** `src/voice/providers/styletts2-tts.provider.ts`
- Uses `@gradio/client` to connect to HuggingFace Space (configurable via STYLE_TTS2.SPACE_ID)
- Implements `ITextToSpeechProvider` interface + `OnModuleInit` (warm-up ping)
- WAV buffer merging for multi-chunk audio (custom `mergeWavBuffers`)
- `withTimeout` helper for Gradio operations
- URL validation via `isAllowedAudioUrl` (trusted HuggingFace hosts only)
- MAX_AUDIO_BYTES = 10MB limit
- Dependencies: `TextChunker`, `HttpService`, `ConfigService`
- Config from `VOICE_CONFIG_SETTINGS.STYLE_TTS2`

**NPM package required:** `@gradio/client`

#### 7.2 Add Edge TTS Provider
**New file:** `src/voice/providers/edge-tts.provider.ts`
- Uses `@andresaya/edge-tts` npm package
- Implements `ITextToSpeechProvider` interface
- Creates fresh EdgeTTS instance per chunk to avoid buffer accumulation
- Dependencies: `TextChunker`
- Config from `VOICE_CONFIG_SETTINGS.EDGE_TTS`

**NPM package required:** `@andresaya/edge-tts`

#### 7.3 Remove Deepgram TTS Provider
- Remove `src/voice/providers/deepgram-tts.provider.ts`
- Remove `DeepgramTTSProvider` from `voice.module.ts` providers and exports
- Keep `DeepgramSTTProvider` (Speech-to-Text still uses Deepgram)
- Remove `DEEPGRAM` section from `voice.config.ts`

#### 7.4 Update Voice Config
**File:** `src/voice/voice.config.ts`
- Add `MAX_TTS_TEXT_LENGTH = 50_000`
- Add `STYLE_TTS2` config section: `{ SPACE_ID, ENDPOINT: '/on_generate_tts', SPEED: 120, TIMEOUT_MS: 30_000, CHUNK_SIZE: 3000 }`
- Add `EDGE_TTS` config section: `{ RATE: -10, OUTPUT_FORMAT: 'audio-24khz-96kbitrate-mono-mp3', CHUNK_SIZE: 3000, TIMEOUT_MS: 30_000 }`
- Remove `DEEPGRAM` config section

#### 7.5 Update Voice Module
**File:** `src/voice/voice.module.ts`
- Add `StyleTTS2TTSProvider` and `EdgeTTSProvider` to providers
- Remove `DeepgramTTSProvider` from providers and exports
- Add `StyleTTS2TTSProvider` and `EdgeTTSProvider` to exports
- Keep voice queue (BullMQ) — our branch improvement
- Keep repository pattern for voice-quota — our branch improvement

### Architectural Notes
- Our voice queue processor (`voice.processor.ts`) uses `TextToSpeechService` — it will automatically pick up the new 3-tier chain once the TTS service is updated in Phase 8
- Both new providers implement `ITextToSpeechProvider` interface for consistency

---

## Phase 8: Voice Module Overhaul — TTS Service & Constants

### Priority: CRITICAL
### Source Commits: `865480f`, `e85f416`, `6d2dde8`, `ba72de5`, `73815ab`, `ce7b6e8`, `0c6c845`, `0480f85`

### Changes to Port

#### 8.1 Update Voice Constants
**File:** `src/voice/voice.constants.ts`

Major changes:
- Change `DEFAULT_VOICE` from `VoiceType.CHARLIE` to `VoiceType.LILY`
- Add `VoiceConfigEntry` interface with new fields: `edgeTtsVoice`, `styleTts2Voice`
- Update all 6 existing voice configs with `edgeTtsVoice` and `styleTts2Voice` mappings
- Add display names (CHARLIE→Milo, JESSICA→Bella, WILL→Cosmo, LILY→Nimbus, BILL→Fanice, LAURA→Chip)
- Add ROSIE and PIXIE voice configs (child voices)
- Update BILL avatar URL (new Fanice avatar)
- Add ROSIE and PIXIE to VOICE_AVATARS and VOICE_PREVIEWS
- Type `VOICE_AVATARS` and `VOICE_PREVIEWS` as `Record<VoiceType, string>`

#### 8.2 Update VoiceType Enum
**File:** `src/voice/dto/voice.dto.ts`
- Add `ROSIE = 'ROSIE'` and `PIXIE = 'PIXIE'` to VoiceType enum
- Add `displayName` field to `VoiceResponseDto`
- Add `storyId` field to `StoryContentAudioDto` with `@IsUUID()` validation

#### 8.3 Update Text-to-Speech Service (3-Tier Chain)
**File:** `src/story/text-to-speech.service.ts`

Major rewrite:
- Replace 2-tier chain (ElevenLabs → Deepgram) with 3-tier chain (ElevenLabs → StyleTTS2 → Edge TTS)
- Replace `DeepgramTTSProvider` dependency with `StyleTTS2TTSProvider` + `EdgeTTSProvider`
- Add `PrismaService` dependency for paragraph audio caching
- Add text length guard (`MAX_TTS_TEXT_LENGTH`)
- Free users skip ElevenLabs entirely (uses `isPremiumUser` check)
- Per-voice `edgeTtsVoice` and `styleTts2Voice` resolution from VOICE_CONFIG
- Remove `STORY_REPOSITORY` injection and `IStoryRepository` dependency (voice lookup moves elsewhere)

#### 8.4 Paragraph Audio Caching
**Files:** `src/story/text-to-speech.service.ts`, `prisma/schema.prisma`

Schema change:
```prisma
model ParagraphAudioCache {
  id        String   @id @default(uuid())
  storyId   String
  textHash  String
  voiceId   String
  audioUrl  String
  createdAt DateTime @default(now())
  story     Story    @relation(fields: [storyId], references: [id])
  @@unique([storyId, textHash, voiceId])
  @@index([storyId])
}
```

Add `paragraphAudioCaches ParagraphAudioCache[]` relation to Story model.

New methods in TTS service:
- `getCachedParagraphAudio(storyId, text, voiceId)` — SHA-256 text hash lookup
- `cacheParagraphAudio(storyId, text, voiceId, audioUrl)` — cache write (non-fatal on error)

#### 8.5 Voice Constants Tests
**New file:** `src/voice/voice.constants.spec.ts`
- Tests for completeness: every VoiceType has config, avatar, preview
- Tests for uniqueness: Edge TTS voices, ElevenLabs IDs, StyleTTS2 voices

#### 8.6 Voice Service Updates
**File:** `src/voice/voice.service.ts`
- Add `toVoiceResponse()` private helper for Voice→VoiceResponseDto mapping
- Add `displayName` from VOICE_CONFIG lookup in all response builders
- Add caching to `fetchAvailableVoices()` (5-minute TTL)
- Add `findOrCreateElevenLabsVoice()` for voice cloning integration

#### 8.7 VoiceQuotaService — Admin Premium
**File:** `src/voice/voice-quota.service.ts`
- `isPremiumUser()`: Also treat admin users as premium (check `user.role === 'admin'`)

---

## Phase 9: Payment Module — Google Play Acknowledgement & Mobile IDs

### Priority: HIGH
### Source Commits: `52d59d3`, `b39e54c`, `9dc8e18`

### Changes to Port

#### 9.1 Google Play Purchase Acknowledgement
**File:** `src/payment/google-verification.service.ts`

New method: `acknowledgePurchase(params)` — Calls Python script with 'acknowledge' action

**File:** `src/payment/payment.service.ts`

In `verifyGooglePurchase()` after successful verification:
- Check `result.metadata?.acknowledgementState !== 1`
- If unacknowledged, call `googleVerificationService.acknowledgePurchase()`
- Log warning if ack fails (non-fatal — purchase is still valid but must be acknowledged within 3 days)

**File:** `scripts/verify_google_purchase.py`
- Add `acknowledge_purchase()` function calling `subscriptions.acknowledge()` Google API

#### 9.2 Mobile Product IDs
**File:** `src/subscription/subscription.constants.ts`

Add to `PRODUCT_ID_TO_PLAN`:
```typescript
'1_month_subscription': 'monthly',
'1_year_subscription': 'yearly',
```

#### 9.3 Remove Product ID Enumeration from Error
**File:** `src/payment/payment.service.ts`

In `mapProductIdToPlan()`, change error message:
```typescript
// Before: `Unknown product ID: ${productId}. Valid IDs: ${Object.keys(PRODUCT_ID_TO_PLAN).join(', ')}`
// After: `Unknown product ID: ${productId}`
```
(Security fix: don't enumerate valid product IDs to clients)

---

## Phase 10: Auth Guard & Session Improvements

### Priority: MEDIUM
### Source Commits: `f6f50a3`, `d970b28`, `9a59826`, `534b3de`

### Changes to Port

#### 10.1 Session Soft-Delete & Expiry Validation
**File:** `src/shared/guards/auth.guard.ts`

In the auth guard's `canActivate()`:
- After finding the session, check `session.deletedAt !== null` (soft-deleted)
- Check `session.expiresAt && session.expiresAt < new Date()` (expired)
- Return 401 for both cases with appropriate messages

#### 10.2 Logger in Auth Guard
Add `private readonly logger = new Logger(AuthSessionGuard.name)` to auth guard for server-side diagnostics (login failures, invalid tokens, expired sessions).

#### 10.3 Type Safety Improvements
- Rename `CancelParams` → `SubscriptionCancelParams` (if not already done)
- Add proper typing to auth guard response

---

## Phase 11: Story Module — Categories & Library Endpoints

### Priority: LOW-MEDIUM
### Source Commits: `466e1fe`

### Changes to Port

#### 11.1 Include Categories in Library Endpoints
**File:** `src/story/story.service.ts` (or relevant repository)

In `continue-reading` and `completed` library queries:
- Add `include: { categories: true }` to Prisma queries
- Map categories in response DTOs

---

## Phase 12: Cleanup & Dead Code Removal

### Priority: LOW
### Source Commits: `a9ff226`, `61837b7`, `c9e8548`, `6d76c19`, `7bb7d04`

### Changes to Port

#### 12.1 Remove Dead Code
- Remove commented-out services and unused DTOs from develop
- Check if any of these exist in our branch and clean up

#### 12.2 Preferences Validation
- Use `ParseBooleanRecordPipe` for preferences validation if applicable

#### 12.3 Remove Duplicate Audio Endpoints
- Verify no duplicate endpoints exist between story and voice controllers

#### 12.4 File Validation on Transcribe
Already implemented in our branch (ParseFilePipeBuilder on transcribe endpoint).

---

## Risk Mitigation

1. **After each phase:** Run `pnpm build` to catch compile errors
2. **After each phase:** Run relevant tests `pnpm test -- --testPathPattern=<module>`
3. **Schema changes first:** All subsequent phases depend on correct schema
4. **Commit per phase:** Each module gets its own commit for easy rollback
5. **Auth guard alignment:** Do a project-wide audit after all modules are ported
6. **NPM packages:** Install `@gradio/client` and `@andresaya/edge-tts` before Phase 7
7. **Prisma migration:** Add ParagraphAudioCache model before Phase 8

---

## Success Criteria

- All new features from develop-v0.0.1 are present in the integration branch
- All features are placed in the correct extracted services (not monolithic)
- `pnpm build` succeeds
- Existing tests pass
- New tests from develop are ported and pass
- No regression in refactored architecture (repositories, events, exceptions intact)
- New TTS providers (StyleTTS2, Edge TTS) work with existing voice queue
- Paragraph audio caching functional with ParagraphAudioCache model
- Child voices (ROSIE, PIXIE) available with proper config
- Google Play purchase acknowledgement prevents auto-refunds
- Mobile product IDs recognized for IAP verification

# Free Tier Limits Feature

## Overview
Implement usage limits for free tier users:
1. **Story Reading Limit**: 10 unique stories lifetime + 1 bonus story per week
2. **Voice Limit**: Default voice + 1 other voice of their choosing

## Requirements

### Story Limit
- Free users can read 10 unique stories (lifetime)
- +1 bonus story granted per week (accumulates)
- Re-reading already-read stories does NOT count against limit
- Limit resets only when user upgrades to premium

### Voice Limit
- Free users get: default voice + 1 custom voice selection
- They can choose any available voice as their "second" voice
- Premium users get unlimited voice access

## Implementation Status

### Phase 1: Database Schema
- [x] Extended `UserUsage` model with new fields:
  - `uniqueStoriesRead` - Lifetime count of unique stories accessed
  - `bonusStories` - Accumulated weekly bonus stories
  - `lastBonusGrantedAt` - When last weekly bonus was granted
  - `selectedSecondVoiceId` - The one custom voice free users can select

### Phase 2: Story Reading Limit
- [x] Created `StoryQuotaService` to track story reads
- [x] Created `StoryAccessGuard` to check story access
- [x] Implemented weekly bonus story grant logic (on-demand calculation)
- [x] Added `GET /stories/user/quota` endpoint to check remaining quota

### Phase 3: Voice Limit
- [x] Added `canUseVoice()` method to check subscription status
- [x] Added `PATCH /voice/second-voice` endpoint to set second voice for free users
- [x] Added `GET /voice/access` endpoint to get voice access status
- [x] Added voice validation methods to VoiceQuotaService

### Phase 4: API Updates
- [x] Updated `GET /stories/:id` endpoint to track reads and check quota
- [x] Updated `POST /stories/user/progress` endpoint with quota check
- [x] Updated `GET /story/audio/:id` endpoint with quota check
- [x] Added quota status endpoints for stories and voices

### Phase 5: Testing
- [ ] Unit tests for limit logic
- [ ] Integration tests for guards
- [ ] Test weekly bonus accumulation

## Current Progress
- **Status**: Implementation complete, pending testing
- **Last Updated**: 2026-02-08
- **Current Step**: Running build verification

## Key Design Decisions
- Weekly bonus calculated on-demand (not cron job)
- Re-reading already-read stories is always free
- Existing users grandfathered in (start at 0)
- Extended UserUsage model (not new table)

## Files Created
- `src/story/story-quota.service.ts` - Story quota checking and tracking
- `src/shared/guards/story-access.guard.ts` - Guard for story access
- `src/shared/decorators/story-quota.decorator.ts` - Decorator for endpoints
- `src/shared/constants/free-tier.constants.ts` - Constants for limits

## Files Modified
- `prisma/schema.prisma` - Added fields to UserUsage model
- `src/voice/voice-quota.service.ts` - Added second voice logic
- `src/story/story.controller.ts` - Added guards to endpoints
- `src/voice/voice.controller.ts` - Added voice quota endpoints
- `src/story/story.module.ts` - Registered new services

## New Endpoints

### Story Quota
- `GET /stories/user/quota` - Get story quota status (used, remaining, bonus)

### Voice Quota
- `PATCH /voice/second-voice` - Set second voice for free users
- `GET /voice/access` - Get voice access status

## Migration
- Migration `20260208134703_add_free_tier_limits` applied successfully

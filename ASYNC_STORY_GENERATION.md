# Async Story Generation - Mobile-First Architecture

**Status**: Phase 1 Complete ✅ | Phase 2 Complete ✅
**Branch**: `integration/refactor-2026-02`
**Last Updated**: 2026-02-12

---

## Overview

Async story generation system using BullMQ queue with mobile-optimized notification strategy. Story generation takes ~35 seconds on average, which is too long for synchronous HTTP requests, especially on mobile with unreliable networks.

---

## Phase 1: Queue System ✅ COMPLETE

### Implementation Status
- **Branch**: `fix/bug-fixes`
- **Commits**: 
  - `078972a` - Initial queue implementation
  - `4c52fcc` - Lint fixes
- **Files**: 5 new files in `src/story/queue/` (~1,065 lines)

### What We Built

#### 1. Queue Service (`story-queue.service.ts`)
- Queue management with BullMQ
- Job creation, status tracking, cancellation
- Priority support (HIGH/NORMAL/LOW for premium/standard/free users)
- Estimated wait time and completion time calculations

#### 2. Job Processor (`story.processor.ts`)
- Concurrency: 2 (prevents AI API overload)
- Progress tracking: 6 stages (0% → 10% → 30% → 50% → 70% → 90% → 100%)
- Retry logic: Exponential backoff, 3 attempts, 1-minute base delay
- Event hooks: completed, failed, active, error, stalled

#### 3. API Endpoints (via `story.controller.ts`)
```
POST   /stories/generate/async           - Queue story generation (returns jobId)
GET    /stories/generate/status/:jobId   - Poll job status with progress
GET    /stories/generate/result/:jobId   - Get completed story result
DELETE /stories/generate/job/:jobId      - Cancel pending job
GET    /stories/generate/pending          - List user's pending jobs
GET    /stories/generate/queue-stats      - Queue statistics (monitoring)
```

#### 4. Configuration (`story-queue.constants.ts`)
- Queue name, job names, retry config
- Job retention: 2h for completed, 24h for failed
- Progress stage definitions

#### 5. Type Definitions (`story-job.interface.ts`)
- StoryJobData, StoryJobResult, StoryResult
- StoryJobStatus enum (queued, processing, generating_content, etc.)
- StoryPriority enum (HIGH, NORMAL, LOW)
- StoryJobStatusResponse for client polling

---

## Phase 2: Push Notifications + SSE ✅ COMPLETE

### Mobile-Specific Challenges

1. **App Backgrounding**: iOS/Android kill WebSocket connections when app goes to background
2. **Battery Life**: Keeping persistent connections drains battery significantly
3. **Network Switching**: WiFi ↔ Cellular transitions drop connections frequently
4. **Push Notification Etiquette**: Can't spam users; notifications must be meaningful

### Recommended Architecture

#### Strategy: **Push Notifications (Primary) + Smart Polling (Fallback)**

```
┌─────────────────────────────────────────────────────────────┐
│                     Mobile App Flow                          │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  1. User requests story generation                           │
│     ↓                                                         │
│  2. App queues job via POST /stories/generate/async          │
│     ↓                                                         │
│  3. Receives jobId, shows "Generating..." screen             │
│     ↓                                                         │
│  4. IF app is foreground:                                    │
│     - Poll status every 2-5s (smart intervals)              │
│     - Show progress bar (0% → 100%)                         │
│     - Stop polling when app backgrounds                      │
│     ↓                                                         │
│  5. When job completes:                                      │
│     - Backend sends FCM push notification                    │
│     - App receives notification (even if backgrounded)      │
│     - User taps → App fetches completed story               │
│     ↓                                                         │
│  6. Fallbacks:                                               │
│     - If push fails → Email notification                     │
│     - If polling times out → Show "check back later" UI     │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

---

## Implementation Plan for Phase 2

### 2.1 Firebase Cloud Messaging (FCM) Integration

**New Service: `src/notification/fcm.service.ts`**

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';

export interface PushNotificationPayload {
  userId: string;
  title: string;
  body: string;
  data: Record<string, string>;
  priority?: 'high' | 'normal';
}

@Injectable()
export class FcmService {
  private readonly logger = new Logger(FcmService.name);

  constructor(private readonly configService: ConfigService) {
    // Initialize Firebase Admin SDK
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: configService.get('FIREBASE_PROJECT_ID'),
        privateKey: configService
          .get('FIREBASE_PRIVATE_KEY')
          ?.replace(/\\n/g, '\n'),
        clientEmail: configService.get('FIREBASE_CLIENT_EMAIL'),
      }),
    });
  }

  async sendToUser(payload: PushNotificationPayload): Promise<void> {
    try {
      // Get user's device tokens from database
      const deviceTokens = await this.getUserDeviceTokens(payload.userId);

      if (deviceTokens.length === 0) {
        this.logger.warn(
          `No device tokens found for user ${payload.userId}`,
        );
        return;
      }

      // Send to all user's devices
      const message: admin.messaging.MulticastMessage = {
        notification: {
          title: payload.title,
          body: payload.body,
        },
        data: payload.data,
        tokens: deviceTokens,
        android: {
          priority: payload.priority || 'high',
          notification: {
            channelId: 'story_generation',
            sound: 'default',
          },
        },
        apns: {
          payload: {
            aps: {
              sound: 'default',
              badge: 1,
            },
          },
        },
      };

      const response = await admin.messaging().sendEachForMulticast(message);

      this.logger.log(
        `FCM sent: ${response.successCount}/${deviceTokens.length} devices`,
      );

      // Clean up invalid tokens
      if (response.failureCount > 0) {
        await this.handleFailedTokens(deviceTokens, response.responses);
      }
    } catch (error) {
      this.logger.error(
        `Failed to send FCM notification: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  private async getUserDeviceTokens(userId: string): Promise<string[]> {
    // TODO: Query database for user's device tokens
    // Example: SELECT token FROM device_tokens WHERE userId = ? AND isActive = true
    return [];
  }

  private async handleFailedTokens(
    tokens: string[],
    responses: admin.messaging.SendResponse[],
  ): Promise<void> {
    const invalidTokens: string[] = [];

    responses.forEach((response, idx) => {
      if (!response.success) {
        const error = response.error;
        // Remove invalid tokens
        if (
          error?.code === 'messaging/invalid-registration-token' ||
          error?.code === 'messaging/registration-token-not-registered'
        ) {
          invalidTokens.push(tokens[idx]);
        }
      }
    });

    if (invalidTokens.length > 0) {
      this.logger.log(`Removing ${invalidTokens.length} invalid tokens`);
      // TODO: Mark tokens as inactive in database
    }
  }
}
```

**Environment Variables Required:**
```env
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@your-project.iam.gserviceaccount.com
```

---

### 2.2 Device Token Management

**New Table: `device_tokens`**

```prisma
// schema.prisma
model DeviceToken {
  id        String   @id @default(cuid())
  userId    String
  token     String   @unique
  platform  String   // 'ios' or 'android'
  isActive  Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  lastUsed  DateTime @default(now())

  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@index([token])
}
```

**New Endpoints:**

```typescript
// user.controller.ts or device.controller.ts

@Post('devices/register')
@UseGuards(AuthSessionGuard)
async registerDevice(
  @Req() req: AuthenticatedRequest,
  @Body() dto: RegisterDeviceDto,
) {
  return this.userService.registerDeviceToken({
    userId: req.authUserData.userId,
    token: dto.token,
    platform: dto.platform,
  });
}

@Delete('devices/:token')
@UseGuards(AuthSessionGuard)
async unregisterDevice(
  @Req() req: AuthenticatedRequest,
  @Param('token') token: string,
) {
  return this.userService.unregisterDeviceToken(
    req.authUserData.userId,
    token,
  );
}
```

**DTO:**
```typescript
export class RegisterDeviceDto {
  @IsString()
  @IsNotEmpty()
  token: string;

  @IsEnum(['ios', 'android'])
  platform: 'ios' | 'android';
}
```

---

### 2.3 Enhance Story Processor with Notifications

**Modify: `src/story/queue/story.processor.ts`**

```typescript
import { FcmService } from '@/notification/fcm.service';
import { EmailQueueService } from '@/notification/email-queue.service';

export class StoryProcessor extends WorkerHost {
  constructor(
    private readonly storyGenerationService: StoryGenerationService,
    private readonly fcmService: FcmService,
    private readonly emailQueueService: EmailQueueService,
  ) {
    super();
  }

  @OnWorkerEvent('completed')
  async onCompleted(job: Job<StoryJobData>, result: StoryJobResult): Promise<void> {
    this.logger.log(
      `Job ${job.data.jobId} completed: ${job.data.type} for user ${job.data.userId}`,
    );

    try {
      // Send push notification
      await this.fcmService.sendToUser({
        userId: job.data.userId,
        title: 'Your story is ready! 📖',
        body: `"${result.story?.title}" has been generated`,
        data: {
          type: 'story_generation_complete',
          jobId: job.data.jobId,
          storyId: result.storyId || '',
          action: 'open_story',
        },
        priority: 'high',
      });

      this.logger.log(`Push notification sent for job ${job.data.jobId}`);
    } catch (error) {
      this.logger.error(
        `Failed to send push notification for job ${job.data.jobId}: ${error.message}`,
      );

      // Fallback to email notification
      try {
        await this.emailQueueService.queueEmail({
          to: job.data.userId, // Assumes user email lookup
          template: 'story-ready',
          data: {
            storyTitle: result.story?.title,
            storyId: result.storyId,
          },
        });
        this.logger.log(`Fallback email sent for job ${job.data.jobId}`);
      } catch (emailError) {
        this.logger.error(
          `Failed to send fallback email: ${emailError.message}`,
        );
      }
    }
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job<StoryJobData> | undefined, error: Error): Promise<void> {
    if (!job) return;

    const { jobId, userId } = job.data;
    const willRetry = job.attemptsMade < (job.opts.attempts || 0);

    if (!willRetry) {
      // Permanent failure - notify user
      try {
        await this.fcmService.sendToUser({
          userId,
          title: 'Story generation failed',
          body: 'We encountered an issue generating your story. Please try again.',
          data: {
            type: 'story_generation_failed',
            jobId,
            error: error.message,
          },
          priority: 'normal',
        });
      } catch (notifError) {
        this.logger.error(
          `Failed to send failure notification: ${notifError.message}`,
        );
      }
    }
  }
}
```

---

### 2.4 Smart Polling Strategy (Frontend Documentation)

**Mobile App Implementation Recommendations:**

```typescript
// Example React Native / Expo implementation

class StoryGenerationPoller {
  private pollInterval: NodeJS.Timeout | null = null;
  private attemptCount = 0;
  
  startPolling(jobId: string, onUpdate: (status: JobStatus) => void) {
    // Clear any existing poll
    this.stopPolling();
    this.attemptCount = 0;
    
    const poll = async () => {
      try {
        const status = await api.getJobStatus(jobId);
        onUpdate(status);
        
        if (status.status === 'completed' || status.status === 'failed') {
          this.stopPolling();
          return;
        }
        
        // Smart interval calculation
        this.attemptCount++;
        const interval = this.calculateInterval(this.attemptCount);
        
        this.pollInterval = setTimeout(poll, interval);
      } catch (error) {
        console.error('Polling error:', error);
        // Exponential backoff on error
        const backoff = Math.min(30000, 1000 * Math.pow(2, this.attemptCount));
        this.pollInterval = setTimeout(poll, backoff);
      }
    };
    
    // Start immediately
    poll();
  }
  
  stopPolling() {
    if (this.pollInterval) {
      clearTimeout(this.pollInterval);
      this.pollInterval = null;
    }
  }
  
  private calculateInterval(attempt: number): number {
    // Fast initially (while user is watching), then slow down
    if (attempt < 3) return 2000;   // Poll every 2s for first 6 seconds
    if (attempt < 10) return 5000;  // Poll every 5s for next 35 seconds
    if (attempt < 20) return 10000; // Poll every 10s for next 100 seconds
    return 15000;                    // Poll every 15s after that
  }
}

// Usage in React Native component
useEffect(() => {
  const poller = new StoryGenerationPoller();
  
  // Start polling when job is queued
  poller.startPolling(jobId, (status) => {
    setProgress(status.progress);
    setProgressMessage(status.progressMessage);
    
    if (status.status === 'completed') {
      // Show success, navigate to story
      navigation.navigate('Story', { storyId: status.result.id });
    }
  });
  
  // Stop polling when:
  // 1. Component unmounts
  // 2. App goes to background (handled by AppState)
  return () => poller.stopPolling();
}, [jobId]);

// Stop polling when app backgrounds
useEffect(() => {
  const subscription = AppState.addEventListener('change', (state) => {
    if (state === 'background' || state === 'inactive') {
      poller.stopPolling();
      // Push notification will wake the app when job completes
    }
  });
  
  return () => subscription.remove();
}, []);
```

**Polling Best Practices:**

1. ✅ **DO**: Stop polling when app goes to background
2. ✅ **DO**: Use exponential backoff intervals (2s → 5s → 10s → 15s)
3. ✅ **DO**: Handle network errors gracefully
4. ✅ **DO**: Show progress bar during active polling
5. ❌ **DON'T**: Poll faster than 2 seconds
6. ❌ **DON'T**: Keep polling indefinitely (max 5 minutes)
7. ❌ **DON'T**: Poll multiple jobs simultaneously

---

### 2.5 Notification Channel Setup (Mobile App)

**iOS - AppDelegate:**
```swift
import UserNotifications

func application(_ application: UIApplication, 
                 didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
  UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { granted, error in
    if granted {
      DispatchQueue.main.async {
        application.registerForRemoteNotifications()
      }
    }
  }
  return true
}

func application(_ application: UIApplication, 
                 didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
  let token = deviceToken.map { String(format: "%02.2hhx", $0) }.joined()
  // Send token to backend
  API.registerDeviceToken(token, platform: "ios")
}
```

**Android - AndroidManifest.xml:**
```xml
<uses-permission android:name="android.permission.POST_NOTIFICATIONS"/>

<application>
  <meta-data
    android:name="com.google.firebase.messaging.default_notification_channel_id"
    android:value="story_generation" />
</application>
```

**React Native (using Expo):**
```typescript
import * as Notifications from 'expo-notifications';

// Configure notification channel (Android)
Notifications.setNotificationChannelAsync('story_generation', {
  name: 'Story Generation',
  importance: Notifications.AndroidImportance.HIGH,
  sound: 'default',
  vibrationPattern: [0, 250, 250, 250],
  lightColor: '#FF231F7C',
});

// Request permissions and get token
async function registerForPushNotifications() {
  const { status } = await Notifications.requestPermissionsAsync();
  
  if (status !== 'granted') {
    return null;
  }
  
  const token = await Notifications.getExpoPushTokenAsync({
    projectId: 'your-expo-project-id',
  });
  
  // Send to backend
  await api.registerDevice({
    token: token.data,
    platform: Platform.OS,
  });
  
  return token.data;
}

// Listen for notifications
Notifications.addNotificationReceivedListener(notification => {
  // Handle notification while app is in foreground
  const { type, jobId, storyId } = notification.request.content.data;
  
  if (type === 'story_generation_complete') {
    // Navigate to story or refresh story list
    navigation.navigate('Story', { storyId });
  }
});

Notifications.addNotificationResponseReceivedListener(response => {
  // Handle notification tap (app was in background/closed)
  const { type, jobId, storyId } = response.notification.request.content.data;
  
  if (type === 'story_generation_complete') {
    navigation.navigate('Story', { storyId });
  }
});
```

---

## Implementation Checklist

### Phase 2A: FCM Foundation ✅ COMPLETE
- [x] Install Firebase Admin SDK: `pnpm add firebase-admin`
- [x] Create `FcmService` in `src/notification/services/fcm.service.ts`
- [x] Add Firebase credentials to `.env`
- [x] Add `DeviceToken` model to `schema.prisma` (with DevicePlatform enum)
- [x] Run migration: `pnpm prisma db push`
- [x] Create device registration endpoints (`src/notification/device.controller.ts`)
- [x] Create `DeviceTokenService` in `src/notification/services/device-token.service.ts`
- [x] Add FCM service to NotificationModule

### Phase 2B: Story Processor Integration ✅ COMPLETE
- [x] Inject `FcmService` into `StoryProcessor`
- [x] Add push notification to `onCompleted` event
- [x] Add failure notification to `onFailed` event (permanent failures only)
- [x] Inject `JobEventsService` for SSE events
- [ ] Test with real device tokens

### Phase 2B-Voice: Voice Processor Integration ✅ COMPLETE
- [x] Inject `FcmService` into `VoiceProcessor`
- [x] Add push notification to `onCompleted` event
- [x] Add failure notification to `onFailed` event
- [x] Inject `JobEventsService` for SSE events

### Phase 2-Web: SSE for Web Clients ✅ COMPLETE
- [x] Create `JobEventsService` in `src/notification/services/job-events.service.ts`
- [x] Create `SseController` in `src/notification/sse.controller.ts`
- [x] SSE endpoint for all user job events: `GET /events/jobs`
- [x] SSE endpoint for specific job events: `GET /events/jobs/:jobId`
- [x] Heartbeat mechanism to keep connections alive
- [x] Emit events from both Story and Voice processors

### Phase 2C: Mobile App Setup (Frontend Team)
- [ ] Set up Firebase project (iOS & Android)
- [ ] Configure FCM in mobile app
- [ ] Create notification channel for story generation
- [ ] Implement device token registration flow
- [ ] Implement smart polling with AppState handling
- [ ] Handle deep links from notifications
- [ ] Test push notifications on real devices

### Phase 2D: Testing & Monitoring
- [ ] Test push notification delivery (iOS & Android)
- [ ] Test polling → push notification handoff
- [ ] Test app in background/foreground scenarios
- [ ] Test network switching (WiFi ↔ Cellular)
- [ ] Add monitoring for notification delivery rates
- [ ] Add alerting for notification failures
- [ ] Document troubleshooting guide

---

## Alternative Considerations

### Why NOT WebSockets for Mobile?

**Cons:**
- ❌ Connection killed when app backgrounds
- ❌ Battery drain from persistent connection
- ❌ Network switching breaks connection frequently
- ❌ No delivery guarantee when app is closed
- ❌ Complex reconnection logic needed

**When WebSockets make sense:**
- ✅ Real-time chat applications
- ✅ Live collaborative editing
- ✅ Web dashboards with constant updates
- ✅ Desktop applications

**Our use case:**
- One-time notification per job (not continuous stream)
- Jobs take 35+ seconds (not real-time)
- Users expect notification even when app is closed
- **Push notifications are the mobile standard for this pattern**

### Why NOT Server-Sent Events (SSE)?

**Cons:**
- ❌ Same connection issues as WebSockets
- ❌ Not supported in React Native without polyfills
- ❌ HTTP/1.1 connection limits (6 per domain)
- ❌ No browser push notification integration

---

## Monitoring & Observability

### Metrics to Track

**Queue Metrics:**
```typescript
// Add to story-queue.service.ts
async getDetailedQueueStats() {
  const stats = await this.getQueueStats();
  
  return {
    ...stats,
    avgWaitTime: await this.calculateAverageWaitTime(),
    avgProcessingTime: await this.calculateAverageProcessingTime(),
    successRate: stats.completed / (stats.completed + stats.failed),
    priorityDistribution: await this.getPriorityDistribution(),
  };
}
```

**Notification Metrics:**
```typescript
// Add to FcmService
private async trackNotificationMetrics(
  userId: string,
  success: boolean,
  failureReason?: string,
) {
  // Send to monitoring service (Datadog, New Relic, etc.)
  this.metricsService.increment('fcm.notification', {
    success: success.toString(),
    failureReason: failureReason || 'none',
  });
}
```

**Key Performance Indicators (KPIs):**
- Push notification delivery rate (target: >95%)
- Average job completion time (target: <40s)
- Polling API load (requests/minute)
- Failed notification → email fallback rate
- User satisfaction with notification timing

---

## File Structure

```
src/
├── story/
│   ├── queue/
│   │   ├── story-queue.service.ts        ✅ DONE
│   │   ├── story.processor.ts            ✅ DONE (with FCM + SSE)
│   │   ├── story-queue.constants.ts      ✅ DONE
│   │   ├── story-job.interface.ts        ✅ DONE
│   │   └── index.ts                      ✅ DONE
│   ├── story.controller.ts               ✅ DONE (6 new endpoints)
│   └── story.module.ts                   ✅ DONE (queue + NotificationModule)
│
├── voice/
│   ├── queue/
│   │   ├── voice-queue.service.ts        ✅ DONE
│   │   ├── voice.processor.ts            ✅ DONE (with FCM + SSE)
│   │   ├── voice-queue.constants.ts      ✅ DONE
│   │   ├── voice-job.interface.ts        ✅ DONE
│   │   └── index.ts                      ✅ DONE
│   └── voice.module.ts                   ✅ DONE (queue + NotificationModule)
│
├── notification/
│   ├── services/
│   │   ├── fcm.service.ts                ✅ DONE (Phase 2A)
│   │   ├── device-token.service.ts       ✅ DONE (Phase 2A)
│   │   └── job-events.service.ts         ✅ DONE (SSE events)
│   ├── device.controller.ts              ✅ DONE (device registration)
│   ├── sse.controller.ts                 ✅ DONE (SSE endpoints)
│   ├── email-queue.service.ts            ✅ EXISTS
│   └── notification.module.ts            ✅ DONE (updated)
│
└── prisma/
    └── schema.prisma                     ✅ DONE (DeviceToken + DevicePlatform)
```

---

## Testing Strategy

### Unit Tests
```typescript
// fcm.service.spec.ts
describe('FcmService', () => {
  it('should send notification to all user devices', async () => {
    // Mock device tokens
    // Mock Firebase Admin SDK
    // Assert notification sent
  });

  it('should handle invalid tokens gracefully', async () => {
    // Test token cleanup
  });

  it('should fallback to email on FCM failure', async () => {
    // Test email fallback
  });
});

// story.processor.spec.ts (enhance existing)
describe('StoryProcessor notification', () => {
  it('should send push notification on job completion', async () => {
    // Test FCM call
  });

  it('should send failure notification on permanent failure', async () => {
    // Test failure notification
  });
});
```

### Integration Tests
```typescript
// story-notification.e2e-spec.ts
describe('Story Generation Notifications (E2E)', () => {
  it('should queue job and receive push notification', async () => {
    // 1. Register device token
    // 2. Queue story generation
    // 3. Wait for job completion
    // 4. Verify push notification sent
  });

  it('should handle push failure with email fallback', async () => {
    // 1. Register invalid device token
    // 2. Queue story generation
    // 3. Wait for job completion
    // 4. Verify email fallback sent
  });
});
```

### Manual Testing Checklist
- [ ] Test on real iOS device
- [ ] Test on real Android device
- [ ] Test with app in foreground
- [ ] Test with app in background
- [ ] Test with app fully closed
- [ ] Test with airplane mode enabled during generation
- [ ] Test notification tap → deep link
- [ ] Test multiple queued jobs
- [ ] Test notification when battery saver is on
- [ ] Test with Do Not Disturb mode enabled

---

## Security Considerations

### Device Token Security
```typescript
// Only allow users to manage their own device tokens
@Delete('devices/:token')
@UseGuards(AuthSessionGuard)
async unregisterDevice(
  @Req() req: AuthenticatedRequest,
  @Param('token') token: string,
) {
  // Verify ownership before deletion
  const device = await this.prisma.deviceToken.findUnique({
    where: { token },
  });
  
  if (!device || device.userId !== req.authUserData.userId) {
    throw new ForbiddenException('Cannot unregister another user\'s device');
  }
  
  return this.userService.unregisterDeviceToken(req.authUserData.userId, token);
}
```

### FCM Payload Security
```typescript
// Never send sensitive data in notification payload
// ❌ BAD: Include full story content
await this.fcmService.sendToUser({
  data: {
    storyContent: result.story.textContent, // DON'T DO THIS
  },
});

// ✅ GOOD: Send only IDs, fetch data after notification tap
await this.fcmService.sendToUser({
  data: {
    storyId: result.storyId,
    action: 'open_story',
  },
});
```

### Rate Limiting
```typescript
// Prevent notification spam
@Post('devices/register')
@UseGuards(AuthSessionGuard)
@Throttle({ default: { limit: 10, ttl: 60000 } }) // 10 per minute
async registerDevice(...) { }
```

---

## Cost Considerations

### Firebase Cloud Messaging (FCM)
- **Free tier**: Unlimited notifications
- **Cost**: $0 (Google subsidizes FCM)
- **Note**: No charges for FCM, only for Firebase hosting/storage if used

### Alternative: AWS SNS
- **Cost**: $0.50 per 1 million notifications
- **Pros**: AWS integration, flexible
- **Cons**: More complex setup, requires AWS account

### Recommendation
Use FCM for mobile push notifications (free, reliable, well-documented).

---

## Migration Path (If Coming from Polling-Only)

### Step 1: Add FCM alongside polling (parallel run)
- Keep existing polling endpoints
- Add push notifications
- Monitor delivery rates

### Step 2: Update mobile app
- Add FCM integration
- Keep polling as fallback
- Track which users receive push vs poll-only

### Step 3: Optimize polling
- Reduce polling frequency for users with push enabled
- Increase polling intervals
- Eventually deprecate aggressive polling

### Step 4: Monitor and iterate
- Track notification delivery success rate
- Monitor battery impact reports
- Gather user feedback

---

## Related Documentation

- **Queue Implementation**: See `src/story/queue/` for current code
- **COORDINATION.md**: Instance 17 - Async Story Generation Queue System
- **NotificationService**: Existing email notification infrastructure
- **BullMQ Docs**: https://docs.bullmq.io/
- **FCM Docs**: https://firebase.google.com/docs/cloud-messaging
- **Expo Push Notifications**: https://docs.expo.dev/push-notifications/overview/

---

## Questions / Discussion

**Q: Should we send progress updates via push (30%, 50%, 70%)?**  
A: **No**. Each notification interrupts the user. Send only:
- ✅ Job completed (always)
- ✅ Job failed after all retries (permanent failures only)
- ❌ Progress updates (use polling for these when app is active)

**Q: What if user has multiple devices?**  
A: Send to all registered device tokens. User will see notification on all devices (expected behavior).

**Q: Should we batch notifications?**  
A: **No**. Our use case is immediate notification per job. Batching adds delay and complexity.

**Q: What about web app support?**  
A: Web apps can use:
- Browser Push API (similar to mobile push)
- WebSockets (since web doesn't background like mobile)
- Server-Sent Events (simpler than WebSockets)

For web, WebSockets might be better than mobile push. Consider separate implementation for web vs mobile.

---

**Last Updated**: 2026-02-12
**Phase 2 Completed**: FCM push notifications for mobile + SSE for web clients

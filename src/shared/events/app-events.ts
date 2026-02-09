/**
 * Application-wide event constants and payload types.
 *
 * Events enable decoupled, scalable architecture where services
 * don't need to know about all side effects of their actions.
 *
 * Usage:
 * - Emit: this.eventEmitter.emit(AppEvents.USER_REGISTERED, payload)
 * - Listen: @OnEvent(AppEvents.USER_REGISTERED)
 */

// =============================================================================
// EVENT CONSTANTS
// =============================================================================

export const AppEvents = {
  // User lifecycle events
  USER_REGISTERED: 'user.registered',
  USER_DELETED: 'user.deleted',
  USER_EMAIL_VERIFIED: 'user.email_verified',
  USER_PASSWORD_CHANGED: 'user.password_changed',

  // Kid lifecycle events
  KID_CREATED: 'kid.created',
  KID_DELETED: 'kid.deleted',

  // Story lifecycle events
  STORY_CREATED: 'story.created',
  STORY_COMPLETED: 'story.completed',
  STORY_PROGRESS_UPDATED: 'story.progress_updated',

  // Payment & Subscription events
  PAYMENT_COMPLETED: 'payment.completed',
  PAYMENT_FAILED: 'payment.failed',
  SUBSCRIPTION_CREATED: 'subscription.created',
  SUBSCRIPTION_CHANGED: 'subscription.changed',
  SUBSCRIPTION_CANCELLED: 'subscription.cancelled',

  // Achievement events (existing)
  BADGE_EARNED: 'badge.earned',
  STREAK_UPDATED: 'streak.updated',

  // Notification events
  NOTIFICATION_SENT: 'notification.sent',
} as const;

export type AppEventName = (typeof AppEvents)[keyof typeof AppEvents];

// =============================================================================
// EVENT PAYLOAD TYPES
// =============================================================================

// User Events
export interface UserRegisteredEvent {
  userId: string;
  email: string;
  name: string | null;
  role: string;
  registeredAt: Date;
}

export interface UserDeletedEvent {
  userId: string;
  email: string;
  deletedAt: Date;
  reason?: string;
}

export interface UserEmailVerifiedEvent {
  userId: string;
  email: string;
  verifiedAt: Date;
}

export interface UserPasswordChangedEvent {
  userId: string;
  changedAt: Date;
  /** Whether other sessions were invalidated */
  sessionsInvalidated: boolean;
}

// Kid Events
export interface KidCreatedEvent {
  kidId: string;
  parentId: string;
  name: string | null;
  ageRange: string | null;
  createdAt: Date;
}

export interface KidDeletedEvent {
  kidId: string;
  parentId: string;
  deletedAt: Date;
}

// Story Events
export interface StoryCreatedEvent {
  storyId: string;
  title: string;
  /** Kid ID if AI-generated for a specific kid */
  creatorKidId?: string;
  aiGenerated: boolean;
  createdAt: Date;
}

export interface StoryCompletedEvent {
  storyId: string;
  kidId: string;
  /** Listening duration in seconds */
  durationSeconds: number;
  /** Completion percentage (0-100) */
  completionPercentage: number;
  completedAt: Date;
}

export interface StoryProgressUpdatedEvent {
  storyId: string;
  kidId: string;
  /** Progress percentage (0-100) */
  progress: number;
  /** Current position in seconds */
  currentPosition: number;
  updatedAt: Date;
}

// Payment Events
export interface PaymentCompletedEvent {
  paymentId: string;
  userId: string;
  amount: number;
  currency: string;
  /** Payment provider (stripe, apple, google) */
  provider: string;
  /** Associated subscription ID if applicable */
  subscriptionId?: string;
  completedAt: Date;
}

export interface PaymentFailedEvent {
  paymentId?: string;
  userId: string;
  amount: number;
  currency: string;
  provider: string;
  /** Error code from payment provider */
  errorCode?: string;
  errorMessage?: string;
  failedAt: Date;
}

// Subscription Events
export interface SubscriptionCreatedEvent {
  subscriptionId: string;
  userId: string;
  planId: string;
  planName: string;
  provider: string;
  createdAt: Date;
}

export interface SubscriptionChangedEvent {
  subscriptionId: string;
  userId: string;
  previousPlanId: string;
  newPlanId: string;
  previousPlanName: string;
  newPlanName: string;
  /** 'upgrade' | 'downgrade' | 'renewal' */
  changeType: 'upgrade' | 'downgrade' | 'renewal';
  changedAt: Date;
}

export interface SubscriptionCancelledEvent {
  subscriptionId: string;
  userId: string;
  planId: string;
  /** When the subscription will actually end */
  effectiveEndDate: Date;
  cancelledAt: Date;
  reason?: string;
}

// Achievement Events (typed versions of existing events)
export interface BadgeEarnedEvent {
  kidId: string;
  badgeId: string;
  badgeName: string;
  earnedAt: Date;
}

export interface StreakUpdatedEvent {
  kidId: string;
  currentStreak: number;
  longestStreak: number;
  updatedAt: Date;
}

// Notification Events
export interface NotificationSentEvent {
  notificationId: string;
  userId: string;
  category: string;
  type: 'push' | 'in_app' | 'email';
  sentAt: Date;
}

// =============================================================================
// EVENT PAYLOAD MAP (for type-safe event handling)
// =============================================================================

export interface AppEventPayloads {
  [AppEvents.USER_REGISTERED]: UserRegisteredEvent;
  [AppEvents.USER_DELETED]: UserDeletedEvent;
  [AppEvents.USER_EMAIL_VERIFIED]: UserEmailVerifiedEvent;
  [AppEvents.USER_PASSWORD_CHANGED]: UserPasswordChangedEvent;
  [AppEvents.KID_CREATED]: KidCreatedEvent;
  [AppEvents.KID_DELETED]: KidDeletedEvent;
  [AppEvents.STORY_CREATED]: StoryCreatedEvent;
  [AppEvents.STORY_COMPLETED]: StoryCompletedEvent;
  [AppEvents.STORY_PROGRESS_UPDATED]: StoryProgressUpdatedEvent;
  [AppEvents.PAYMENT_COMPLETED]: PaymentCompletedEvent;
  [AppEvents.PAYMENT_FAILED]: PaymentFailedEvent;
  [AppEvents.SUBSCRIPTION_CREATED]: SubscriptionCreatedEvent;
  [AppEvents.SUBSCRIPTION_CHANGED]: SubscriptionChangedEvent;
  [AppEvents.SUBSCRIPTION_CANCELLED]: SubscriptionCancelledEvent;
  [AppEvents.BADGE_EARNED]: BadgeEarnedEvent;
  [AppEvents.STREAK_UPDATED]: StreakUpdatedEvent;
  [AppEvents.NOTIFICATION_SENT]: NotificationSentEvent;
}

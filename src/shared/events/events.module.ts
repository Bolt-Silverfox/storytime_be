import { Module } from '@nestjs/common';
import { EventListenersService } from './event-listeners.service';
import { PrismaModule } from '@/prisma/prisma.module';
import { SubscriptionModule } from '@/subscription/subscription.module';
import { AnalyticsEventListener } from '../listeners/analytics-event.listener';
import { ActivityLogEventListener } from '../listeners/activity-log-event.listener';
import { SubscriptionCacheListener } from '../listeners/subscription-cache.listener';
import { KidCacheListener } from '../listeners/kid-cache.listener';
import { UserCleanupListener } from '../listeners/user-cleanup.listener';

/**
 * Events Module
 *
 * Provides the global event listeners service for cross-cutting concerns.
 * Import this module in SharedModule to enable application-wide event handling.
 *
 * Note: EventEmitterModule.forRoot() is configured in AppModule.
 * This module provides:
 * - EventListenersService: Basic event logging
 * - AnalyticsEventListener: Analytics tracking for business metrics
 * - ActivityLogEventListener: Database audit trail logging
 * - SubscriptionCacheListener: Cache invalidation on subscription events
 * - KidCacheListener: Cache invalidation on kid lifecycle events
 * - UserCleanupListener: GDPR cleanup on user deletion
 */
@Module({
  imports: [PrismaModule, SubscriptionModule],
  providers: [
    EventListenersService,
    AnalyticsEventListener,
    ActivityLogEventListener,
    SubscriptionCacheListener,
    KidCacheListener,
    UserCleanupListener,
  ],
  exports: [
    EventListenersService,
    AnalyticsEventListener,
    ActivityLogEventListener,
    SubscriptionCacheListener,
    KidCacheListener,
    UserCleanupListener,
  ],
})
export class EventsModule {}

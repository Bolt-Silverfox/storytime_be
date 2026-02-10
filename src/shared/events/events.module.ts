import { Module } from '@nestjs/common';
import { EventListenersService } from './event-listeners.service';
import { PrismaModule } from '@/prisma/prisma.module';
import { AnalyticsEventListener } from '../listeners/analytics-event.listener';
import { ActivityLogEventListener } from '../listeners/activity-log-event.listener';

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
 */
@Module({
  imports: [PrismaModule],
  providers: [
    EventListenersService,
    AnalyticsEventListener,
    ActivityLogEventListener,
  ],
  exports: [
    EventListenersService,
    AnalyticsEventListener,
    ActivityLogEventListener,
  ],
})
export class EventsModule {}

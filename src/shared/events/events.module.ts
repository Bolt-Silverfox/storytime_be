import { Module } from '@nestjs/common';
import { EventListenersService } from './event-listeners.service';

/**
 * Events Module
 *
 * Provides the global event listeners service for cross-cutting concerns.
 * Import this module in SharedModule to enable application-wide event handling.
 *
 * Note: EventEmitterModule.forRoot() is configured in AppModule.
 * This module only provides the listener service.
 */
@Module({
  providers: [EventListenersService],
  exports: [EventListenersService],
})
export class EventsModule {}

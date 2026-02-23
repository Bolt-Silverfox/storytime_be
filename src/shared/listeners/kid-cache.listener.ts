import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { AppEvents, KidCreatedEvent, KidDeletedEvent } from '@/shared/events';
import { CACHE_KEYS } from '@/shared/constants/cache-keys.constants';

/**
 * Listens to kid lifecycle events and invalidates related caches.
 * Decouples cache management from KidService business logic.
 */
@Injectable()
export class KidCacheListener {
  private readonly logger = new Logger(KidCacheListener.name);

  constructor(@Inject(CACHE_MANAGER) private readonly cacheManager: Cache) {}

  @OnEvent(AppEvents.KID_CREATED)
  async onKidCreated(event: KidCreatedEvent): Promise<void> {
    await this.cacheManager.del(CACHE_KEYS.USER_KIDS(event.parentId));
    this.logger.debug(`Cache invalidated for new kid: parent ${event.parentId.substring(0, 8)}`);
  }

  @OnEvent(AppEvents.KID_DELETED)
  async onKidDeleted(event: KidDeletedEvent): Promise<void> {
    await Promise.all([
      this.cacheManager.del(CACHE_KEYS.KID_PROFILE(event.kidId)),
      this.cacheManager.del(CACHE_KEYS.USER_KIDS(event.parentId)),
    ]);
    this.logger.debug(`Cache invalidated for deleted kid: ${event.kidId.substring(0, 8)}`);
  }
}

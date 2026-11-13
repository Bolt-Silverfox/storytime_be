import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '@/redis/redis.service';
import {
  GUEST_STORY_LIMIT,
  GuestSessionService,
} from '@/guest/guest-session.service';

const UUID_V4_LIKE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CLAIM_TTL_SECONDS = 30 * 24 * 60 * 60;

@Injectable()
export class PasswordlessGuestMergeService {
  private readonly logger = new Logger(PasswordlessGuestMergeService.name);

  constructor(
    private readonly guestSessions: GuestSessionService,
    private readonly redis: RedisService,
  ) {}

  async carryOver(
    userId: string,
    guestSessionId: string,
    isNewUser: boolean,
  ): Promise<void> {
    if (!UUID_V4_LIKE.test(guestSessionId)) return;
    const sid = guestSessionId.toLowerCase();

    const claimKey = `pwl:guest-claim:${sid}`;
    const pending = `${userId}:pending`;
    const claimed = isNewUser
      ? await this.redis.client.set(
          claimKey,
          pending,
          'EX',
          CLAIM_TTL_SECONDS,
          'NX',
        )
      : null;
    if (
      claimed !== 'OK' &&
      (await this.redis.client.get(claimKey)) !== pending
    ) {
      return;
    }

    const history = await this.guestSessions.getGuestReadingHistory(sid);
    if (!history) return;

    const storyIds = Object.keys(history).slice(0, GUEST_STORY_LIMIT);
    const existing =
      storyIds.length > 0
        ? await this.guestSessions.getStoryDetailsByIds(storyIds)
        : [];
    for (const story of existing) {
      await this.guestSessions.createUserStoryProgressIfAbsent(
        userId,
        story.id,
      );
    }
    await this.guestSessions.deleteGuestSession(sid);
    await this.redis.client.set(
      claimKey,
      `${userId}:done`,
      'EX',
      CLAIM_TTL_SECONDS,
    );
    this.logger.log(
      `Carried over ${existing.length} guest stories for user ${userId.slice(0, 8)}`,
    );
  }
}

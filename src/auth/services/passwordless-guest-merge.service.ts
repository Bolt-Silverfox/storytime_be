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
    if (!isNewUser || !UUID_V4_LIKE.test(guestSessionId)) return;

    const claimed = await this.redis.client.set(
      `pwl:guest-claim:${guestSessionId.toLowerCase()}`,
      '1',
      'EX',
      CLAIM_TTL_SECONDS,
      'NX',
    );
    if (claimed !== 'OK') return;

    const history =
      await this.guestSessions.getGuestReadingHistory(guestSessionId);
    if (!history) return;

    const storyIds = Object.keys(history).slice(0, GUEST_STORY_LIMIT);
    const existing =
      storyIds.length > 0
        ? await this.guestSessions.getStoryDetailsByIds(storyIds)
        : [];
    for (const story of existing) {
      await this.guestSessions.upsertUserStoryProgress(
        userId,
        story.id,
        0,
        false,
      );
    }
    await this.guestSessions.deleteGuestSession(guestSessionId);
    this.logger.log(
      `Carried over ${existing.length} guest stories for user ${userId.slice(0, 8)}`,
    );
  }
}

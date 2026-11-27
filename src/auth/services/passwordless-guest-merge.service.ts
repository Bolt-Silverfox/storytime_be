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

    let history = await this.guestSessions.getGuestReadingHistory(sid);
    if (!history) return;

    const carried = new Set<string>();
    for (let round = 0; round <= GUEST_STORY_LIMIT; round++) {
      await this.copyStories(userId, history, carried);
      const retired = await this.guestSessions.deleteGuestSessionIfHistoryIs(
        sid,
        Object.keys(history),
      );
      if (retired.deleted) {
        await this.redis.client.set(
          claimKey,
          `${userId}:done`,
          'EX',
          CLAIM_TTL_SECONDS,
        );
        this.logger.log(
          `Carried over ${carried.size} guest stories for user ${userId.slice(0, 8)}`,
        );
        return;
      }
      history = retired.history;
    }
    this.logger.warn(
      `Guest history kept changing; carry-over left pending for user ${userId.slice(0, 8)}`,
    );
  }

  private async copyStories(
    userId: string,
    history: Record<string, unknown>,
    carried: Set<string>,
  ): Promise<void> {
    const storyIds = Object.keys(history)
      .slice(0, GUEST_STORY_LIMIT)
      .filter((storyId) => !carried.has(storyId));
    const existing =
      storyIds.length > 0
        ? await this.guestSessions.getStoryDetailsByIds(storyIds)
        : [];
    for (const story of existing) {
      await this.guestSessions.createUserStoryProgressIfAbsent(
        userId,
        story.id,
      );
      carried.add(story.id);
    }
  }
}

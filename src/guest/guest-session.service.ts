import {
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  GUEST_REPOSITORY,
  type GuestStoryDetail,
  type GuestUserHistoryRow,
  type GuestUserProgressRow,
  type IGuestRepository,
} from './repositories/guest.repository.interface';
import { randomUUID } from 'node:crypto';
import Keyv from 'keyv';
import KeyvRedis from '@keyv/redis';
import { CacheableMemory } from 'cacheable';

/**
 * Discriminated result type for guest story access recording
 */
export type GuestStoryAccessResult =
  | { recorded: true }
  | {
      recorded: false;
      reason: 'already_read' | 'quota_exceeded' | 'session_not_found';
    };

/**
 * Reading progress entry for a story
 */
export interface StoryProgress {
  /** Progress percentage (0-100) */
  progress: number;
  /** Whether the story has been finished/completed (monotonic once true) */
  completed?: boolean;
  /** Timestamp when the story was last read */
  lastReadAt: Date;
}

/**
 * Guest session data structure
 */
export interface GuestSession {
  /** Unique session identifier */
  sessionId: string;
  /** Timestamp when the session was created */
  createdAt: Date;
  /** Timestamp when the session was last active */
  lastActiveAt: Date;
  /** Map of story IDs to their reading progress */
  readingHistory: Record<string, StoryProgress>;
  /** Number of unique stories read (for quota tracking) */
  uniqueStoriesRead: number;
}

/**
 * Redis key prefix for guest sessions
 */
const GUEST_SESSION_PREFIX = 'guest:session:';
/**
 * TTL for guest sessions in milliseconds (7 days)
 */
const GUEST_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/**
 * TTL for guest sessions in seconds (7 days) — used in API responses
 */
export const GUEST_SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
/**
 * GUEST story limit
 */
export const GUEST_STORY_LIMIT = 3; // Guests can read 3 unique stories per session

/**
 * Service for managing guest sessions and tracking reading progress.
 * Uses Redis via Keyv for persistence, with in-memory fallback for local development.
 */
@Injectable()
export class GuestSessionService implements OnModuleInit {
  private readonly logger = new Logger(GuestSessionService.name);
  private keyv: Keyv;
  private readonly redisUrl: string;

  constructor(
    private readonly configService: ConfigService,
    @Inject(GUEST_REPOSITORY)
    private readonly guestRepository: IGuestRepository,
  ) {
    this.redisUrl =
      this.configService.get<string>('REDIS_URL') || 'redis://localhost:6379';
    // Default to an in-memory store. onModuleInit upgrades to Redis only if a
    // real set->get round-trips. We deliberately do NOT hot-swap the store on
    // runtime 'error' events: the previous implementation replaced `this.keyv`
    // with a *fresh empty* instance mid-request, so a value written by `set`
    // was lost and the immediate read-back returned undefined (500).
    this.keyv = this.createMemoryKeyv();
  }

  /**
   * Probe Redis once at startup. Use it for persistence only if a set->get
   * round-trips; otherwise keep the in-memory store. This makes the store
   * selection deterministic and race-free.
   */
  async onModuleInit(): Promise<void> {
    let redisKeyv: Keyv | undefined;
    try {
      // throwOnConnectError:false lets the underlying node-redis client
      // reconnect on a transient socket close (e.g. Redis' `timeout` idle
      // disconnect) instead of throwing. A throw here would surface as an
      // unhandled error and crash the whole process (this was the cause of an
      // intermittent crash-loop on green).
      const store = new KeyvRedis(this.redisUrl, {
        throwOnConnectError: false,
      });

      // The node-redis client's own errors MUST always have a listener, or a
      // socket close is emitted as an unhandled 'error' and crashes the
      // process. Log it and let node-redis auto-reconnect; do not tear down
      // the shared store on a transient blip.
      store.on('error', (err: Error) => {
        this.logger.warn(
          `Guest-session Redis store error (auto-reconnecting): ${err?.message ?? err}`,
        );
      });

      redisKeyv = new Keyv({ store });
      this.attachKeyvErrorHandler(redisKeyv);

      const probeKey = `${GUEST_SESSION_PREFIX}__healthcheck__`;
      await redisKeyv.set(probeKey, '1', 10_000);
      const ok = await redisKeyv.get<string>(probeKey);
      if (ok === '1') {
        await redisKeyv.delete(probeKey);
        this.keyv = redisKeyv;
        this.logger.log('GuestSessionService using Redis for persistence');
        return;
      }
      this.logger.warn(
        'Redis health-check did not round-trip; using in-memory store for guest sessions',
      );
    } catch (err) {
      this.logger.warn(
        `Redis unavailable for guest sessions (${(err as Error)?.message}); using in-memory store`,
      );
    }

    // Redis unusable: drop the probe client so it stops retrying in the
    // background, and keep the in-memory store created in the constructor.
    if (redisKeyv) {
      try {
        await redisKeyv.disconnect();
      } catch {
        /* best-effort cleanup */
      }
    }
  }

  private createMemoryKeyv(): Keyv {
    const keyv = new Keyv({
      store: new CacheableMemory({
        ttl: GUEST_SESSION_TTL_MS,
        lruSize: 1000,
      }),
    });
    this.attachKeyvErrorHandler(keyv);
    return keyv;
  }

  /**
   * Keyv is an EventEmitter and an 'error' event with no listener throws
   * (crashing the process). Always attach a handler.
   */
  private attachKeyvErrorHandler(keyv: Keyv): void {
    keyv.on('error', (err: Error) => {
      this.logger.warn(`Guest-session cache error: ${err?.message ?? err}`);
    });
  }

  /**
   * Creates a new guest session with a unique UUID
   * @returns The newly created guest session
   */
  async createGuestSession(): Promise<GuestSession> {
    const sessionId = randomUUID();
    const now = new Date();

    const session: GuestSession = {
      sessionId,
      createdAt: now,
      lastActiveAt: now,
      readingHistory: {},
      uniqueStoriesRead: 0,
    };

    const key = this.getSessionKey(sessionId);
    this.logger.debug(
      `Creating guest session with sessionId: ${this.maskSessionId(sessionId)}`,
    );
    await this.keyv.set(key, session, GUEST_SESSION_TTL_MS);

    // Verify the session was stored
    const stored = await this.keyv.get<GuestSession>(key);
    if (!stored) {
      this.logger.error(
        `Failed to store guest session with sessionId: ${this.maskSessionId(sessionId)}`,
      );
      throw new InternalServerErrorException(
        'Failed to create guest session. Please try again.',
      );
    }

    this.logger.debug(
      `Successfully stored guest session: ${this.maskSessionId(sessionId)}`,
    );

    this.logger.log(`Created guest session: ${this.maskSessionId(sessionId)}`);
    return session;
  }

  /**
   * Retrieves a guest session by its ID
   * @param sessionId - The session ID to retrieve
   * @returns The guest session data, or null if not found
   */
  async getGuestSession(sessionId: string): Promise<GuestSession | null> {
    if (!sessionId) {
      this.logger.warn('getGuestSession called with empty sessionId');
      return null;
    }

    const key = this.getSessionKey(sessionId);
    this.logger.debug(
      `Looking for guest session with sessionId: ${this.maskSessionId(sessionId)}`,
    );
    let session = await this.keyv.get<GuestSession>(key);

    // Fallback: check for old key format (before namespace fix)
    if (!session) {
      const oldKey = `guest:guest:session:${sessionId}`;
      this.logger.debug(
        `Trying old key format for sessionId: ${this.maskSessionId(sessionId)}`,
      );
      session = await this.keyv.get<GuestSession>(oldKey);
      if (session) {
        this.logger.debug(
          `Found session with old key format, migrating to new key`,
        );
        // Migrate to new key format
        await this.keyv.set(key, session, GUEST_SESSION_TTL_MS);
        await this.keyv.delete(oldKey);
      }
    }

    if (!session) {
      this.logger.warn(
        `Guest session not found for sessionId: ${this.maskSessionId(sessionId)}`,
      );
      return null;
    }

    this.logger.debug(`Found guest session: ${this.maskSessionId(sessionId)}`);

    // Convert date strings back to Date objects (cache may serialize as strings)
    session.createdAt = new Date(session.createdAt);
    session.lastActiveAt = new Date(session.lastActiveAt);
    for (const storyId in session.readingHistory) {
      session.readingHistory[storyId].lastReadAt = new Date(
        session.readingHistory[storyId].lastReadAt,
      );
    }

    return session;
  }

  /**
   * Updates the reading progress for a specific story in a guest session
   * @param sessionId - The session ID
   * @param storyId - The story ID
   * @param progress - Progress percentage (0-100)
   * @param completed - Explicit completion flag from the client (optional)
   * @returns The updated guest session, or null if session not found
   */
  async updateGuestProgress(
    sessionId: string,
    storyId: string,
    progress: number,
    completed?: boolean,
  ): Promise<GuestSession | null> {
    const session = await this.getGuestSession(sessionId);

    if (!session) {
      this.logger.warn(
        `Attempted to update progress for non-existent session: ${this.maskSessionId(sessionId)}`,
      );
      return null;
    }

    // Validate progress is between 0 and 100
    const clampedProgress = Math.max(0, Math.min(100, progress));

    // Completion is monotonic: once a story is finished it stays finished.
    // Derive it from the explicit flag or a full progress reading.
    const existing = session.readingHistory[storyId];
    const isCompleted =
      existing?.completed === true ||
      completed === true ||
      clampedProgress >= 100;

    // Update reading history when there is progress, a completion signal, or
    // an existing entry to preserve.
    if (clampedProgress > 0 || isCompleted || existing) {
      session.readingHistory[storyId] = {
        progress: clampedProgress,
        completed: isCompleted,
        lastReadAt: new Date(),
      };
    }

    // Update last active timestamp
    session.lastActiveAt = new Date();

    // Save back to cache with TTL refresh
    const key = this.getSessionKey(sessionId);
    await this.keyv.set(key, session, GUEST_SESSION_TTL_MS);

    this.logger.debug(
      `Updated progress for session ${this.maskSessionId(sessionId)}, story ${storyId}: ${clampedProgress}%`,
    );

    return session;
  }

  /**
   * Gets all stories read by a guest session
   * @param sessionId - The session ID
   * @returns Map of story IDs to their reading progress, or null if session not found
   */
  async getGuestReadingHistory(
    sessionId: string,
  ): Promise<Record<string, StoryProgress> | null> {
    const session = await this.getGuestSession(sessionId);

    if (!session) {
      return null;
    }

    return session.readingHistory;
  }

  /**
   * Gets the reading progress for a specific story in a guest session
   * @param sessionId - The session ID
   * @param storyId - The story ID
   * @returns The story progress, or null if session or story not found
   */
  async getStoryProgress(
    sessionId: string,
    storyId: string,
  ): Promise<StoryProgress | null> {
    const session = await this.getGuestSession(sessionId);

    if (!session) {
      return null;
    }

    return session.readingHistory[storyId] || null;
  }

  /**
   * Deletes a guest session from cache
   * @param sessionId - The session ID to delete
   */
  async deleteGuestSession(sessionId: string): Promise<void> {
    const key = this.getSessionKey(sessionId);
    await this.keyv.delete(key);
    this.logger.debug(
      `Deleted guest session: ${this.maskSessionId(sessionId)}`,
    );
  }

  /**
   * Records that a guest accessed a new unique story.
   * Performs quota check and consumption in a single read-modify-write cycle.
   * Note: Not truly transactional under Redis — Keyv does GET then SET without WATCH/MULTI.
   * The narrowed window is acceptable for guest sessions (single user per session, low stakes).
   * @param sessionId - The session ID
   * @param storyId - The story ID
   * @returns A discriminated result indicating success or the specific failure reason
   */
  async recordNewStoryAccess(
    sessionId: string,
    storyId: string,
  ): Promise<GuestStoryAccessResult> {
    const session = await this.getGuestSession(sessionId);

    if (!session) {
      this.logger.warn(
        `Attempted to record story access for non-existent session: ${this.maskSessionId(sessionId)}`,
      );
      return { recorded: false, reason: 'session_not_found' };
    }

    // Check if story was already read (re-reading is always free)
    if (session.readingHistory[storyId]) {
      return { recorded: false, reason: 'already_read' };
    }

    // Check quota before consuming
    if (session.uniqueStoriesRead >= GUEST_STORY_LIMIT) {
      return { recorded: false, reason: 'quota_exceeded' };
    }

    // This is a new story - increment counter
    session.uniqueStoriesRead += 1;

    // Add to reading history with 0 progress
    session.readingHistory[storyId] = {
      progress: 0,
      lastReadAt: new Date(),
    };

    // Update last active timestamp
    session.lastActiveAt = new Date();

    // Save back to cache with TTL refresh
    const key = this.getSessionKey(sessionId);
    await this.keyv.set(key, session, GUEST_SESSION_TTL_MS);

    this.logger.debug(
      `Recorded new story access for session ${this.maskSessionId(sessionId)}, story ${storyId}. Total: ${session.uniqueStoriesRead}`,
    );

    return { recorded: true };
  }

  /**
   * Gets the quota status for a guest session
   * @param sessionId - The session ID
   * @returns The quota status, or null if session not found
   */
  async getGuestQuotaStatus(sessionId: string): Promise<{
    isPremium: false;
    unlimited: false;
    used: number;
    baseLimit: number;
    totalAllowed: number;
    remaining: number;
  } | null> {
    const session = await this.getGuestSession(sessionId);

    if (!session) {
      return null;
    }

    return {
      isPremium: false,
      unlimited: false,
      used: session.uniqueStoriesRead,
      baseLimit: GUEST_STORY_LIMIT,
      totalAllowed: GUEST_STORY_LIMIT,
      remaining: Math.max(0, GUEST_STORY_LIMIT - session.uniqueStoriesRead),
    };
  }

  maskSessionId(id?: string): string {
    if (!id) return 'no_session_id';
    return id.slice(0, 8) + '...';
  }

  // ==================== Authenticated-user DB access ====================
  // Thin repository passthroughs so controllers never touch Prisma directly.

  /**
   * Upsert an authenticated user's reading progress for a story.
   */
  async upsertUserStoryProgress(
    userId: string,
    storyId: string,
    progress: number,
    markCompleted: boolean,
  ): Promise<void> {
    return this.guestRepository.upsertUserStoryProgress(
      userId,
      storyId,
      progress,
      markCompleted,
    );
  }

  /**
   * Get an authenticated user's active progress for a story.
   */
  async getUserStoryProgress(
    userId: string,
    storyId: string,
  ): Promise<GuestUserProgressRow | null> {
    return this.guestRepository.findUserStoryProgress(userId, storyId);
  }

  /**
   * Get a single non-deleted story's detail projection.
   */
  async getStoryDetail(storyId: string): Promise<GuestStoryDetail | null> {
    return this.guestRepository.findStoryDetail(storyId);
  }

  /**
   * Get an authenticated user's full reading history, newest first.
   */
  async getUserReadingHistory(userId: string): Promise<GuestUserHistoryRow[]> {
    return this.guestRepository.findUserReadingHistory(userId);
  }

  /**
   * Get detail projections for a set of non-deleted stories.
   */
  async getStoryDetailsByIds(storyIds: string[]): Promise<GuestStoryDetail[]> {
    return this.guestRepository.findStoryDetailsByIds(storyIds);
  }

  private getSessionKey(sessionId: string): string {
    return `${GUEST_SESSION_PREFIX}${sessionId}`;
  }
}

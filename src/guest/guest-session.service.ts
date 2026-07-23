import {
  Injectable,
  InternalServerErrorException,
  Logger,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
  // True once we've fallen back to the in-memory store (Redis unavailable).
  private usingMemory = false;

  constructor(private readonly configService: ConfigService) {
    const redisUrl =
      this.configService.get<string>('REDIS_URL') || 'redis://localhost:6379';

    // Try to use Redis, fall back to in-memory if it can't be initialised.
    try {
      // throwOnConnectError:false lets the underlying node-redis client
      // reconnect on a transient socket close (e.g. Redis' `timeout` idle
      // disconnect) instead of throwing. A throw here would surface as an
      // unhandled error and crash the whole process — taking auth/sessions
      // down with it (this was the cause of an intermittent crash-loop).
      const store = new KeyvRedis(redisUrl, { throwOnConnectError: false });

      // The node-redis client's own errors MUST always have a listener, or a
      // socket close is emitted as an unhandled 'error' and crashes the
      // process. Log it and let node-redis auto-reconnect; do not tear down
      // the shared store on a transient blip (that permanently downgraded to
      // a per-worker in-memory store, which isn't shared across the cluster).
      store.on('error', (err: Error) => {
        this.logger.warn(
          `Guest-session Redis store error (auto-reconnecting): ${err?.message ?? err}`,
        );
      });

      this.keyv = new Keyv({ store });
      this.attachKeyvErrorHandler(this.keyv);

      this.logger.log('GuestSessionService using Redis for persistence');
    } catch (err) {
      this.logger.warn(
        `Failed to initialise Redis for guest sessions, using in-memory cache: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      this.useInMemoryStore();
    }
  }

  /**
   * Verifies Redis is actually reachable at startup. `KeyvRedis` connects
   * lazily and, with `throwOnConnectError: false`, never throws — so the
   * constructor's try/catch can't detect a Redis that's simply down. Probe
   * with a bounded write here; if it can't complete, fall back to the
   * in-memory store so session ops don't fail silently against a dead Redis.
   * The probe is fully guarded (timeout + catch) so it can never hang or crash
   * startup — worst case it keeps the resilient Redis store.
   */
  async onModuleInit(): Promise<void> {
    if (this.usingMemory) {
      return;
    }
    const probeKey = this.getSessionKey('__redis_probe__');
    try {
      await Promise.race([
        (async () => {
          await this.keyv.set(probeKey, 1, 5000);
          await this.keyv.delete(probeKey);
        })(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Redis probe timed out')), 4000),
        ),
      ]);
      this.logger.log('Guest-session Redis connectivity verified');
    } catch (err) {
      this.logger.warn(
        `Redis unavailable at startup, using in-memory guest sessions: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      this.useInMemoryStore();
    }
  }

  /** Swap to the in-memory store (with an error handler attached). */
  private useInMemoryStore(): void {
    this.usingMemory = true;
    this.keyv = new Keyv({
      store: new CacheableMemory({
        ttl: GUEST_SESSION_TTL_MS,
        lruSize: 1000,
      }),
    });
    this.attachKeyvErrorHandler(this.keyv);
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

  private getSessionKey(sessionId: string): string {
    return `${GUEST_SESSION_PREFIX}${sessionId}`;
  }
}

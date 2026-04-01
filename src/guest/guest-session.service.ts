import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v4 as uuidv4 } from 'uuid';
import Keyv from 'keyv';
import KeyvRedis from '@keyv/redis';
import { CacheableMemory } from 'cacheable';

/**
 * Reading progress entry for a story
 */
export interface StoryProgress {
  /** Progress percentage (0-100) */
  progress: number;
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
export class GuestSessionService {
  private readonly logger = new Logger(GuestSessionService.name);
  private keyv: Keyv;

  constructor(private readonly configService: ConfigService) {
    const redisUrl =
      this.configService.get<string>('REDIS_URL') || 'redis://localhost:6379';

    // Try to use Redis, fall back to in-memory if connection fails
    try {
      this.keyv = new Keyv({
        store: new KeyvRedis(redisUrl, { throwOnConnectError: true }),
      });

      this.keyv.on('error', (err) => {
        this.logger.error(
          `Redis connection error, falling back to in-memory store: ${err.message}`,
        );
        // Switch to in-memory fallback
        this.keyv = new Keyv({
          store: new CacheableMemory({
            ttl: GUEST_SESSION_TTL_MS,
            lruSize: 1000,
          }),
        });
        // now using in-memory fallback
      });

      this.logger.log('GuestSessionService using Redis for persistence');
    } catch {
      this.logger.warn('Failed to connect to Redis, using in-memory cache');
      this.keyv = new Keyv({
        store: new CacheableMemory({
          ttl: GUEST_SESSION_TTL_MS,
          lruSize: 1000,
        }),
      });
    }
  }

  /**
   * Creates a new guest session with a unique UUID
   * @returns The newly created guest session
   */
  async createGuestSession(): Promise<GuestSession> {
    const sessionId = uuidv4();
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
   * @returns The updated guest session, or null if session not found
   */
  async updateGuestProgress(
    sessionId: string,
    storyId: string,
    progress: number,
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

    // Check if this is a new story (not previously in readingHistory)
    const isNewStory = !session.readingHistory[storyId];

    // Update reading history only when clampedProgress > 0
    if (clampedProgress > 0 || session.readingHistory[storyId]) {
      session.readingHistory[storyId] = {
        progress: clampedProgress,
        lastReadAt: new Date(),
      };
    }

    // If this is a new story, increment uniqueStoriesRead to keep quota in sync
    if (isNewStory && session.readingHistory[storyId]) {
      session.uniqueStoriesRead += 1;
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
   * Records that a guest accessed a new unique story
   * @param sessionId - The session ID
   * @param storyId - The story ID
   * @returns true if this was a new story (quota consumed), false if already read
   */
  async recordNewStoryAccess(
    sessionId: string,
    storyId: string,
  ): Promise<boolean> {
    const session = await this.getGuestSession(sessionId);

    if (!session) {
      this.logger.warn(
        `Attempted to record story access for non-existent session: ${this.maskSessionId(sessionId)}`,
      );
      return false;
    }

    // Check if story was already read
    if (session.readingHistory[storyId]) {
      return false; // Already read, no quota consumed
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

    return true;
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

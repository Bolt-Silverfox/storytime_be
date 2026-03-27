import { Inject, Injectable, Logger } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { v4 as uuidv4 } from 'uuid';

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
 * Service for managing guest sessions and tracking reading progress.
 * Uses the global CacheModule (Keyv + KeyvRedis) instead of a standalone Redis connection.
 */
@Injectable()
export class GuestSessionService {
  private readonly logger = new Logger(GuestSessionService.name);

  constructor(@Inject(CACHE_MANAGER) private readonly cacheManager: Cache) {}

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
    };

    const key = this.getSessionKey(sessionId);
    await this.cacheManager.set(key, session, GUEST_SESSION_TTL_MS);

    this.logger.debug(`Created guest session: ${sessionId}`);
    return session;
  }

  /**
   * Retrieves a guest session by its ID
   * @param sessionId - The session ID to retrieve
   * @returns The guest session data, or null if not found
   */
  async getGuestSession(sessionId: string): Promise<GuestSession | null> {
    if (!this.isValidUUID(sessionId)) {
      this.logger.warn(
        `Invalid guest session ID format: ${sessionId.slice(0, 50)}`,
      );
      return null;
    }

    const key = this.getSessionKey(sessionId);
    const session = await this.cacheManager.get<GuestSession>(key);

    if (!session) {
      return null;
    }

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
        `Attempted to update progress for non-existent session: ${sessionId}`,
      );
      return null;
    }

    // Validate progress is between 0 and 100
    const clampedProgress = Math.max(0, Math.min(100, progress));

    // Update reading history
    session.readingHistory[storyId] = {
      progress: clampedProgress,
      lastReadAt: new Date(),
    };

    // Update last active timestamp
    session.lastActiveAt = new Date();

    // Save back to cache with TTL refresh
    const key = this.getSessionKey(sessionId);
    await this.cacheManager.set(key, session, GUEST_SESSION_TTL_MS);

    this.logger.debug(
      `Updated progress for session ${sessionId}, story ${storyId}: ${clampedProgress}%`,
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
    await this.cacheManager.del(key);
    this.logger.debug(`Deleted guest session: ${sessionId}`);
  }

  private isValidUUID(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    );
  }

  private getSessionKey(sessionId: string): string {
    return `${GUEST_SESSION_PREFIX}${sessionId}`;
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EnvConfig } from '@/shared/config/env.validation';
import { v4 as uuidv4 } from 'uuid';
import Redis from 'ioredis';

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
 * TTL for guest sessions in seconds (7 days)
 */
const GUEST_SESSION_TTL = 7 * 24 * 60 * 60;

/**
 * Service for managing guest sessions and tracking reading progress
 */
@Injectable()
export class GuestSessionService {
  private readonly logger = new Logger(GuestSessionService.name);
  private readonly redis: Redis;

  constructor(private readonly configService: ConfigService<EnvConfig, true>) {
    const redisUrl = this.configService.get('REDIS_URL');
    if (!redisUrl) {
      throw new Error('REDIS_URL environment variable is not configured');
    }
    this.redis = new Redis(redisUrl, {
      maxRetriesPerRequest: null,
    });

    this.redis.on('error', (error) => {
      this.logger.error('Redis connection error:', error);
    });

    this.redis.on('connect', () => {
      this.logger.log('Redis connected for guest sessions');
    });
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
    };

    const key = this.getSessionKey(sessionId);
    await this.redis.setex(key, GUEST_SESSION_TTL, JSON.stringify(session));

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
    const data = await this.redis.get(key);

    if (!data) {
      return null;
    }

    try {
      const session = JSON.parse(data) as GuestSession;
      // Convert date strings back to Date objects
      session.createdAt = new Date(session.createdAt);
      session.lastActiveAt = new Date(session.lastActiveAt);

      // Convert reading history dates
      for (const storyId in session.readingHistory) {
        session.readingHistory[storyId].lastReadAt = new Date(
          session.readingHistory[storyId].lastReadAt,
        );
      }

      return session;
    } catch (error) {
      this.logger.error(`Failed to parse guest session ${sessionId}:`, error);
      return null;
    }
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

    // Save back to Redis with TTL refresh
    const key = this.getSessionKey(sessionId);
    await this.redis.setex(key, GUEST_SESSION_TTL, JSON.stringify(session));

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
   * Deletes a guest session from Redis
   * @param sessionId - The session ID to delete
   * @returns true if the session was deleted, false if it didn't exist
   */
  async deleteGuestSession(sessionId: string): Promise<boolean> {
    const key = this.getSessionKey(sessionId);
    const result = await this.redis.del(key);

    const deleted = result > 0;
    if (deleted) {
      this.logger.debug(`Deleted guest session: ${sessionId}`);
    }

    return deleted;
  }

  /**
   * Refreshes the TTL for a guest session (extends it by 7 days)
   * @param sessionId - The session ID to refresh
   * @returns true if the session was refreshed, false if it didn't exist
   */
  async refreshSessionTTL(sessionId: string): Promise<boolean> {
    const key = this.getSessionKey(sessionId);
    const result = await this.redis.expire(key, GUEST_SESSION_TTL);

    const refreshed = result === 1;
    if (refreshed) {
      this.logger.debug(`Refreshed TTL for guest session: ${sessionId}`);
    }

    return refreshed;
  }

  /**
   * Gets the remaining TTL for a guest session in seconds
   * @param sessionId - The session ID
   * @returns Remaining TTL in seconds, or -1 if session doesn't exist
   */
  async getSessionTTL(sessionId: string): Promise<number> {
    const key = this.getSessionKey(sessionId);
    return await this.redis.ttl(key);
  }

  /**
   * Generates the Redis key for a guest session
   * @param sessionId - The session ID
   * @returns The Redis key
   */
  private isValidUUID(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    );
  }

  private getSessionKey(sessionId: string): string {
    return `${GUEST_SESSION_PREFIX}${sessionId}`;
  }

  /**
   * Cleanup method to close Redis connection
   * Call this when shutting down the service
   */
  async onModuleDestroy(): Promise<void> {
    await this.redis.quit();
    this.logger.log('Redis connection closed for guest sessions');
  }
}

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Inject,
  Logger,
  NotFoundException,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { ThrottlerException, ThrottlerStorage } from '@nestjs/throttler';
import { GuestSessionService } from '@/guest/guest-session.service';
import { StoryService } from '../story/story.service';
import { TextToSpeechService } from '../story/text-to-speech.service';
import { TtsBatchQueueService } from './queue/tts-batch-queue.service';
import {
  GUEST_AUDIO_EAGER_PARAGRAPHS,
  GUEST_AUDIO_THROTTLE,
} from '@/shared/constants/guest-audio.constants';
import { nonProdThrottleMultiplier } from '@/shared/config/throttle.config';
import { DEFAULT_VOICE } from './voice.constants';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Story audio for guest sessions. Reuses the authed batch TTS pipeline
 * (eager first paragraphs + BullMQ background batch + status poll) and returns
 * the identical response shape, but:
 *  - the voice is forced to {@link DEFAULT_VOICE}; any client voiceId is ignored;
 *  - the cache is consulted first and any existing default-voice clip is
 *    served as-is (no queue job, no provider call on a full hit);
 *  - generation only happens for a story that is published and that this guest
 *    session has already opened (so it is inside the 3-story quota);
 *  - caps on paragraphs/characters are enforced in the TTS layer.
 */
@Injectable()
export class GuestStoryAudioService {
  private readonly logger = new Logger(GuestStoryAudioService.name);

  constructor(
    private readonly guestSessions: GuestSessionService,
    private readonly storyService: StoryService,
    private readonly tts: TextToSpeechService,
    private readonly queue: TtsBatchQueueService,
    @Optional()
    @Inject(ThrottlerStorage)
    private readonly throttlerStorage?: ThrottlerStorage,
  ) {}

  /**
   * One hourly per-IP counter shared by every route that starts guest audio
   * (/guest/stories/:id/audio and /voice/story/audio/batch). @nestjs/throttler
   * keys counters per class+handler, so decorators alone cannot share one.
   * Fails open (no IP, storage error) so it can never block on its own fault.
   */
  async checkIpCap(ip: string | undefined): Promise<void> {
    if (!ip || !this.throttlerStorage) return;
    const { limit, ttl } = GUEST_AUDIO_THROTTLE.start.ipPerHour;
    let record: Awaited<ReturnType<ThrottlerStorage['increment']>>;
    try {
      record = await this.throttlerStorage.increment(
        `guest-audio-ip:${ip}`,
        ttl,
        limit * nonProdThrottleMultiplier(process.env.NODE_ENV),
        ttl,
        'guest-audio-ip-hour',
      );
    } catch (error) {
      this.logger.warn(
        `Guest audio IP limiter unavailable: ${(error as Error).message}`,
      );
      return;
    }
    if (record.isBlocked) throw new ThrottlerException();
  }

  private assertSessionId(sessionId: string | undefined): string {
    if (!sessionId) {
      throw new BadRequestException('x-guest-session-id header is required');
    }
    if (!UUID_REGEX.test(sessionId)) {
      throw new BadRequestException('Invalid session ID format');
    }
    return sessionId;
  }

  /**
   * Note there is deliberately NO voice parameter: guests cannot choose one.
   */
  async start(
    storyId: string,
    guestSessionId: string | undefined,
    ip?: string,
    // Set by callers that already ran checkIpCap (avoids double counting).
    opts?: { ipCapChecked?: boolean },
  ) {
    const sessionId = this.assertSessionId(guestSessionId);
    if (!opts?.ipCapChecked) await this.checkIpCap(ip);

    const session = await this.guestSessions.getGuestSession(sessionId);
    if (!session) {
      throw new UnauthorizedException(
        'Your guest session has expired. Please refresh the page to continue.',
      );
    }

    // Throws NotFoundException for missing, deleted or UNPUBLISHED stories.
    const story = await this.storyService.getStoryById(storyId);
    if (!story?.textContent?.trim()) {
      throw new NotFoundException('Story not found or has no content.');
    }

    // Generation is only for stories the session recorded access to via
    // GET /guest/stories/:id (which enforces the 3-story quota).
    if (!session.readingHistory?.[storyId]) {
      this.logger.warn(
        `Guest ${this.guestSessions.maskSessionId(sessionId)} requested audio for unopened story ${storyId}`,
      );
      throw new ForbiddenException('Open the story before requesting audio.');
    }

    // Serialise generation per (story, voice): a concurrent start waits for the
    // first, then hits the cache and joins its in-flight batch.
    const lock = await this.queue.acquireStartLock(storyId, DEFAULT_VOICE);
    let generated: Awaited<
      ReturnType<TextToSpeechService['batchTextToSpeechForGuest']>
    >;
    let batchJobId: string | undefined;
    let pendingParagraphs: number | undefined;
    try {
      // A batch already in flight owns the still-uncached paragraphs: look
      // them up (cache only, eagerCount 0) and join it rather than generating
      // them a second time inline.
      const inFlight = await this.queue.findInFlightBatch(
        storyId,
        DEFAULT_VOICE,
      );
      generated = await this.tts.batchTextToSpeechForGuest(
        storyId,
        story.textContent,
        { eagerCount: inFlight ? 0 : GUEST_AUDIO_EAGER_PARAGRAPHS },
      );
      const { remainingUncached, totalParagraphs, batchProvider } = generated;
      if (remainingUncached.length > 0) {
        try {
          batchJobId =
            inFlight ??
            (await this.queue.queueBatch({
              storyId,
              voiceId: DEFAULT_VOICE,
              userId: sessionId,
              isGuest: true,
              isPremium: false,
              provider: batchProvider,
              paragraphs: remainingUncached,
              totalParagraphs,
            }));
          pendingParagraphs = remainingUncached.length;
        } catch (error) {
          this.logger.error(
            `Failed to queue guest TTS batch for story ${storyId}: ${(error as Error).message}`,
          );
          // Return eager results without a batchJobId rather than a 500.
        }
      }
    } finally {
      await lock.release();
    }
    const {
      results: paragraphs,
      totalParagraphs,
      wasTruncated,
      usedProvider,
      remainingUncached,
    } = generated;

    const textByIndex = new Map<number, string>();
    for (const p of paragraphs) {
      if (typeof p.text === 'string') textByIndex.set(p.index, p.text);
    }
    for (const p of remainingUncached) {
      if (!textByIndex.has(p.index)) textByIndex.set(p.index, p.text);
    }
    const outline = [...textByIndex.entries()]
      .sort(([a], [b]) => a - b)
      .map(([index, text]) => ({ index, text }));

    return {
      message: 'Batch audio generated successfully',
      paragraphs,
      totalParagraphs,
      outline,
      wasTruncated,
      voiceId: DEFAULT_VOICE as string,
      usedProvider,
      ...(batchJobId ? { batchJobId } : {}),
      ...(pendingParagraphs !== undefined ? { pendingParagraphs } : {}),
      statusCode: 200,
    };
  }

  async status(
    storyId: string,
    batchJobId: string,
    guestSessionId: string | undefined,
  ) {
    const sessionId = this.assertSessionId(guestSessionId);
    const session = await this.guestSessions.getGuestSession(sessionId);
    if (!session) {
      throw new UnauthorizedException(
        'Your guest session has expired. Please refresh the page to continue.',
      );
    }
    // Scoped to the story in the URL; guest batches are shared by all guest
    // sessions on that story (concurrent starts join one batch).
    const status = await this.queue.getBatchStatus(batchJobId, sessionId, {
      storyId,
      allowSharedGuest: true,
    });
    if (!status) {
      throw new NotFoundException(
        'Batch not found or expired. Completed paragraphs remain usable.',
      );
    }
    return status;
  }
}

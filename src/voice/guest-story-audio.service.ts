import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { GuestSessionService } from '@/guest/guest-session.service';
import { StoryService } from '../story/story.service';
import { TextToSpeechService } from '../story/text-to-speech.service';
import { TtsBatchQueueService } from './queue/tts-batch-queue.service';
import { GUEST_AUDIO_EAGER_PARAGRAPHS } from '@/shared/constants/guest-audio.constants';
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
  ) {}

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
  async start(storyId: string, guestSessionId: string | undefined) {
    const sessionId = this.assertSessionId(guestSessionId);

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

    const {
      results: paragraphs,
      totalParagraphs,
      wasTruncated,
      usedProvider,
      remainingUncached,
      batchProvider,
    } = await this.tts.batchTextToSpeechForGuest(storyId, story.textContent, {
      eagerCount: GUEST_AUDIO_EAGER_PARAGRAPHS,
    });

    let batchJobId: string | undefined;
    let pendingParagraphs: number | undefined;
    if (remainingUncached.length > 0) {
      try {
        batchJobId = await this.queue.queueBatch({
          storyId,
          voiceId: DEFAULT_VOICE,
          userId: sessionId,
          isGuest: true,
          isPremium: false,
          provider: batchProvider,
          paragraphs: remainingUncached,
          totalParagraphs,
        });
        pendingParagraphs = remainingUncached.length;
      } catch (error) {
        this.logger.error(
          `Failed to queue guest TTS batch for story ${storyId}: ${(error as Error).message}`,
        );
        // Return eager results without a batchJobId rather than a 500.
      }
    }

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

  async status(batchJobId: string, guestSessionId: string | undefined) {
    const sessionId = this.assertSessionId(guestSessionId);
    const status = await this.queue.getBatchStatus(batchJobId, sessionId);
    if (!status) {
      throw new NotFoundException(
        'Batch not found or expired. Completed paragraphs remain usable.',
      );
    }
    return status;
  }
}

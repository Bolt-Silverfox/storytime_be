import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { GuestStoryAudioService } from './guest-story-audio.service';
import { DEFAULT_VOICE } from './voice.constants';

const SESSION = '3f0c6a7e-1b2d-4c3e-8f4a-5b6c7d8e9f01';
const STORY = '24fe8886-f166-4073-a173-636873caac31';

describe('GuestStoryAudioService', () => {
  let service: GuestStoryAudioService;
  let guestSessions: { getGuestSession: jest.Mock; maskSessionId: jest.Mock };
  let stories: { getStoryById: jest.Mock };
  let tts: { batchTextToSpeechForGuest: jest.Mock };
  let queue: { queueBatch: jest.Mock; getBatchStatus: jest.Mock };

  const eagerResult = (over: Record<string, unknown> = {}) => ({
    results: [
      { index: 0, text: 'one', audioUrl: 'https://a/0.mp3' },
      { index: 1, text: 'two', audioUrl: 'https://a/1.mp3' },
    ],
    totalParagraphs: 3,
    wasTruncated: false,
    usedProvider: 'deepgram',
    eagerFailed: false,
    remainingUncached: [] as Array<{
      index: number;
      text: string;
      hash: string;
    }>,
    batchProvider: 'deepgram',
    isPremium: false,
    ...over,
  });

  beforeEach(() => {
    guestSessions = {
      getGuestSession: jest.fn().mockResolvedValue({
        sessionId: SESSION,
        uniqueStoriesRead: 1,
        readingHistory: { [STORY]: { progress: 0 } },
      }),
      maskSessionId: jest.fn((s?: string) => `masked-${s?.slice(0, 4)}`),
    };
    stories = {
      getStoryById: jest
        .fn()
        .mockResolvedValue({ id: STORY, textContent: 'one two three' }),
    };
    tts = {
      batchTextToSpeechForGuest: jest.fn().mockResolvedValue(eagerResult()),
    };
    queue = {
      queueBatch: jest.fn().mockResolvedValue('batch-1'),
      getBatchStatus: jest.fn(),
    };
    service = new GuestStoryAudioService(
      guestSessions as never,
      stories as never,
      tts as never,
      queue as never,
    );
  });

  describe('start', () => {
    it('full cache hit: returns clips, queues nothing', async () => {
      const res = await service.start(STORY, SESSION, {});
      expect(res.paragraphs).toHaveLength(2);
      expect(res.batchJobId).toBeUndefined();
      expect(res.pendingParagraphs).toBeUndefined();
      expect(queue.queueBatch).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(200);
      expect(res.voiceId).toBe(DEFAULT_VOICE);
    });

    it('IGNORES a client-supplied voiceId and always uses the default voice', async () => {
      tts.batchTextToSpeechForGuest.mockResolvedValue(
        eagerResult({
          remainingUncached: [{ index: 2, text: 'three', hash: 'h2' }],
        }),
      );
      const res = await service.start(STORY, SESSION, {
        voiceId: 'XrExE9yKIg1WjnnlVkGX-someOtherVoice',
      });
      // the TTS facade has no voice parameter at all for guests
      const args = tts.batchTextToSpeechForGuest.mock.calls[0];
      expect(JSON.stringify(args)).not.toContain('someOtherVoice');
      expect(queue.queueBatch).toHaveBeenCalledWith(
        expect.objectContaining({
          voiceId: DEFAULT_VOICE,
          userId: SESSION,
          isGuest: true,
          isPremium: false,
          provider: 'deepgram',
          storyId: STORY,
        }),
      );
      expect(res.voiceId).toBe(DEFAULT_VOICE);
      expect(res.batchJobId).toBe('batch-1');
      expect(res.pendingParagraphs).toBe(1);
    });

    it('outline contains ready AND pending paragraphs in order', async () => {
      tts.batchTextToSpeechForGuest.mockResolvedValue(
        eagerResult({
          remainingUncached: [{ index: 2, text: 'three', hash: 'h2' }],
        }),
      );
      const res = await service.start(STORY, SESSION, {});
      expect(res.outline).toEqual([
        { index: 0, text: 'one' },
        { index: 1, text: 'two' },
        { index: 2, text: 'three' },
      ]);
    });

    it('still returns eager audio when the queue is unavailable', async () => {
      tts.batchTextToSpeechForGuest.mockResolvedValue(
        eagerResult({
          remainingUncached: [{ index: 2, text: 'three', hash: 'h2' }],
        }),
      );
      queue.queueBatch.mockRejectedValue(new Error('redis down'));
      const res = await service.start(STORY, SESSION, {});
      expect(res.paragraphs).toHaveLength(2);
      expect(res.batchJobId).toBeUndefined();
    });

    it('rejects a malformed session id (400) before touching anything', async () => {
      await expect(service.start(STORY, 'nope', {})).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(service.start(STORY, undefined, {})).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(guestSessions.getGuestSession).not.toHaveBeenCalled();
      expect(tts.batchTextToSpeechForGuest).not.toHaveBeenCalled();
    });

    it('rejects an expired/unknown session (401), no generation', async () => {
      guestSessions.getGuestSession.mockResolvedValue(null);
      await expect(service.start(STORY, SESSION, {})).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(tts.batchTextToSpeechForGuest).not.toHaveBeenCalled();
      expect(queue.queueBatch).not.toHaveBeenCalled();
    });

    it('rejects a story the session has not legitimately opened (403), no generation', async () => {
      guestSessions.getGuestSession.mockResolvedValue({
        sessionId: SESSION,
        uniqueStoriesRead: 3,
        readingHistory: { 'other-story': { progress: 0 } },
      });
      await expect(service.start(STORY, SESSION, {})).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(tts.batchTextToSpeechForGuest).not.toHaveBeenCalled();
      expect(queue.queueBatch).not.toHaveBeenCalled();
    });

    it('rejects unpublished / deleted / missing stories (404), no generation', async () => {
      // StoryService.getStoryById filters isPublished + isDeleted and throws.
      stories.getStoryById.mockRejectedValue(
        new NotFoundException('Story not found'),
      );
      await expect(service.start(STORY, SESSION, {})).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(tts.batchTextToSpeechForGuest).not.toHaveBeenCalled();
    });

    it('treats a story without text as not found', async () => {
      stories.getStoryById.mockResolvedValue({ id: STORY, textContent: '' });
      await expect(service.start(STORY, SESSION, {})).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(tts.batchTextToSpeechForGuest).not.toHaveBeenCalled();
    });
  });

  describe('status', () => {
    it('returns the batch scoped to the session id', async () => {
      queue.getBatchStatus.mockResolvedValue({
        status: 'processing',
        completedParagraphs: [],
        failedParagraphs: [],
        totalQueued: 1,
      });
      const res = await service.status('batch-1', SESSION);
      expect(queue.getBatchStatus).toHaveBeenCalledWith('batch-1', SESSION);
      expect(res.status).toBe('processing');
    });

    it('404s for a batch that is missing or belongs to someone else', async () => {
      queue.getBatchStatus.mockResolvedValue(null);
      await expect(service.status('batch-1', SESSION)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('400s on a malformed session id', async () => {
      await expect(service.status('batch-1', 'x')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(queue.getBatchStatus).not.toHaveBeenCalled();
    });
  });
});

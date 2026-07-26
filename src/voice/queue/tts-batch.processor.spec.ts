import { Job } from 'bullmq';
import { TtsBatchProcessor } from './tts-batch.processor';
import { TtsBatchJobData } from './tts-batch-job.interface';

const makeJob = (
  overrides: Partial<TtsBatchJobData> = {},
): Job<TtsBatchJobData> => {
  const data: TtsBatchJobData = {
    batchJobId: 'batch-1',
    storyId: 'story-1',
    voiceId: 'voice-1',
    userId: 'user-1',
    isPremium: false,
    provider: 'elevenlabs',
    paragraphs: [{ index: 0, text: 'hello', hash: 'h0' }],
    totalParagraphs: 1,
    ...overrides,
  };
  return { data } as unknown as Job<TtsBatchJobData>;
};

describe('TtsBatchProcessor', () => {
  let processor: TtsBatchProcessor;
  let queueService: {
    markParagraphCompleted: jest.Mock;
    markParagraphFailed: jest.Mock;
    updateBatchMeta: jest.Mock;
    getBatchStatus: jest.Mock;
    queueRetryBatch: jest.Mock;
  };
  let ttsService: { generateSingleParagraphTTS: jest.Mock };
  let jobEvents: {
    emitVoiceParagraphReady: jest.Mock;
    emitVoiceBatchCompleted: jest.Mock;
    emitFailed: jest.Mock;
  };

  beforeEach(() => {
    queueService = {
      markParagraphCompleted: jest.fn().mockResolvedValue(undefined),
      markParagraphFailed: jest.fn().mockResolvedValue(undefined),
      updateBatchMeta: jest.fn().mockResolvedValue(undefined),
      // Null snapshot → final status falls back to this run's local counts.
      getBatchStatus: jest.fn().mockResolvedValue(null),
      queueRetryBatch: jest.fn().mockResolvedValue(undefined),
    };
    ttsService = { generateSingleParagraphTTS: jest.fn() };
    jobEvents = {
      emitVoiceParagraphReady: jest.fn(),
      emitVoiceBatchCompleted: jest.fn(),
      emitFailed: jest.fn(),
    };

    processor = new TtsBatchProcessor(
      queueService as never,
      ttsService as never,
      { recordAttempt: jest.fn(), recordParagraph: jest.fn() } as never,
      jobEvents as never,
    );
  });

  describe('duplicate outcome counting', () => {
    it('counts every duplicate index on success', async () => {
      ttsService.generateSingleParagraphTTS.mockResolvedValue({
        audioUrl: 'https://audio/0',
      });

      const result = await processor.process(
        makeJob({
          paragraphs: [
            { index: 0, text: 'hi', hash: 'h0', duplicateIndices: [1, 2] },
          ],
          totalParagraphs: 3,
        }),
      );

      // One generated paragraph is persisted to all three positions, and the
      // completed counter must agree with the Redis writes.
      expect(queueService.markParagraphCompleted).toHaveBeenCalledTimes(3);
      expect(result.completedCount).toBe(3);
    });

    it('counts every duplicate index on failure', async () => {
      // The error rejects on every provider, so the paragraph exhausts the whole
      // fallback chain and is marked failed on all its duplicate positions.
      ttsService.generateSingleParagraphTTS.mockRejectedValue({ status: 400 });

      const result = await processor.process(
        makeJob({
          paragraphs: [
            { index: 0, text: 'hi', hash: 'h0', duplicateIndices: [1, 2] },
          ],
          totalParagraphs: 3,
        }),
      );

      expect(queueService.markParagraphFailed).toHaveBeenCalledTimes(3);
      expect(result.failedCount).toBe(3);
    });
  });

  describe('SSE emission', () => {
    it('announces each ready position (including duplicates) then completes', async () => {
      ttsService.generateSingleParagraphTTS.mockResolvedValue({
        audioUrl: 'https://audio/0',
      });

      await processor.process(
        makeJob({
          paragraphs: [
            { index: 0, text: 'hi', hash: 'h0', duplicateIndices: [1, 2] },
          ],
          totalParagraphs: 3,
        }),
      );

      // One generated paragraph lights up all three positions on the stream.
      expect(jobEvents.emitVoiceParagraphReady).toHaveBeenCalledTimes(3);
      for (const idx of [0, 1, 2]) {
        expect(jobEvents.emitVoiceParagraphReady).toHaveBeenCalledWith(
          'batch-1',
          'user-1',
          idx,
          'https://audio/0',
          expect.any(Number),
        );
      }
      // Terminal completion carries the batch tally; no failure emitted.
      expect(jobEvents.emitVoiceBatchCompleted).toHaveBeenCalledWith(
        'batch-1',
        'user-1',
        { totalParagraphs: 3, completedParagraphs: 3, failedParagraphs: 0 },
      );
      expect(jobEvents.emitFailed).not.toHaveBeenCalled();
    });

    it('emits a terminal failure when every paragraph fails and no retry remains', async () => {
      ttsService.generateSingleParagraphTTS.mockRejectedValue({ status: 400 });

      await processor.process(
        makeJob({
          paragraphs: [{ index: 0, text: 'hi', hash: 'h0' }],
          totalParagraphs: 1,
          // Already at the retry ceiling → no self-heal, so terminal fires now.
          retryGeneration: 2,
        }),
      );

      expect(jobEvents.emitVoiceParagraphReady).not.toHaveBeenCalled();
      expect(jobEvents.emitVoiceBatchCompleted).not.toHaveBeenCalled();
      expect(jobEvents.emitFailed).toHaveBeenCalledWith(
        'batch-1',
        'user-1',
        'voice',
        expect.any(String),
      );
    });

    it('withholds the terminal event while a self-heal retry is scheduled', async () => {
      ttsService.generateSingleParagraphTTS.mockRejectedValue({ status: 400 });

      await processor.process(
        makeJob({
          paragraphs: [{ index: 0, text: 'hi', hash: 'h0' }],
          totalParagraphs: 1,
          // generation 0 with a failure → a retry is queued, so neither
          // terminal event may fire yet (the retry generation will send it).
          retryGeneration: 0,
        }),
      );

      expect(queueService.queueRetryBatch).toHaveBeenCalled();
      expect(jobEvents.emitVoiceBatchCompleted).not.toHaveBeenCalled();
      expect(jobEvents.emitFailed).not.toHaveBeenCalled();
    });
  });
});

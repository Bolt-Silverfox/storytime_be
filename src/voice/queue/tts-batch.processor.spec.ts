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
    queueRetryBatch: jest.Mock;
    getBatchStatus: jest.Mock;
    updateBatchMeta: jest.Mock;
  };
  let ttsService: { generateSingleParagraphTTS: jest.Mock };

  beforeEach(() => {
    queueService = {
      markParagraphCompleted: jest.fn().mockResolvedValue(undefined),
      markParagraphFailed: jest.fn().mockResolvedValue(undefined),
      queueRetryBatch: jest.fn().mockResolvedValue(undefined),
      // null → processor falls back to this run's local counters.
      getBatchStatus: jest.fn().mockResolvedValue(null),
      updateBatchMeta: jest.fn().mockResolvedValue(undefined),
    };
    ttsService = { generateSingleParagraphTTS: jest.fn() };

    processor = new TtsBatchProcessor(
      queueService as never,
      ttsService as never,
    );
    // Skip real backoff delays.
    jest
      .spyOn(processor as unknown as { delay: () => Promise<void> }, 'delay')
      .mockResolvedValue(undefined);
  });

  describe('transient-only retry', () => {
    it('does NOT retry the same provider on a non-transient (4xx) error', async () => {
      ttsService.generateSingleParagraphTTS.mockRejectedValue({ status: 400 });

      const result = await processor.process(makeJob({ totalParagraphs: 1 }));

      // 3 providers in the chain, one attempt each — no same-provider retries.
      expect(ttsService.generateSingleParagraphTTS).toHaveBeenCalledTimes(3);
      expect(result.failedCount).toBe(1);
    });

    it('retries the same provider on a transient (5xx) error', async () => {
      ttsService.generateSingleParagraphTTS.mockRejectedValue({ status: 503 });

      await processor.process(makeJob({ totalParagraphs: 1 }));

      // 3 providers x 2 attempts each = 6 calls.
      expect(ttsService.generateSingleParagraphTTS).toHaveBeenCalledTimes(6);
    });
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

      expect(queueService.markParagraphCompleted).toHaveBeenCalledTimes(3);
      expect(result.completedCount).toBe(3);
    });

    it('counts every duplicate index on failure', async () => {
      ttsService.generateSingleParagraphTTS.mockRejectedValue({ status: 400 });

      const result = await processor.process(
        makeJob({
          paragraphs: [
            { index: 0, text: 'hi', hash: 'h0', duplicateIndices: [1, 2] },
          ],
          totalParagraphs: 3,
          // Cap generation so no self-heal round is scheduled.
          retryGeneration: 2,
        }),
      );

      expect(queueService.markParagraphFailed).toHaveBeenCalledTimes(3);
      expect(result.failedCount).toBe(3);
    });
  });

  describe('self-heal scheduling failures', () => {
    it('propagates a queueRetryBatch failure instead of swallowing it', async () => {
      ttsService.generateSingleParagraphTTS.mockRejectedValue({ status: 503 });
      queueService.queueRetryBatch.mockRejectedValue(
        new Error('redis TTL write failed'),
      );

      await expect(
        processor.process(makeJob({ totalParagraphs: 1, retryGeneration: 0 })),
      ).rejects.toThrow('redis TTL write failed');
    });
  });
});

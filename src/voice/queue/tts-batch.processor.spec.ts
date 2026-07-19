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
  };
  let ttsService: { generateSingleParagraphTTS: jest.Mock };

  beforeEach(() => {
    queueService = {
      markParagraphCompleted: jest.fn().mockResolvedValue(undefined),
      markParagraphFailed: jest.fn().mockResolvedValue(undefined),
      updateBatchMeta: jest.fn().mockResolvedValue(undefined),
    };
    ttsService = { generateSingleParagraphTTS: jest.fn() };

    processor = new TtsBatchProcessor(
      queueService as never,
      ttsService as never,
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
      // A non-quota (non-402) error is marked failed immediately, without
      // cascading through the provider fallback chain.
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
});

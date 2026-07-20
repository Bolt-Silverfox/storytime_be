import { TtsBatchQueueService } from './tts-batch-queue.service';
import { TtsBatchJobData } from './tts-batch-job.interface';

const makePipeline = () => {
  const pipeline = {
    hset: jest.fn().mockReturnThis(),
    sadd: jest.fn().mockReturnThis(),
    srem: jest.fn().mockReturnThis(),
    expire: jest.fn().mockReturnThis(),
    del: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue([]),
  };
  return pipeline;
};

describe('TtsBatchQueueService', () => {
  let queue: { add: jest.Mock };
  let redis: { pipeline: jest.Mock; del: jest.Mock; quit: jest.Mock };
  let service: TtsBatchQueueService;

  beforeEach(() => {
    queue = { add: jest.fn().mockResolvedValue(undefined) };
    redis = {
      pipeline: jest.fn(() => makePipeline()),
      del: jest.fn().mockResolvedValue(undefined),
      quit: jest.fn().mockResolvedValue(undefined),
    };
    service = new TtsBatchQueueService(queue as never, redis as never);
  });

  const original: TtsBatchJobData = {
    batchJobId: 'batch-abc',
    storyId: 'story-1',
    voiceId: 'voice-1',
    userId: 'user-1',
    isPremium: false,
    provider: 'elevenlabs',
    paragraphs: [{ index: 0, text: 'hi', hash: 'h0' }],
    totalParagraphs: 1,
  };

  it('builds a retry job id without the reserved BullMQ colon separator', async () => {
    await service.queueRetryBatch(original, original.paragraphs, 1);

    const addOptions = queue.add.mock.calls[0][2];
    expect(addOptions.jobId).not.toContain(':');
    expect(addOptions.jobId).toBe('batch-abc-retry-1');
  });
});

import { HealthIndicatorService } from '@nestjs/terminus';
import { ConfigService } from '@nestjs/config';
import { RedisHealthIndicator } from './redis.health';

const mockClient = {
  connect: jest.fn(),
  ping: jest.fn(),
  info: jest.fn(),
  disconnect: jest.fn(),
};
jest.mock('ioredis', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => mockClient),
}));

describe('RedisHealthIndicator', () => {
  const indicator = new RedisHealthIndicator(new HealthIndicatorService(), {
    get: jest.fn().mockReturnValue('redis://localhost:6379'),
  } as unknown as ConfigService<never, true>);

  beforeEach(() => jest.clearAllMocks());

  it('reports up with ping response and memory usage', async () => {
    mockClient.connect.mockResolvedValue(undefined);
    mockClient.ping.mockResolvedValue('PONG');
    mockClient.info.mockResolvedValue(
      '# Memory\r\nused_memory_human:1.50M\r\n',
    );

    expect(await indicator.isHealthy('redis')).toEqual({
      redis: {
        status: 'up',
        duration: expect.stringMatching(/^\d+ms$/),
        response: 'PONG',
        usedMemory: '1.50M',
      },
    });
    expect(mockClient.disconnect).toHaveBeenCalledTimes(1);
  });

  it('reports down and still disconnects when connect fails', async () => {
    mockClient.connect.mockRejectedValue(
      new Error('NOAUTH Authentication required'),
    );

    expect(await indicator.isHealthy('redis')).toEqual({
      redis: {
        status: 'down',
        duration: expect.stringMatching(/^\d+ms$/),
        error: 'NOAUTH Authentication required',
      },
    });
    expect(mockClient.disconnect).toHaveBeenCalledTimes(1);
  });
});

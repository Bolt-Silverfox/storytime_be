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

  describe('with an unresponsive Redis', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => {
      expect(jest.getTimerCount()).toBe(0);
      jest.useRealTimers();
    });

    it.each(['connect', 'ping', 'info'] as const)(
      'reports down with a timeout error when %s never settles',
      async (hung) => {
        const never = () => new Promise<never>(() => undefined);
        mockClient.connect.mockImplementation(
          hung === 'connect' ? never : () => Promise.resolve(undefined),
        );
        mockClient.ping.mockImplementation(
          hung === 'ping' ? never : () => Promise.resolve('PONG'),
        );
        mockClient.info.mockImplementation(
          hung === 'info' ? never : () => Promise.resolve(''),
        );

        let result: unknown;
        void indicator.isHealthy('redis').then((r) => (result = r));

        await jest.advanceTimersByTimeAsync(3000);

        expect(result).toEqual({
          redis: {
            status: 'down',
            duration: '3000ms',
            error: 'timeout after 3000ms',
          },
        });
        expect(mockClient.disconnect).toHaveBeenCalledTimes(1);
      },
    );
  });
});

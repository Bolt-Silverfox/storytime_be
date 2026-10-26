import { HealthIndicatorService } from '@nestjs/terminus';
import { PrismaHealthIndicator } from './prisma.health';
import { PrismaService } from '@/prisma/prisma.service';

describe('PrismaHealthIndicator', () => {
  const build = (queryRaw: jest.Mock) =>
    new PrismaHealthIndicator(new HealthIndicatorService(), {
      $queryRaw: queryRaw,
    } as unknown as PrismaService);

  it('reports up with connection details when the query succeeds', async () => {
    const result = await build(
      jest.fn().mockResolvedValue([{ '?column?': 1 }]),
    ).isHealthy('database');

    expect(result).toEqual({
      database: {
        status: 'up',
        duration: expect.stringMatching(/^\d+ms$/),
        connection: 'established',
      },
    });
  });

  it('reports down with the error message instead of throwing', async () => {
    const result = await build(
      jest.fn().mockRejectedValue(new Error('connection refused')),
    ).isHealthy('database');

    expect(result).toEqual({
      database: {
        status: 'down',
        duration: expect.stringMatching(/^\d+ms$/),
        error: 'connection refused',
      },
    });
  });
});

import {
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  Logger,
} from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import IHealth, { HealthResponse } from '@/health/Ihealth.interfaces';

// Threshold for slow query warnings (milliseconds)
const SLOW_QUERY_THRESHOLD_MS = 100;

const FALLBACK_DATABASE_CONNECTION_LIMIT = 3;

export const parseConnectionLimit = (value: string | undefined): number => {
  if (value === undefined || value.trim() === '') {
    return FALLBACK_DATABASE_CONNECTION_LIMIT;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0
    ? parsed
    : FALLBACK_DATABASE_CONNECTION_LIMIT;
};

const DEFAULT_DATABASE_CONNECTION_LIMIT = parseConnectionLimit(
  process.env.DATABASE_CONNECTION_LIMIT,
);

export const resolvePrismaDatasourceUrl = (
  databaseUrl: string | undefined,
  connectionLimit = DEFAULT_DATABASE_CONNECTION_LIMIT,
): string | undefined => {
  if (!databaseUrl || databaseUrl.startsWith('prisma://')) {
    return databaseUrl;
  }

  try {
    const url = new URL(databaseUrl);
    const isPostgresUrl =
      url.protocol === 'postgres:' || url.protocol === 'postgresql:';

    if (isPostgresUrl && !url.searchParams.has('connection_limit')) {
      url.searchParams.set('connection_limit', String(connectionLimit));
    }
    return url.toString();
  } catch {
    return databaseUrl;
  }
};

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy, IHealth
{
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    // Configure connection pool via datasource URL parameters. A bounded
    // connection_limit is auto-appended to direct (postgresql://) URLs so a
    // single instance can't exhaust the shared database pool; Prisma Accelerate
    // (prisma://) URLs are passed through untouched. Any of these can be
    // overridden in DATABASE_URL: ?connection_limit=10&pool_timeout=10
    super({
      datasources: {
        db: {
          url: resolvePrismaDatasourceUrl(process.env.DATABASE_URL),
        },
      },
      log:
        process.env.NODE_ENV === 'development'
          ? [
              { emit: 'event', level: 'query' },
              { emit: 'stdout', level: 'warn' },
              { emit: 'stdout', level: 'error' },
            ]
          : [{ emit: 'stdout', level: 'error' }],
    });

    // Set up slow query logging in development
    if (process.env.NODE_ENV === 'development') {
      this.setupQueryLogging();
    }
  }

  /**
   * Set up query event logging for slow query detection
   */
  private setupQueryLogging(): void {
    // @ts-expect-error - Prisma event typing is complex
    this.$on('query', (e: Prisma.QueryEvent) => {
      const duration = e.duration;
      if (duration > SLOW_QUERY_THRESHOLD_MS) {
        this.logger.warn(
          `Slow query detected (${duration}ms): ${e.query.substring(0, 200)}${e.query.length > 200 ? '...' : ''}`,
        );
      }
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Database connection established');
  }
  async onModuleDestroy() {
    await this.$disconnect();
  }

  async CheckHealth(): Promise<HealthResponse> {
    const start = Date.now();
    try {
      await this.$queryRaw`SELECT 1;`;

      return {
        service: 'prisma',
        status: 'up',
        message: 'Prisma is up and running',
        duration: Date.now() - start,
      };
    } catch {
      return {
        service: 'prisma',
        status: 'down',
        message: 'Prisma is down',
        duration: Date.now(),
      };
    }
  }
}

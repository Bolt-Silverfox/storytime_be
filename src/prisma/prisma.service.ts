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

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy, IHealth
{
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    // Configure connection pool via datasource URL parameters
    // These can be overridden in DATABASE_URL: ?connection_limit=10&pool_timeout=10
    super({
      datasources: {
        db: {
          url: process.env.DATABASE_URL,
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

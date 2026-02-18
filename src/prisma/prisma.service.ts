import {
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  Logger,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import IHealth, { HealthResponse } from '@/health/Ihealth.interfaces';

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
        process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
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

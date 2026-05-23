import {
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  Logger,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import IHealth, { HealthResponse } from '@/health/Ihealth.interfaces';

const DEFAULT_DATABASE_CONNECTION_LIMIT = 3;

const parseConnectionLimit = (value: string | undefined): number => {
  if (value === undefined || value.trim() === '') {
    return DEFAULT_DATABASE_CONNECTION_LIMIT;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0
    ? parsed
    : DEFAULT_DATABASE_CONNECTION_LIMIT;
};

export const resolvePrismaDatasourceUrl = (
  databaseUrl: string | undefined,
  connectionLimit = parseConnectionLimit(process.env.DATABASE_CONNECTION_LIMIT),
): string | undefined => {
  if (!databaseUrl || databaseUrl.startsWith('prisma://')) {
    return databaseUrl;
  }

  try {
    const url = new URL(databaseUrl);
    if (!url.searchParams.has('connection_limit')) {
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
    // Use Prisma Accelerate for connection pooling
    // The DATABASE_URL should be a prisma:// URL for Accelerate
    super({
      datasources: {
        db: {
          url: resolvePrismaDatasourceUrl(process.env.DATABASE_URL),
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

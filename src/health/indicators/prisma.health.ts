import { Injectable } from '@nestjs/common';
import { ErrorHandler } from '@/shared/utils/error-handler.util';
import {
  HealthIndicator,
  HealthIndicatorResult,
  HealthCheckError,
} from '@nestjs/terminus';
import { PrismaService } from '@/prisma/prisma.service';

@Injectable()
export class PrismaHealthIndicator extends HealthIndicator {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const startTime = Date.now();

    try {
      // Execute a simple query to verify database connectivity
      await this.prisma.$queryRaw`SELECT 1`;

      const duration = Date.now() - startTime;

      return this.getStatus(key, true, {
        duration: `${duration}ms`,
        connection: 'established',
      });
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage =
        ErrorHandler.extractMessage(error);

      throw new HealthCheckError(
        'Prisma health check failed',
        this.getStatus(key, false, {
          duration: `${duration}ms`,
          error: errorMessage,
        }),
      );
    }
  }
}

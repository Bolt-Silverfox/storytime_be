import { Injectable } from '@nestjs/common';
import { ErrorHandler } from '@/shared/utils/error-handler.util';
import {
  HealthIndicatorResult,
  HealthIndicatorService,
} from '@nestjs/terminus';
import { PrismaService } from '@/prisma/prisma.service';

@Injectable()
export class PrismaHealthIndicator {
  constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
    private readonly prisma: PrismaService,
  ) {}

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const startTime = Date.now();

    try {
      // Execute a simple query to verify database connectivity
      await this.prisma.$queryRaw`SELECT 1`;

      const duration = Date.now() - startTime;

      return this.healthIndicatorService.check(key).up({
        duration: `${duration}ms`,
        connection: 'established',
      });
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = ErrorHandler.extractMessage(error);

      return this.healthIndicatorService.check(key).down({
          duration: `${duration}ms`,
          error: errorMessage,
        });
    }
  }
}

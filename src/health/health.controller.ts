import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import {
  HealthCheck,
  HealthCheckResult,
  HealthCheckService,
} from '@nestjs/terminus';
import { HealthChecks, HealthRoute } from './health-checks';

type PublicHealth = {
  status: 'ok' | 'error';
  checks: Record<string, { status: 'up' | 'down' }>;
};

const toPublic = (result: HealthCheckResult): PublicHealth => ({
  status: result.status === 'ok' ? 'ok' : 'error',
  checks: Object.fromEntries(
    Object.entries(result.details ?? {}).map(([key, detail]) => [
      key,
      { status: detail.status === 'up' ? 'up' : 'down' },
    ]),
  ),
});

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly checks: HealthChecks,
  ) {}

  private async run(route: HealthRoute | null): Promise<PublicHealth> {
    try {
      return toPublic(
        await this.health.check(route ? this.checks.for(route, false) : []),
      );
    } catch (error) {
      if (error instanceof ServiceUnavailableException) {
        throw new ServiceUnavailableException(
          toPublic(error.getResponse() as HealthCheckResult),
        );
      }
      throw error;
    }
  }

  @Get()
  @ApiOperation({ summary: 'Basic liveness check' })
  @ApiResponse({ status: 200, description: 'Service is alive' })
  @HealthCheck()
  check() {
    return this.run(null);
  }

  @Get('ready')
  @ApiOperation({ summary: 'Readiness check (all dependencies), status only' })
  @ApiResponse({ status: 200, description: 'All dependencies are healthy' })
  @ApiResponse({
    status: 503,
    description: 'One or more dependencies are unhealthy',
  })
  @HealthCheck()
  checkReady() {
    return this.run('ready');
  }

  @Get('db')
  @ApiOperation({ summary: 'Database health, status only' })
  @HealthCheck()
  checkDatabase() {
    return this.run('db');
  }

  @Get('redis')
  @ApiOperation({ summary: 'Redis health, status only' })
  @HealthCheck()
  checkRedis() {
    return this.run('redis');
  }

  @Get('smtp')
  @ApiOperation({ summary: 'Last known SMTP health, status only' })
  @HealthCheck()
  checkSmtp() {
    return this.run('smtp');
  }

  @Get('queue')
  @ApiOperation({ summary: 'Email queue health, status only' })
  @HealthCheck()
  checkQueue() {
    return this.run('queue');
  }

  @Get('system')
  @ApiOperation({ summary: 'System resources health, status only' })
  @HealthCheck()
  checkSystem() {
    return this.run('system');
  }

  @Get('full')
  @ApiOperation({ summary: 'Complete health check, status only' })
  @ApiResponse({ status: 200, description: 'All systems healthy' })
  @ApiResponse({ status: 503, description: 'One or more systems unhealthy' })
  @HealthCheck()
  checkFull() {
    return this.run('full');
  }

  @Get('tts')
  @ApiOperation({ summary: 'TTS providers health, status only' })
  @HealthCheck()
  checkTts() {
    return this.run('tts');
  }
}

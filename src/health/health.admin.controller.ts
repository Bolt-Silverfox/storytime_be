import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { HealthCheck, HealthCheckService } from '@nestjs/terminus';
import { AuthSessionGuard } from '@/shared/guards/auth.guard';
import { AdminGuard } from '@/shared/guards/admin.guard';
import { HealthChecks, HealthRoute } from './health-checks';

@ApiTags('Health')
@ApiBearerAuth()
@Controller('health/admin')
@UseGuards(AuthSessionGuard, AdminGuard)
export class AdminHealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly checks: HealthChecks,
  ) {}

  private run(route: HealthRoute) {
    return this.health.check(this.checks.for(route, true));
  }

  @Get('ready')
  @ApiOperation({ summary: 'Readiness check with full detail (admin)' })
  @HealthCheck()
  checkReady() {
    return this.run('ready');
  }

  @Get('db')
  @ApiOperation({ summary: 'Database health with detail (admin)' })
  @HealthCheck()
  checkDatabase() {
    return this.run('db');
  }

  @Get('redis')
  @ApiOperation({ summary: 'Redis health with detail (admin)' })
  @HealthCheck()
  checkRedis() {
    return this.run('redis');
  }

  @Get('smtp')
  @ApiOperation({ summary: 'Live SMTP check with detail (admin)' })
  @HealthCheck()
  checkSmtp() {
    return this.run('smtp');
  }

  @Get('queue')
  @ApiOperation({ summary: 'Queue health with detail (admin)' })
  @HealthCheck()
  checkQueue() {
    return this.run('queue');
  }

  @Get('system')
  @ApiOperation({ summary: 'System resources with detail (admin)' })
  @HealthCheck()
  checkSystem() {
    return this.run('system');
  }

  @Get('full')
  @ApiOperation({ summary: 'Complete health check with detail (admin)' })
  @HealthCheck()
  checkFull() {
    return this.run('full');
  }

  @Get('tts')
  @ApiOperation({ summary: 'TTS circuit breakers with detail (admin)' })
  @HealthCheck()
  checkTts() {
    return this.run('tts');
  }
}

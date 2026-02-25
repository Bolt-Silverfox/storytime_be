import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import {
  HealthCheck,
  HealthCheckService,
  MemoryHealthIndicator,
  DiskHealthIndicator,
} from '@nestjs/terminus';
import {
  PrismaHealthIndicator,
  RedisHealthIndicator,
  SmtpHealthIndicator,
  QueueHealthIndicator,
  TTSCircuitBreakerHealthIndicator,
} from './indicators';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly prismaHealth: PrismaHealthIndicator,
    private readonly redisHealth: RedisHealthIndicator,
    private readonly smtpHealth: SmtpHealthIndicator,
    private readonly queueHealth: QueueHealthIndicator,
    private readonly memory: MemoryHealthIndicator,
    private readonly disk: DiskHealthIndicator,
    private readonly ttsHealth: TTSCircuitBreakerHealthIndicator,
  ) {}

  /**
   * Basic liveness check - is the service running?
   * Use for Kubernetes liveness probes
   */
  @Get()
  @ApiOperation({ summary: 'Basic liveness check' })
  @ApiResponse({ status: 200, description: 'Service is alive' })
  @HealthCheck()
  async check() {
    return this.health.check([]);
  }

  /**
   * Full readiness check - are all dependencies healthy?
   * Use for Kubernetes readiness probes
   */
  @Get('ready')
  @ApiOperation({ summary: 'Readiness check (all dependencies)' })
  @ApiResponse({ status: 200, description: 'All dependencies are healthy' })
  @ApiResponse({
    status: 503,
    description: 'One or more dependencies are unhealthy',
  })
  @HealthCheck()
  async checkReady() {
    return this.health.check([
      () => this.prismaHealth.isHealthy('database'),
      () => this.redisHealth.isHealthy('redis'),
      () => this.queueHealth.isHealthy('email-queue'),
      () => this.ttsHealth.isHealthy('tts-providers'),
    ]);
  }

  /**
   * Database health check
   */
  @Get('db')
  @ApiOperation({ summary: 'Database (Prisma) health check' })
  @ApiResponse({ status: 200, description: 'Database is healthy' })
  @ApiResponse({ status: 503, description: 'Database is unhealthy' })
  @HealthCheck()
  async checkDatabase() {
    return this.health.check([() => this.prismaHealth.isHealthy('database')]);
  }

  /**
   * Redis health check
   */
  @Get('redis')
  @ApiOperation({ summary: 'Redis health check' })
  @ApiResponse({ status: 200, description: 'Redis is healthy' })
  @ApiResponse({ status: 503, description: 'Redis is unhealthy' })
  @HealthCheck()
  async checkRedis() {
    return this.health.check([() => this.redisHealth.isHealthy('redis')]);
  }

  /**
   * SMTP health check
   */
  @Get('smtp')
  @ApiOperation({ summary: 'SMTP/Email health check' })
  @ApiResponse({ status: 200, description: 'SMTP is healthy' })
  @ApiResponse({ status: 503, description: 'SMTP is unhealthy' })
  @HealthCheck()
  async checkSmtp() {
    return this.health.check([() => this.smtpHealth.isHealthy('smtp')]);
  }

  /**
   * Queue health check
   */
  @Get('queue')
  @ApiOperation({ summary: 'Email queue health check' })
  @ApiResponse({ status: 200, description: 'Queue is healthy' })
  @ApiResponse({ status: 503, description: 'Queue is unhealthy' })
  @HealthCheck()
  async checkQueue() {
    return this.health.check([() => this.queueHealth.isHealthy('email-queue')]);
  }

  /**
   * System resources check (memory + disk)
   */
  @Get('system')
  @ApiOperation({ summary: 'System resources health check' })
  @ApiResponse({ status: 200, description: 'System resources are healthy' })
  @ApiResponse({ status: 503, description: 'System resources are unhealthy' })
  @HealthCheck()
  async checkSystem() {
    return this.health.check([
      // Memory: heap should not exceed 500MB
      () => this.memory.checkHeap('memory_heap', 500 * 1024 * 1024),
      // Memory: RSS should not exceed 1GB
      () => this.memory.checkRSS('memory_rss', 1024 * 1024 * 1024),
      // Disk: should have at least 10% free space
      () =>
        this.disk.checkStorage('disk', {
          path: '/',
          thresholdPercent: 0.9,
        }),
    ]);
  }

  /**
   * Complete health check - all indicators
   * Use for monitoring dashboards
   */
  @Get('full')
  @ApiOperation({ summary: 'Complete health check (all indicators)' })
  @ApiResponse({ status: 200, description: 'All systems healthy' })
  @ApiResponse({ status: 503, description: 'One or more systems unhealthy' })
  @HealthCheck()
  async checkFull() {
    return this.health.check([
      () => this.prismaHealth.isHealthy('database'),
      () => this.redisHealth.isHealthy('redis'),
      () => this.smtpHealth.isHealthy('smtp'),
      () => this.queueHealth.isHealthy('email-queue'),
      () => this.memory.checkHeap('memory_heap', 500 * 1024 * 1024),
      () => this.memory.checkRSS('memory_rss', 1024 * 1024 * 1024),
      () =>
        this.disk.checkStorage('disk', {
          path: '/',
          thresholdPercent: 0.9,
        }),
      () => this.ttsHealth.isHealthy('tts-providers'),
    ]);
  }

  /**
   * TTS providers circuit breaker status
   */
  @Get('tts')
  @ApiOperation({ summary: 'TTS providers circuit breaker health check' })
  @ApiResponse({
    status: 200,
    description: 'All TTS circuit breakers are closed',
  })
  @ApiResponse({
    status: 503,
    description: 'One or more TTS circuit breakers are open',
  })
  @HealthCheck()
  async checkTts() {
    return this.health.check([() => this.ttsHealth.isHealthy('tts-providers')]);
  }
}

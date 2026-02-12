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
  FirebaseHealthIndicator,
  CloudinaryHealthIndicator,
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
    private readonly firebaseHealth: FirebaseHealthIndicator,
    private readonly cloudinaryHealth: CloudinaryHealthIndicator,
    private readonly memory: MemoryHealthIndicator,
    private readonly disk: DiskHealthIndicator,
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
      () => this.queueHealth.isHealthy('queues'),
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
   * All queues health check (email, story, voice)
   */
  @Get('queues')
  @ApiOperation({ summary: 'All queues health check' })
  @ApiResponse({ status: 200, description: 'All queues are healthy' })
  @ApiResponse({ status: 503, description: 'One or more queues are unhealthy' })
  @HealthCheck()
  async checkQueues() {
    return this.health.check([() => this.queueHealth.isHealthy('queues')]);
  }

  /**
   * Email queue health check
   */
  @Get('queues/email')
  @ApiOperation({ summary: 'Email queue health check' })
  @ApiResponse({ status: 200, description: 'Email queue is healthy' })
  @ApiResponse({ status: 503, description: 'Email queue is unhealthy' })
  @HealthCheck()
  async checkEmailQueue() {
    return this.health.check([
      () => this.queueHealth.checkQueue('email-queue', 'email'),
    ]);
  }

  /**
   * Story queue health check
   */
  @Get('queues/story')
  @ApiOperation({ summary: 'Story generation queue health check' })
  @ApiResponse({ status: 200, description: 'Story queue is healthy' })
  @ApiResponse({ status: 503, description: 'Story queue is unhealthy' })
  @HealthCheck()
  async checkStoryQueue() {
    return this.health.check([
      () => this.queueHealth.checkQueue('story-queue', 'story'),
    ]);
  }

  /**
   * Voice queue health check
   */
  @Get('queues/voice')
  @ApiOperation({ summary: 'Voice synthesis queue health check' })
  @ApiResponse({ status: 200, description: 'Voice queue is healthy' })
  @ApiResponse({ status: 503, description: 'Voice queue is unhealthy' })
  @HealthCheck()
  async checkVoiceQueue() {
    return this.health.check([
      () => this.queueHealth.checkQueue('voice-queue', 'voice'),
    ]);
  }

  /**
   * Firebase/FCM health check
   */
  @Get('firebase')
  @ApiOperation({ summary: 'Firebase/FCM health check' })
  @ApiResponse({ status: 200, description: 'Firebase is healthy' })
  @ApiResponse({ status: 503, description: 'Firebase is unhealthy' })
  @HealthCheck()
  async checkFirebase() {
    return this.health.check([() => this.firebaseHealth.isHealthy('firebase')]);
  }

  /**
   * Cloudinary health check
   */
  @Get('cloudinary')
  @ApiOperation({ summary: 'Cloudinary health check' })
  @ApiResponse({ status: 200, description: 'Cloudinary is healthy' })
  @ApiResponse({ status: 503, description: 'Cloudinary is unhealthy' })
  @HealthCheck()
  async checkCloudinary() {
    return this.health.check([
      () => this.cloudinaryHealth.isHealthy('cloudinary'),
    ]);
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
   * External services health check (Firebase, Cloudinary)
   */
  @Get('external')
  @ApiOperation({ summary: 'External services health check' })
  @ApiResponse({ status: 200, description: 'External services are healthy' })
  @ApiResponse({
    status: 503,
    description: 'One or more external services unhealthy',
  })
  @HealthCheck()
  async checkExternal() {
    return this.health.check([
      () => this.firebaseHealth.isHealthy('firebase'),
      () => this.cloudinaryHealth.isHealthy('cloudinary'),
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
      // Core infrastructure
      () => this.prismaHealth.isHealthy('database'),
      () => this.redisHealth.isHealthy('redis'),
      () => this.smtpHealth.isHealthy('smtp'),
      // All queues
      () => this.queueHealth.isHealthy('queues'),
      // External services
      () => this.firebaseHealth.isHealthy('firebase'),
      () => this.cloudinaryHealth.isHealthy('cloudinary'),
      // System resources
      () => this.memory.checkHeap('memory_heap', 500 * 1024 * 1024),
      () => this.memory.checkRSS('memory_rss', 1024 * 1024 * 1024),
      () =>
        this.disk.checkStorage('disk', {
          path: '/',
          thresholdPercent: 0.9,
        }),
    ]);
  }
}

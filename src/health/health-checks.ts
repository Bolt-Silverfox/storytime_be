import { Injectable } from '@nestjs/common';
import {
  DiskHealthIndicator,
  HealthIndicatorFunction,
  MemoryHealthIndicator,
} from '@nestjs/terminus';
import {
  CircuitBreakerHealthIndicator,
  PrismaHealthIndicator,
  QueueHealthIndicator,
  RedisHealthIndicator,
  SmtpHealthIndicator,
  TTSCircuitBreakerHealthIndicator,
} from './indicators';

const TTS_HEALTH_KEY = 'tts-providers';
const CIRCUIT_BREAKER_HEALTH_KEY = 'circuit_breakers';

export type HealthRoute =
  'ready' | 'db' | 'redis' | 'smtp' | 'queue' | 'system' | 'full' | 'tts';

@Injectable()
export class HealthChecks {
  constructor(
    private readonly prismaHealth: PrismaHealthIndicator,
    private readonly redisHealth: RedisHealthIndicator,
    private readonly smtpHealth: SmtpHealthIndicator,
    private readonly queueHealth: QueueHealthIndicator,
    private readonly memory: MemoryHealthIndicator,
    private readonly disk: DiskHealthIndicator,
    private readonly ttsHealth: TTSCircuitBreakerHealthIndicator,
    private readonly circuitBreakerHealth: CircuitBreakerHealthIndicator,
  ) {}

  for(route: HealthRoute, liveSmtp: boolean): HealthIndicatorFunction[] {
    const database = () => this.prismaHealth.isHealthy('database');
    const redis = () => this.redisHealth.isHealthy('redis');
    const queue = () => this.queueHealth.isHealthy('email-queue');
    const tts = () => this.ttsHealth.isHealthy(TTS_HEALTH_KEY);
    const breakers = () =>
      this.circuitBreakerHealth.isHealthy(CIRCUIT_BREAKER_HEALTH_KEY);
    const smtp = () =>
      liveSmtp
        ? this.smtpHealth.isHealthy('smtp')
        : this.smtpHealth.cachedHealth('smtp');
    const heap = () => this.memory.checkHeap('memory_heap', 500 * 1024 * 1024);
    const rss = () => this.memory.checkRSS('memory_rss', 1024 * 1024 * 1024);
    const storage = () =>
      this.disk.checkStorage('disk', { path: '/', thresholdPercent: 0.9 });

    switch (route) {
      case 'ready':
        return [database, redis, queue, tts, breakers];
      case 'db':
        return [database];
      case 'redis':
        return [redis];
      case 'smtp':
        return [smtp];
      case 'queue':
        return [queue];
      case 'system':
        return [heap, rss, storage];
      case 'tts':
        return [tts];
      case 'full':
        return [
          database,
          redis,
          smtp,
          queue,
          heap,
          rss,
          storage,
          tts,
          breakers,
        ];
    }
  }
}

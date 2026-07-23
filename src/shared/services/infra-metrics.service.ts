import { Injectable, Inject, OnModuleInit, Logger } from '@nestjs/common';
import { metrics } from '@opentelemetry/api';
import type { Redis } from 'ioredis';
import { PrismaService } from '../../prisma/prisma.service';
import { REDIS_CLIENT } from '../../redis/redis.constants';

/**
 * InfraMetricsService
 *
 * Bridges database (Prisma) and Redis server metrics into the OTLP pipeline so
 * they show up in Grafana alongside the HTTP/runtime/cache metrics.
 *
 * - DB: reads `prisma.$metrics.json()` (connection-pool gauges + query
 *   counters) each collection interval and reports them as OTel observables.
 * - Redis: parses `INFO` from the shared ioredis connection (memory, clients,
 *   throughput, keyspace hit/miss, evictions).
 *
 * Everything is best-effort: a failure to collect never throws (it would
 * otherwise surface as an unhandled rejection inside the metric reader).
 */
@Injectable()
export class InfraMetricsService implements OnModuleInit {
  private readonly logger = new Logger(InfraMetricsService.name);

  // Cached latest Redis INFO snapshot, refreshed on each observation.
  private redisInfo: Record<string, number> = {};

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  onModuleInit(): void {
    const meter = metrics.getMeter('storytime-api');

    // ---- Database (Prisma) --------------------------------------------------
    // Pool gauges + query counters, sourced from prisma.$metrics.json().
    const dbPoolOpen = meter.createObservableGauge('db_pool_connections_open', {
      description: 'Prisma pool: open connections',
    });
    const dbPoolBusy = meter.createObservableGauge('db_pool_connections_busy', {
      description: 'Prisma pool: connections in use',
    });
    const dbPoolIdle = meter.createObservableGauge('db_pool_connections_idle', {
      description: 'Prisma pool: idle connections',
    });
    const dbQueriesActive = meter.createObservableGauge('db_queries_active', {
      description: 'Prisma: queries currently executing',
    });
    const dbQueriesWait = meter.createObservableGauge('db_queries_wait', {
      description: 'Prisma: queries waiting for a connection',
    });
    const dbQueriesTotal = meter.createObservableCounter('db_queries_total', {
      description: 'Prisma: total queries executed',
    });

    meter.addBatchObservableCallback(
      async (result) => {
        try {
          const m = await this.prisma.$metrics.json();
          const gauge = (key: string): number | undefined =>
            m.gauges.find((g) => g.key === key)?.value;
          const counter = (key: string): number | undefined =>
            m.counters.find((c) => c.key === key)?.value;

          const observeIf = (
            inst: Parameters<typeof result.observe>[0],
            v: number | undefined,
          ): void => {
            if (typeof v === 'number' && Number.isFinite(v))
              result.observe(inst, v);
          };

          observeIf(dbPoolOpen, gauge('prisma_pool_connections_open'));
          observeIf(dbPoolBusy, gauge('prisma_pool_connections_busy'));
          observeIf(dbPoolIdle, gauge('prisma_pool_connections_idle'));
          observeIf(dbQueriesActive, gauge('prisma_client_queries_active'));
          observeIf(dbQueriesWait, gauge('prisma_client_queries_wait'));
          observeIf(dbQueriesTotal, counter('prisma_client_queries_total'));
        } catch (error) {
          this.logger.warn(
            `Prisma metrics collection failed: ${this.msg(error)}`,
          );
        }
      },
      [
        dbPoolOpen,
        dbPoolBusy,
        dbPoolIdle,
        dbQueriesActive,
        dbQueriesWait,
        dbQueriesTotal,
      ],
    );

    // ---- Redis --------------------------------------------------------------
    const redisMem = meter.createObservableGauge('redis_memory_used_bytes', {
      description: 'Redis used_memory',
    });
    const redisClients = meter.createObservableGauge(
      'redis_connected_clients',
      {
        description: 'Redis connected clients',
      },
    );
    const redisOps = meter.createObservableGauge('redis_ops_per_sec', {
      description: 'Redis instantaneous ops/sec',
    });
    const redisCmdTotal = meter.createObservableCounter(
      'redis_commands_processed_total',
      { description: 'Redis total commands processed' },
    );
    const redisHits = meter.createObservableCounter(
      'redis_keyspace_hits_total',
      {
        description: 'Redis keyspace hits',
      },
    );
    const redisMisses = meter.createObservableCounter(
      'redis_keyspace_misses_total',
      { description: 'Redis keyspace misses' },
    );
    const redisEvicted = meter.createObservableCounter(
      'redis_evicted_keys_total',
      {
        description: 'Redis evicted keys',
      },
    );
    const redisUptime = meter.createObservableGauge('redis_uptime_seconds', {
      description: 'Redis uptime in seconds',
    });

    meter.addBatchObservableCallback(
      async (result) => {
        try {
          await this.refreshRedisInfo();
          const v = (k: string): number | undefined => this.redisInfo[k];
          const obs = (
            inst: Parameters<typeof result.observe>[0],
            key: string,
          ): void => {
            const val = v(key);
            if (typeof val === 'number' && Number.isFinite(val))
              result.observe(inst, val);
          };
          obs(redisMem, 'used_memory');
          obs(redisClients, 'connected_clients');
          obs(redisOps, 'instantaneous_ops_per_sec');
          obs(redisCmdTotal, 'total_commands_processed');
          obs(redisHits, 'keyspace_hits');
          obs(redisMisses, 'keyspace_misses');
          obs(redisEvicted, 'evicted_keys');
          obs(redisUptime, 'uptime_in_seconds');
        } catch (error) {
          this.logger.warn(
            `Redis metrics collection failed: ${this.msg(error)}`,
          );
        }
      },
      [
        redisMem,
        redisClients,
        redisOps,
        redisCmdTotal,
        redisHits,
        redisMisses,
        redisEvicted,
        redisUptime,
      ],
    );

    this.logger.log('Infra (DB + Redis) metrics initialized');
  }

  /**
   * Fetch and parse the Redis INFO block into a flat numeric map. Non-numeric
   * fields are skipped. Only reads when the client is in a usable state.
   */
  private async refreshRedisInfo(): Promise<void> {
    if (this.redis.status !== 'ready') return;
    const raw = await this.redis.info();
    const parsed: Record<string, number> = {};
    for (const line of raw.split(/\r?\n/)) {
      if (!line || line.startsWith('#')) continue;
      const idx = line.indexOf(':');
      if (idx === -1) continue;
      const key = line.slice(0, idx);
      const num = Number(line.slice(idx + 1));
      if (Number.isFinite(num)) parsed[key] = num;
    }
    this.redisInfo = parsed;
  }

  private msg(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}

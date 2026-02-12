import { Injectable, Inject, OnModuleInit, Logger } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import {
  metrics,
  Counter,
  Histogram,
  ObservableGauge,
  ObservableResult,
} from '@opentelemetry/api';

/**
 * Cache Metrics Service
 *
 * Wraps the cache manager to provide:
 * - Hit/miss tracking via Prometheus counters
 * - Operation latency histograms
 * - Cache hit ratio gauge (observable)
 *
 * Usage in services:
 * ```typescript
 * // Instead of:
 * const cached = await this.cacheManager.get(key);
 *
 * // Use:
 * const cached = await this.cacheMetrics.get(key, 'subscription');
 * ```
 */
@Injectable()
export class CacheMetricsService implements OnModuleInit {
  private readonly logger = new Logger(CacheMetricsService.name);

  // OpenTelemetry metrics
  private cacheOperationsCounter!: Counter;
  private cacheLatencyHistogram!: Histogram;
  private cacheHitRatioGauge!: ObservableGauge;

  // Internal tracking for hit ratio calculation
  private hitCount = 0;
  private missCount = 0;

  constructor(@Inject(CACHE_MANAGER) private readonly cacheManager: Cache) {}

  onModuleInit() {
    const meter = metrics.getMeter('storytime-api');

    // Counter for cache operations (hits, misses, sets, deletes)
    this.cacheOperationsCounter = meter.createCounter('cache_operations_total', {
      description: 'Total cache operations by type and key pattern',
    });

    // Histogram for operation latency
    this.cacheLatencyHistogram = meter.createHistogram(
      'cache_operation_duration_seconds',
      {
        description: 'Cache operation duration in seconds',
        unit: 's',
      },
    );

    // Gauge for hit ratio (updated periodically)
    this.cacheHitRatioGauge = meter.createObservableGauge('cache_hit_ratio', {
      description: 'Cache hit ratio (hits / total operations)',
    });

    // Update hit ratio gauge on observation
    this.cacheHitRatioGauge.addCallback(
      (result: ObservableResult<Record<string, string>>) => {
        const total = this.hitCount + this.missCount;
        const ratio = total > 0 ? this.hitCount / total : 0;
        result.observe(ratio, { cache: 'all' });
      },
    );

    this.logger.log('Cache metrics initialized');
  }

  /**
   * Get value from cache with metrics tracking
   * @param key Cache key
   * @param keyPattern Category for grouping metrics (e.g., 'subscription', 'story', 'user')
   */
  async get<T>(key: string, keyPattern: string = 'default'): Promise<T | null> {
    const startTime = performance.now();

    try {
      const value = await this.cacheManager.get<T>(key);
      const duration = (performance.now() - startTime) / 1000;

      if (value !== undefined && value !== null) {
        this.hitCount++;
        this.cacheOperationsCounter.add(1, {
          operation: 'get',
          result: 'hit',
          key_pattern: keyPattern,
        });
      } else {
        this.missCount++;
        this.cacheOperationsCounter.add(1, {
          operation: 'get',
          result: 'miss',
          key_pattern: keyPattern,
        });
      }

      this.cacheLatencyHistogram.record(duration, {
        operation: 'get',
        key_pattern: keyPattern,
      });

      return value ?? null;
    } catch (error) {
      this.cacheOperationsCounter.add(1, {
        operation: 'get',
        result: 'error',
        key_pattern: keyPattern,
      });
      this.logger.error(`Cache get error for key ${key}: ${error}`);
      return null;
    }
  }

  /**
   * Set value in cache with metrics tracking
   * @param key Cache key
   * @param value Value to cache
   * @param ttl Time-to-live in milliseconds
   * @param keyPattern Category for grouping metrics
   */
  async set<T>(
    key: string,
    value: T,
    ttl?: number,
    keyPattern: string = 'default',
  ): Promise<void> {
    const startTime = performance.now();

    try {
      await this.cacheManager.set(key, value, ttl);
      const duration = (performance.now() - startTime) / 1000;

      this.cacheOperationsCounter.add(1, {
        operation: 'set',
        result: 'success',
        key_pattern: keyPattern,
      });

      this.cacheLatencyHistogram.record(duration, {
        operation: 'set',
        key_pattern: keyPattern,
      });
    } catch (error) {
      this.cacheOperationsCounter.add(1, {
        operation: 'set',
        result: 'error',
        key_pattern: keyPattern,
      });
      this.logger.error(`Cache set error for key ${key}: ${error}`);
    }
  }

  /**
   * Delete value from cache with metrics tracking
   * @param key Cache key
   * @param keyPattern Category for grouping metrics
   */
  async del(key: string, keyPattern: string = 'default'): Promise<void> {
    const startTime = performance.now();

    try {
      await this.cacheManager.del(key);
      const duration = (performance.now() - startTime) / 1000;

      this.cacheOperationsCounter.add(1, {
        operation: 'del',
        result: 'success',
        key_pattern: keyPattern,
      });

      this.cacheLatencyHistogram.record(duration, {
        operation: 'del',
        key_pattern: keyPattern,
      });
    } catch (error) {
      this.cacheOperationsCounter.add(1, {
        operation: 'del',
        result: 'error',
        key_pattern: keyPattern,
      });
      this.logger.error(`Cache delete error for key ${key}: ${error}`);
    }
  }

  /**
   * Get or set pattern - fetch from cache or compute and cache
   * @param key Cache key
   * @param fetcher Function to compute value if not cached
   * @param ttl Time-to-live in milliseconds
   * @param keyPattern Category for grouping metrics
   */
  async getOrSet<T>(
    key: string,
    fetcher: () => Promise<T>,
    ttl?: number,
    keyPattern: string = 'default',
  ): Promise<T> {
    const cached = await this.get<T>(key, keyPattern);

    if (cached !== null) {
      return cached;
    }

    const value = await fetcher();
    await this.set(key, value, ttl, keyPattern);
    return value;
  }

  /**
   * Get current cache statistics
   */
  getStats(): { hits: number; misses: number; hitRatio: number } {
    const total = this.hitCount + this.missCount;
    return {
      hits: this.hitCount,
      misses: this.missCount,
      hitRatio: total > 0 ? this.hitCount / total : 0,
    };
  }

  /**
   * Reset statistics (useful for testing)
   */
  resetStats(): void {
    this.hitCount = 0;
    this.missCount = 0;
  }
}

/**
 * Alerting thresholds for monitoring and observability.
 * These values define when alerts should be triggered.
 *
 * Aligned with ALERTING_RULES.md Prometheus/Grafana rules and
 * the OpenTelemetry metrics exported via src/otel-setup.ts.
 */
export const ALERTING_THRESHOLDS = {
  // API Response Time (milliseconds)
  API_RESPONSE_TIME: {
    WARNING: 1000, // 1s
    CRITICAL: 3000, // 3s
  },

  // Database Query Time (milliseconds)
  DB_QUERY_TIME: {
    WARNING: 100, // matches Prisma slow query threshold
    CRITICAL: 500,
  },

  // External API Response Time (milliseconds)
  EXTERNAL_API_TIME: {
    WARNING: 5000, // 5s  — matches ExternalServiceLatency Prometheus rule
    CRITICAL: 15000, // 15s (half of 30s timeout)
  },

  // Error Rate (percentage)
  ERROR_RATE: {
    WARNING: 1, // 1%
    CRITICAL: 5, // 5%  — matches HighErrorRate Prometheus rule
  },

  // Cache Hit Ratio (percentage, alert when BELOW threshold)
  CACHE_HIT_RATIO: {
    WARNING: 70, // Below 70% hit rate
    CRITICAL: 50, // Below 50% hit rate — matches LowCacheHitRatio rule
  },

  // Queue Depth (number of waiting jobs)
  QUEUE_DEPTH: {
    WARNING: 100,
    CRITICAL: 500,
  },

  // Queue Failed Jobs (count)
  QUEUE_FAILED_JOBS: {
    WARNING: 50, // matches QueueFailedJobsHigh rule (50/hr)
    CRITICAL: 100, // used by health indicator
  },

  // Memory Usage (percentage)
  MEMORY_USAGE: {
    WARNING: 75,
    CRITICAL: 90,
  },

  // Disk Usage (percentage)
  DISK_USAGE: {
    WARNING: 80,
    CRITICAL: 95,
  },
} as const;

export type AlertLevel = 'WARNING' | 'CRITICAL';
export type AlertThresholdKey = keyof typeof ALERTING_THRESHOLDS;

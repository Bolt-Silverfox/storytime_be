# Alerting Rules Configuration

Prometheus alerting rules for Storytime backend monitoring.

## Setup

### Option 1: Prometheus Alertmanager

Add these rules to your Prometheus configuration:

```yaml
# prometheus/rules/storytime.yml
groups:
  - name: storytime-backend
    rules:
      # ===================
      # Application Health
      # ===================
      - alert: HighErrorRate
        expr: |
          sum(rate(http_requests_total{status=~"5.."}[5m]))
          / sum(rate(http_requests_total[5m])) > 0.05
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "High error rate detected"
          description: "Error rate is {{ $value | humanizePercentage }} (threshold: 5%)"

      - alert: HighLatency
        expr: |
          histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket[5m])) by (le)) > 2
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High API latency"
          description: "95th percentile latency is {{ $value }}s (threshold: 2s)"

      - alert: ServiceDown
        expr: up{job="storytime-backend"} == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "Storytime backend is down"
          description: "Service has been unreachable for more than 1 minute"

      # ===================
      # Database
      # ===================
      - alert: DatabaseConnectionPoolExhausted
        expr: prisma_pool_connections_open / prisma_pool_connections_limit > 0.9
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Database connection pool nearly exhausted"
          description: "{{ $value | humanizePercentage }} of connections in use"

      - alert: SlowDatabaseQueries
        expr: |
          histogram_quantile(0.95, sum(rate(prisma_query_duration_seconds_bucket[5m])) by (le)) > 1
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "Slow database queries detected"
          description: "95th percentile query time is {{ $value }}s"

      # ===================
      # Cache
      # ===================
      - alert: LowCacheHitRatio
        expr: cache_hit_ratio < 0.5
        for: 15m
        labels:
          severity: warning
        annotations:
          summary: "Low cache hit ratio"
          description: "Cache hit ratio is {{ $value | humanizePercentage }} (threshold: 50%)"

      - alert: RedisDown
        expr: redis_up == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "Redis is down"
          description: "Redis has been unreachable for more than 1 minute"

      # ===================
      # Queue System
      # ===================
      - alert: QueueBacklogHigh
        expr: bull_queue_waiting > 1000
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "Queue backlog is high"
          description: "{{ $labels.queue }} has {{ $value }} waiting jobs"

      - alert: QueueFailedJobsHigh
        expr: increase(bull_queue_failed_total[1h]) > 50
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High number of failed jobs"
          description: "{{ $labels.queue }} has {{ $value }} failed jobs in the last hour"

      - alert: QueueProcessingStalled
        expr: bull_queue_active == 0 AND bull_queue_waiting > 0
        for: 15m
        labels:
          severity: critical
        annotations:
          summary: "Queue processing stalled"
          description: "{{ $labels.queue }} has waiting jobs but no active processing"

      # ===================
      # External Services
      # ===================
      - alert: ElevenLabsQuotaLow
        expr: elevenlabs_character_remaining < 50000
        for: 1h
        labels:
          severity: warning
        annotations:
          summary: "ElevenLabs character quota running low"
          description: "Only {{ $value }} characters remaining"

      - alert: ExternalServiceLatency
        expr: |
          histogram_quantile(0.95, sum(rate(external_api_duration_seconds_bucket[5m])) by (le, service)) > 5
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "External service latency high"
          description: "{{ $labels.service }} 95th percentile latency is {{ $value }}s"

      # ===================
      # Memory & Resources
      # ===================
      - alert: HighMemoryUsage
        expr: process_resident_memory_bytes / 1024 / 1024 > 1024
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "High memory usage"
          description: "Process using {{ $value }}MB of memory"

      - alert: HighCPUUsage
        expr: rate(process_cpu_seconds_total[5m]) > 0.8
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "High CPU usage"
          description: "CPU usage is {{ $value | humanizePercentage }}"

      # ===================
      # Authentication
      # ===================
      - alert: HighFailedLoginRate
        expr: |
          sum(rate(auth_login_failed_total[5m]))
          / sum(rate(auth_login_attempts_total[5m])) > 0.3
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High failed login rate"
          description: "{{ $value | humanizePercentage }} of login attempts failing"

      - alert: PossibleBruteForce
        expr: sum(rate(auth_login_failed_total[1m])) by (ip) > 10
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "Possible brute force attack"
          description: "IP {{ $labels.ip }} has {{ $value }} failed logins per minute"
```

### Option 2: Grafana Alerting

Import these alert rules in Grafana UI (Alerting > Alert Rules):

| Alert | Condition | Duration | Severity |
|-------|-----------|----------|----------|
| High Error Rate | error_rate > 5% | 5m | Critical |
| High Latency (p95) | latency_p95 > 2s | 5m | Warning |
| Service Down | up == 0 | 1m | Critical |
| DB Pool Exhausted | pool_usage > 90% | 5m | Warning |
| Low Cache Hit Ratio | hit_ratio < 50% | 15m | Warning |
| Queue Backlog High | waiting > 1000 | 10m | Warning |
| High Memory Usage | memory > 1GB | 10m | Warning |
| Failed Logins High | fail_rate > 30% | 5m | Warning |

## Notification Channels

Configure these in Alertmanager or Grafana:

```yaml
# alertmanager.yml
receivers:
  - name: 'slack-critical'
    slack_configs:
      - channel: '#storytime-alerts'
        send_resolved: true
        title: '{{ .Status | toUpper }}: {{ .CommonAnnotations.summary }}'
        text: '{{ .CommonAnnotations.description }}'

  - name: 'email-warning'
    email_configs:
      - to: 'team@storytimeapp.me'
        send_resolved: true

route:
  receiver: 'email-warning'
  routes:
    - match:
        severity: critical
      receiver: 'slack-critical'
```

## Thresholds Summary

| Metric | Warning | Critical |
|--------|---------|----------|
| Error Rate | - | > 5% |
| API Latency (p95) | > 2s | > 5s |
| DB Pool Usage | > 90% | > 95% |
| Cache Hit Ratio | < 50% | < 20% |
| Queue Waiting | > 1000 | > 5000 |
| Queue Failed (1h) | > 50 | > 200 |
| Memory Usage | > 1GB | > 2GB |
| Failed Login Rate | > 30% | > 50% |
| ElevenLabs Quota | < 50K chars | < 10K chars |

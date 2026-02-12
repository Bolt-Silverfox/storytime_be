# Grafana Observability Stack - Environment Configuration

This guide explains how to configure the Grafana Stack (Loki + Tempo + Prometheus) for the Storytime API.

## Environment Variables

Add the following to your `.env` file:

```bash
# OpenTelemetry Configuration
OTEL_SERVICE_NAME=storytime-api
NODE_ENV=development  # or production

# Prometheus Metrics
PROMETHEUS_PORT=9464

# Grafana Tempo (Distributed Tracing)
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318/v1/traces

# Grafana Loki (Logs)
OTEL_EXPORTER_LOGS_ENDPOINT=http://localhost:4318/v1/logs

# Grafana Cloud (Optional - for managed service)
# GRAFANA_CLOUD_INSTANCE_ID=your-instance-id
# GRAFANA_CLOUD_API_KEY=your-api-key

# Winston Logging
LOG_LEVEL=info  # debug, info, warn, error
```

## Local Development Setup (Docker Compose)

Create `docker-compose.observability.yml`:

```yaml
version: '3.8'

services:
  # Grafana Tempo - Distributed Tracing
  tempo:
    image: grafana/tempo:latest
    command: ['-config.file=/etc/tempo.yaml']
    volumes:
      - ./tempo-config.yaml:/etc/tempo.yaml
      - tempo-data:/tmp/tempo
    ports:
      - '3200:3200'   # Tempo UI
      - '4318:4318'   # OTLP HTTP receiver

  # Grafana Loki - Log Aggregation
  loki:
    image: grafana/loki:latest
    command: -config.file=/etc/loki/local-config.yaml
    ports:
      - '3100:3100'   # Loki API
    volumes:
      - loki-data:/loki

  # Prometheus - Metrics
  prometheus:
    image: prom/prometheus:latest
    command:
      - '--config.file=/etc/prometheus/prometheus.yml'
      - '--storage.tsdb.path=/prometheus'
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml
      - prometheus-data:/prometheus
    ports:
      - '9090:9090'   # Prometheus UI

  # Grafana - Visualization
  grafana:
    image: grafana/grafana:latest
    ports:
      - '3001:3000'   # Grafana UI (avoiding conflict with API port 3000)
    environment:
      - GF_AUTH_ANONYMOUS_ENABLED=true
      - GF_AUTH_ANONYMOUS_ORG_ROLE=Admin
    volumes:
      - grafana-data:/var/lib/grafana

volumes:
  tempo-data:
  loki-data:
  prometheus-data:
  grafana-data:
```

Create `tempo-config.yaml`:

```yaml
server:
  http_listen_port: 3200

distributor:
  receivers:
    otlp:
      protocols:
        http:
        grpc:

storage:
  trace:
    backend: local
    local:
      path: /tmp/tempo/traces

compactor:
  compaction:
    block_retention: 48h
```

Create `prometheus.yml`:

```yaml
global:
  scrape_interval: 15s

scrape_configs:
  - job_name: 'storytime-api'
    static_configs:
      - targets: ['host.docker.internal:9464']  # Prometheus exporter in your NestJS app
```

## Running the Stack

```bash
# Start Grafana Stack
docker-compose -f docker-compose.observability.yml up -d

# Start your NestJS API
pnpm start:dev

# Access dashboards
# - Grafana: http://localhost:3001
# - Prometheus: http://localhost:9090
# - Tempo: http://localhost:3200
# - Loki: http://localhost:3100
```

## Grafana Data Sources Setup

1. Open Grafana at `http://localhost:3001`
2. Go to **Configuration → Data Sources**
3. Add the following data sources:

### Prometheus
- **URL**: `http://prometheus:9090`
- **Access**: Server (default)

### Loki
- **URL**: `http://loki:3100`
- **Access**: Server (default)

### Tempo
- **URL**: `http://tempo:3200`
- **Access**: Server (default)

## Grafana Cloud (Production)

For production, use Grafana Cloud:

1. Sign up at https://grafana.com/products/cloud/
2. Get your credentials:
   - Instance ID
   - API Key
3. Update `.env`:
   ```bash
   GRAFANA_CLOUD_INSTANCE_ID=your-instance-id
   GRAFANA_CLOUD_API_KEY=your-api-key
   OTEL_EXPORTER_OTLP_ENDPOINT=https://tempo-prod-us-central-0.grafana.net/tempo
   OTEL_EXPORTER_LOGS_ENDPOINT=https://logs-prod-us-central1.grafana.net/loki/api/v1/push
   ```

## Verifying the Setup

1. **Metrics**: Visit `http://localhost:9464/metrics` to see Prometheus metrics
2. **Logs**: Check Grafana → Explore → Loki for structured logs
3. **Traces**: Check Grafana → Explore → Tempo for distributed traces
4. **Health**: Visit `http://localhost:3000/api/v1/health` to verify API health

## Dashboards

Import pre-built community dashboards in Grafana by ID:

### How to Import

1. Go to **Dashboards → Import**
2. Enter the dashboard ID
3. Click **Load**
4. Select your data source (Prometheus/Loki/Tempo)
5. Click **Import**

### Recommended Dashboard IDs

| Dashboard | ID | Description |
|-----------|------|-------------|
| **NestJS Metrics** | `12230` | NestJS-specific metrics, request rates, response times |
| **Node.js Application** | `11159` | Event loop lag, memory, CPU, GC metrics |
| **Node.js Prometheus** | `11956` | Detailed Node.js runtime metrics |
| **HTTP Request Metrics** | `12900` | Request rate, latency percentiles (P50/P95/P99) |
| **PostgreSQL Database** | `9628` | DB connections, query performance, table stats |
| **Redis** | `11835` | Cache hit/miss ratio, memory usage, connections |
| **BullMQ Queues** | `14538` | Queue depth, job processing rates, failures |
| **Loki Logs** | `13639` | Log aggregation, error rates, log search |

### Custom Metrics (Storytime API)

The API exposes custom Prometheus metrics at `http://localhost:9464/metrics`:

| Metric | Type | Description |
|--------|------|-------------|
| `http_request_duration_seconds` | Histogram | Request duration by route |
| `http_requests_total` | Counter | Total requests by method, route, status |
| `cache_operations_total` | Counter | Cache hits/misses by key pattern |
| `cache_hit_ratio` | Gauge | Cache hit ratio (updated periodically) |
| `bullmq_job_duration_seconds` | Histogram | Job processing time by queue |
| `bullmq_jobs_total` | Counter | Total jobs by queue, status |
| `bullmq_queue_depth` | Gauge | Current queue depth by queue |

### Dashboard Screenshots

After importing, you should see:

1. **Overview Dashboard**: Request rate, error rate, latency percentiles
2. **Database Dashboard**: Connection pool usage, slow queries, table sizes
3. **Cache Dashboard**: Hit/miss ratio, memory usage, evictions
4. **Queue Dashboard**: Job throughput, processing times, failure rates

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

## Grafana Cloud (Managed — recommended for staging/prod)

Grafana Cloud is the managed option: the app **pushes** all three signals
(metrics, traces, logs) to the Grafana Cloud **OTLP gateway** over OTLP/HTTP.
No self-hosted Tempo/Loki/Prometheus and no scraper are required.

Everything below is **env-driven and optional**. With none of these vars set, the
app behaves exactly as in local dev (Prometheus pull on `:9464`, OTLP to
`localhost:4318`, Sentry disabled) — boot is unaffected.

### 1. Obtain credentials

1. Sign up / sign in at https://grafana.com/products/cloud/ and open your stack.
2. In your stack, go to **Connections → Add new connection → OpenTelemetry (OTLP)**.
   Grafana shows:
   - The **OTLP endpoint**, e.g. `https://otlp-gateway-prod-us-central-0.grafana.net/otlp`
   - Your **Instance ID** (a numeric user id — this is the Basic-auth username)
3. Create a **Cloud Access Policy token** (Grafana Cloud → **Access Policies →
   Create access policy** with `metrics:write`, `logs:write`, `traces:write`
   scopes → **Add token**). This token is the Basic-auth password.

The backend builds the `Authorization: Basic base64(instanceId:token)` header for
you from `GRAFANA_CLOUD_INSTANCE_ID` + `GRAFANA_CLOUD_API_TOKEN`. Alternatively,
set the raw standard header yourself via `OTEL_EXPORTER_OTLP_HEADERS` (takes
precedence).

### 2. Environment variables

```bash
# --- Signal endpoints (point each at the Grafana Cloud OTLP gateway) ---
# Base gateway is e.g. https://otlp-gateway-prod-<region>.grafana.net/otlp
OTEL_EXPORTER_OTLP_ENDPOINT=https://otlp-gateway-prod-us-central-0.grafana.net/otlp/v1/traces
OTEL_EXPORTER_LOGS_ENDPOINT=https://otlp-gateway-prod-us-central-0.grafana.net/otlp/v1/logs
OTEL_EXPORTER_METRICS_ENDPOINT=https://otlp-gateway-prod-us-central-0.grafana.net/otlp/v1/metrics

# --- Push metrics via OTLP instead of the local Prometheus :9464 exporter ---
OTEL_METRICS_EXPORTER=otlp          # 'prometheus' (default) | 'otlp'
# OTEL_METRIC_EXPORT_INTERVAL=60000 # optional, ms between metric pushes

# --- Auth (Basic auth built from the pair below) ---
GRAFANA_CLOUD_INSTANCE_ID=123456
GRAFANA_CLOUD_API_TOKEN=glc_xxxxxxxxxxxxxxxxxxxxxxxx
# Legacy alias also accepted: GRAFANA_CLOUD_API_KEY
# Or set the raw header directly (wins over the pair above):
# OTEL_EXPORTER_OTLP_HEADERS=Authorization=Basic <base64(instanceId:token)>

# --- Sentry (errors, linked to the same OTel traces) ---
SENTRY_DSN=https://<key>@o<org>.ingest.sentry.io/<project>
# SENTRY_TRACES_SAMPLE_RATE=0       # optional Sentry-side perf sampling (0..1)
# SENTRY_RELEASE=1.1.0              # optional; defaults to package version
```

> `OTEL_METRICS_EXPORTER` defaults to `prometheus`, so metrics only switch to
> OTLP push when you explicitly set `otlp`. When `otlp` is selected the Prometheus
> `:9464` HTTP server is **not** started.

### 3. Import the bundled dashboard into Grafana Cloud

The repo ships `monitoring/grafana/dashboards/storytime-api.json` (uid
`storytime-api`).

1. In your Grafana Cloud instance: **Dashboards → New → Import**.
2. **Upload JSON file** and select `monitoring/grafana/dashboards/storytime-api.json`.
3. When prompted, pick your Grafana Cloud **Prometheus / Mimir** data source
   (the hosted metrics store) and click **Import**.

Because metrics now arrive via OTLP, the panels query the same metric names
listed under **Custom Metrics** above (e.g.
`http_client_request_duration_seconds_bucket`, `cache_hit_ratio`).

### Legacy self-hosted endpoints

If instead you point at self-hosted Tempo/Loki, the older native endpoints still
work (the app only cares about the OTLP URLs and headers):

```bash
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

The API exposes custom Prometheus metrics at `http://localhost:9464/metrics`
(port configurable via `PROMETHEUS_PORT`). Actual metric names emitted by the
code:

| Metric | Type | Source |
|--------|------|--------|
| `http_client_requests_total` | Counter | `http-latency.interceptor` |
| `http_client_request_duration_seconds` | Histogram | `http-latency.interceptor` |
| `http_client_request_errors_total` | Counter | `http-latency.interceptor` |
| `cache_operations_total` | Counter | `cache-metrics.service` (label `result`) |
| `cache_operation_duration_seconds` | Histogram | `cache-metrics.service` |
| `cache_hit_ratio` | Gauge | `cache-metrics.service` |

> Note: the OpenTelemetry Prometheus exporter appends `_bucket`/`_sum`/`_count`
> to histograms, so query them as e.g. `http_client_request_duration_seconds_bucket`.

### Storytime API Dashboard (bundled in this repo)

A ready-made dashboard lives at
`monitoring/grafana/dashboards/storytime-api.json` (uid `storytime-api`). It
covers HTTP request rate / error rate / latency (p50/p95/p99) and cache hit
ratio / ops-by-result / operation latency.

**Import manually:** Grafana → Dashboards → Import → Upload the JSON → pick your
Prometheus data source.

**Auto-provision (recommended):** mount the bundled configs into your Grafana +
Prometheus containers:

- Grafana datasource: `monitoring/grafana/provisioning/datasources/prometheus.yml`
- Grafana dashboard provider: `monitoring/grafana/provisioning/dashboards/dashboards.yml`
  (mount `monitoring/grafana/dashboards/` at `/etc/grafana/provisioning/dashboards/storytime`)
- Prometheus scrape job: merge `monitoring/prometheus/scrape.storytime.yml` into
  your `prometheus.yml` `scrape_configs:` (targets the API on `:9464`).
4. **Queue Dashboard**: Job throughput, processing times, failure rates

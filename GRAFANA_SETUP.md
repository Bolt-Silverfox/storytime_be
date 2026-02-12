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

Import pre-built dashboards in Grafana:
- **NestJS Metrics**: Dashboard ID `12230`
- **Node.js Application**: Dashboard ID `11159`
- **Loki Logs**: Dashboard ID `13639`

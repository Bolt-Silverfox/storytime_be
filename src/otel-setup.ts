import { NodeSDK, tracing } from '@opentelemetry/sdk-node';
import type { NodeSDKConfiguration } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';
import {
  PeriodicExportingMetricReader,
  ConsoleMetricExporter,
} from '@opentelemetry/sdk-metrics';
import {
  BatchLogRecordProcessor,
  ConsoleLogRecordExporter,
} from '@opentelemetry/sdk-logs';
import {
  SentrySpanProcessor,
  SentryPropagator,
  SentrySampler,
  SentryAsyncLocalStorageContextManager,
} from '@sentry/opentelemetry';
// IMPORTANT: importing sentry-setup runs Sentry.init() (only if SENTRY_DSN is set)
// BEFORE the NodeSDK below is constructed, which is required for the OTel <-> Sentry
// wiring. With no SENTRY_DSN this import is a pure no-op.
import { isSentryEnabled, getSentryClient } from './sentry-setup';

// Environment-based configuration
const serviceName = process.env.OTEL_SERVICE_NAME || 'storytime-api';
const serviceVersion = process.env.npm_package_version || '1.0.0';
const environment = process.env.NODE_ENV || 'development';

// Deployment environment (development | staging | production) for telemetry.
// Deliberately DECOUPLED from NODE_ENV via a dedicated var: the blue candidate
// runs NODE_ENV=development on dev infra but should be able to declare itself
// `production` at promotion without flipping NODE_ENV (which changes unrelated
// app behavior). Falls back to NODE_ENV when unset, so nothing changes until a
// deploy explicitly sets DEPLOYMENT_ENV.
const deploymentEnvironment =
  process.env.DEPLOYMENT_ENV ||
  process.env.DEPLOYMENT_ENVIRONMENT ||
  environment;

// Grafana Cloud / Tempo endpoint (OTLP)
const tempoEndpoint =
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318/v1/traces';
const lokiEndpoint =
  process.env.OTEL_EXPORTER_LOGS_ENDPOINT || 'http://localhost:4318/v1/logs';
const metricsEndpoint =
  process.env.OTEL_EXPORTER_METRICS_ENDPOINT ||
  'http://localhost:4318/v1/metrics';

// Prometheus metrics endpoint (exposed at /metrics)
const prometheusPort = parseInt(process.env.PROMETHEUS_PORT || '9464', 10);

// Metrics exporter selection: 'prometheus' (default, local pull) or 'otlp'
// (push to Grafana Cloud). Default keeps existing local-dev behavior unchanged.
const metricsExporterKind = (
  process.env.OTEL_METRICS_EXPORTER || 'prometheus'
).toLowerCase();

/**
 * Parse the standard OTEL_EXPORTER_OTLP_HEADERS format:
 * comma-separated `key=value` pairs, e.g. `Authorization=Basic xxx,X-Scope-OrgID=123`.
 */
function parseOtlpHeaderString(raw: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const pair of raw.split(',')) {
    const idx = pair.indexOf('=');
    if (idx === -1) continue;
    const key = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    if (key) headers[key] = value;
  }
  return headers;
}

/**
 * Build OTLP request headers for authenticating to the Grafana Cloud OTLP gateway.
 * Precedence:
 *   1. OTEL_EXPORTER_OTLP_HEADERS (standard) — used verbatim.
 *   2. GRAFANA_CLOUD_INSTANCE_ID + GRAFANA_CLOUD_API_TOKEN (or legacy
 *      GRAFANA_CLOUD_API_KEY) — encoded as HTTP Basic auth.
 * If none are set, returns {} so exporters behave exactly as before (no auth headers).
 */
function buildOtlpHeaders(): Record<string, string> {
  const raw = process.env.OTEL_EXPORTER_OTLP_HEADERS;
  if (raw && raw.trim()) {
    return parseOtlpHeaderString(raw);
  }

  const instanceId = process.env.GRAFANA_CLOUD_INSTANCE_ID;
  const token =
    process.env.GRAFANA_CLOUD_API_TOKEN || process.env.GRAFANA_CLOUD_API_KEY;
  if (instanceId && token) {
    const basic = Buffer.from(`${instanceId}:${token}`).toString('base64');
    return { Authorization: `Basic ${basic}` };
  }

  return {};
}

const otlpHeaders = buildOtlpHeaders();

// OTLP Trace exporter for Grafana Tempo
const traceExporter = new OTLPTraceExporter({
  url: tempoEndpoint,
  headers: otlpHeaders,
});

// OTLP Log exporter for Grafana Loki
const logExporter = new OTLPLogExporter({
  url: lokiEndpoint,
  headers: otlpHeaders,
});

/**
 * Metric reader selection.
 * - 'otlp': push metrics to Grafana Cloud via OTLP (no Prometheus scraper needed).
 * - 'prometheus' (default): keep the existing behavior — a Console exporter in
 *   development and the pull-based Prometheus HTTP server (:9464) otherwise.
 *
 * The Prometheus exporter binds its HTTP port in its constructor, so it is only
 * constructed on the Prometheus path to avoid opening :9464 when using OTLP.
 */
function createMetricReader(): NonNullable<
  NodeSDKConfiguration['metricReader']
> {
  if (metricsExporterKind === 'otlp') {
    console.log(
      `[OpenTelemetry] Pushing metrics via OTLP to ${metricsEndpoint}`,
    );
    return new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({
        url: metricsEndpoint,
        headers: otlpHeaders,
      }),
      exportIntervalMillis: parseInt(
        process.env.OTEL_METRIC_EXPORT_INTERVAL || '60000',
        10,
      ),
    });
  }

  if (environment === 'development') {
    return new PeriodicExportingMetricReader({
      exporter: new ConsoleMetricExporter(),
      exportIntervalMillis: 60000,
    });
  }

  // Prometheus exporter is pull-based and starts its own HTTP server.
  return new PrometheusExporter(
    {
      port: prometheusPort,
    },
    () => {
      console.log(
        `[OpenTelemetry] Prometheus metrics available at http://localhost:${prometheusPort}/metrics`,
      );
    },
  );
}

// Base NodeSDK configuration (shared for both the plain and Sentry-linked paths).
const sdkConfig: Partial<NodeSDKConfiguration> = {
  // Resource attributes (metadata for all telemetry)
  // Using ATTR_* constants (current standard, SEMRESATTRS_* are deprecated)
  resource: resourceFromAttributes({
    [ATTR_SERVICE_NAME]: serviceName,
    [ATTR_SERVICE_VERSION]: serviceVersion,
    // Semantic-convention deployment environment. Surfaces in Grafana Cloud as
    // the `deployment_environment` label on `target_info` (and on every metric
    // if OTLP resource-attribute promotion is enabled for the stack), so alerts
    // can scope to `production` and stay dormant on dev. Using the string key
    // avoids importing the incubating semconv entrypoint; the value of
    // ATTR_DEPLOYMENT_ENVIRONMENT is exactly this string.
    'deployment.environment': deploymentEnvironment,
    // Legacy custom attribute kept for back-compat; aligned to the same value.
    environment: deploymentEnvironment,
  }),
  metricReader: createMetricReader(),
  logRecordProcessor: new BatchLogRecordProcessor(
    environment === 'development'
      ? new ConsoleLogRecordExporter()
      : logExporter,
  ),
  instrumentations: [
    getNodeAutoInstrumentations({
      // Automatically instrument HTTP, Express, Prisma, Redis, etc.
      '@opentelemetry/instrumentation-fs': {
        enabled: false, // Disable file system instrumentation (too noisy)
      },
      '@opentelemetry/instrumentation-http': {
        enabled: true,
      },
      '@opentelemetry/instrumentation-express': {
        enabled: true,
      },
    }),
  ],
};

if (isSentryEnabled) {
  // Sentry-linked path: register Sentry's OTel pieces on THIS single NodeSDK so
  // Sentry events share trace/span IDs with the OTLP traces (no second SDK).
  const client = getSentryClient();
  sdkConfig.spanProcessors = [
    // Keep exporting spans to Grafana Tempo...
    new tracing.BatchSpanProcessor(traceExporter),
    // ...and let Sentry observe the same spans.
    new SentrySpanProcessor(),
  ];
  sdkConfig.textMapPropagator = new SentryPropagator();
  sdkConfig.contextManager = new SentryAsyncLocalStorageContextManager();
  if (client) {
    sdkConfig.sampler = new SentrySampler(client);
  }
} else {
  // Default path: unchanged behavior — NodeSDK wraps traceExporter in a batch
  // span processor automatically.
  sdkConfig.traceExporter = traceExporter;
}

// Initialize OpenTelemetry SDK
const sdk = new NodeSDK(sdkConfig);

// Start the SDK
sdk.start();

// Graceful shutdown
process.on('SIGTERM', () => {
  sdk
    .shutdown()
    .then(() => console.log('[OpenTelemetry] SDK shut down successfully'))
    .catch((error) =>
      console.error('[OpenTelemetry] Error shutting down SDK', error),
    )
    .finally(() => process.exit(0));
});

export default sdk;

import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
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

// Environment-based configuration
const serviceName = process.env.OTEL_SERVICE_NAME || 'storytime-api';
const serviceVersion = process.env.npm_package_version || '1.0.0';
const environment = process.env.NODE_ENV || 'development';

// Grafana Cloud / Tempo endpoint (OTLP)
const tempoEndpoint =
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318/v1/traces';
const lokiEndpoint =
    process.env.OTEL_EXPORTER_LOGS_ENDPOINT || 'http://localhost:4318/v1/logs';

// Prometheus metrics endpoint (exposed at /metrics)
const prometheusPort = parseInt(process.env.PROMETHEUS_PORT || '9464', 10);

// Prometheus exporter for metrics
const prometheusExporter = new PrometheusExporter(
    {
        port: prometheusPort,
    },
    () => {
        console.log(
            `[OpenTelemetry] Prometheus metrics available at http://localhost:${prometheusPort}/metrics`,
        );
    },
);

// OTLP Trace exporter for Grafana Tempo
const traceExporter = new OTLPTraceExporter({
    url: tempoEndpoint,
    headers: {
        // Add Grafana Cloud auth if using cloud
        ...(process.env.GRAFANA_CLOUD_INSTANCE_ID && {
            Authorization: `Basic ${Buffer.from(
                `${process.env.GRAFANA_CLOUD_INSTANCE_ID}:${process.env.GRAFANA_CLOUD_API_KEY}`,
            ).toString('base64')}`,
        }),
    },
});

// OTLP Log exporter for Grafana Loki
const logExporter = new OTLPLogExporter({
    url: lokiEndpoint,
    headers: {
        ...(process.env.GRAFANA_CLOUD_INSTANCE_ID && {
            Authorization: `Basic ${Buffer.from(
                `${process.env.GRAFANA_CLOUD_INSTANCE_ID}:${process.env.GRAFANA_CLOUD_API_KEY}`,
            ).toString('base64')}`,
        }),
    },
});

// Initialize OpenTelemetry SDK
const sdk = new NodeSDK({
    // Resource attributes (metadata for all telemetry)
    // Using ATTR_* constants (current standard, SEMRESATTRS_* are deprecated)
    resource: resourceFromAttributes({
        [ATTR_SERVICE_NAME]: serviceName,
        [ATTR_SERVICE_VERSION]: serviceVersion,
        environment,
    }),
    traceExporter,
    // Prometheus exporter is pull-based, so we don't use PeriodicExportingMetricReader
    // Instead, it starts its own HTTP server
    metricReader:
        environment === 'development'
            ? new PeriodicExportingMetricReader({
                exporter: new ConsoleMetricExporter(),
                exportIntervalMillis: 60000,
            })
            : prometheusExporter,
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
});

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

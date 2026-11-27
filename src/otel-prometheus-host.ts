export const getPrometheusHost = (env: NodeJS.ProcessEnv): string =>
  env.OTEL_EXPORTER_PROMETHEUS_HOST?.trim() || '127.0.0.1';

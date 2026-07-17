import * as Sentry from '@sentry/node';
import { setupEventContextTrace } from '@sentry/opentelemetry';

type SentryClient = ReturnType<typeof Sentry.getClient>;

/**
 * Backend Sentry setup, linked to the existing OpenTelemetry NodeSDK.
 *
 * Design goals:
 *  - SAFE NO-OP when `SENTRY_DSN` is unset. With no DSN, nothing is initialized
 *    and every exported helper is a no-op, so local/dev boot is unaffected.
 *  - No SECOND OpenTelemetry SDK. We already run a NodeSDK in `otel-setup.ts`,
 *    so Sentry is initialized with `skipOpenTelemetrySetup: true`. The OTel <-> Sentry
 *    wiring (span processor, propagator, sampler, context manager) is applied to that
 *    single NodeSDK in `otel-setup.ts`, which reads `isSentryEnabled` / `getSentryClient`
 *    from this module. This keeps a single tracer/provider and makes Sentry events carry
 *    the same trace/span IDs, so errors link to the matching Grafana Tempo traces.
 */

const dsn = process.env.SENTRY_DSN?.trim();

/** True only when a non-empty SENTRY_DSN is provided. */
export const isSentryEnabled = Boolean(dsn);

if (isSentryEnabled) {
  const tracesSampleRate = Number.parseFloat(
    process.env.SENTRY_TRACES_SAMPLE_RATE ?? '0',
  );

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || 'development',
    release:
      process.env.SENTRY_RELEASE || process.env.npm_package_version || '1.0.0',
    // Sampling for Sentry-side performance spans. Traces themselves are exported
    // to Grafana Tempo via OTLP; keep this low/zero unless explicitly enabled.
    tracesSampleRate: Number.isFinite(tracesSampleRate) ? tracesSampleRate : 0,
    // We own the OpenTelemetry setup (see otel-setup.ts). Do NOT let Sentry create
    // its own NodeSDK/provider — that would conflict with the existing one.
    skipOpenTelemetrySetup: true,
  });

  // Attach OTel trace/span context (trace_id, span_id) to Sentry events so they
  // correlate with the traces exported to Grafana Tempo.
  const client = Sentry.getClient();
  if (client) {
    setupEventContextTrace(client);
  }
}

/** Returns the active Sentry client, or undefined when Sentry is disabled. */
export function getSentryClient(): SentryClient {
  return isSentryEnabled ? Sentry.getClient() : undefined;
}

/**
 * Capture an exception in Sentry. No-op when Sentry is disabled.
 * Never throws and never alters caller control flow.
 */
export function captureException(exception: unknown, hint?: Sentry.EventHint) {
  if (!isSentryEnabled) {
    return;
  }
  try {
    Sentry.captureException(exception, hint);
  } catch {
    // Telemetry must never break the request/response path.
  }
}

export { Sentry };

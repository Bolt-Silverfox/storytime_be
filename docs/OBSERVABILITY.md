# Observability Stack

This document describes the managed observability stack for the Storytime API
backend and how the pieces fit together. All of it is **env-driven** and a
**safe no-op when the relevant env vars are unset** — with no configuration the
app boots and behaves exactly as in local development.

## The three pillars + uptime

| Concern | Tool | How | Config |
|---------|------|-----|--------|
| Metrics / Traces / Logs | **Grafana Cloud** | OpenTelemetry NodeSDK pushes all three signals to the Grafana Cloud **OTLP gateway** | `OTEL_*`, `GRAFANA_CLOUD_*` (see [GRAFANA_SETUP.md](../GRAFANA_SETUP.md)) |
| Errors | **Sentry** | `@sentry/node`, linked to OpenTelemetry so events carry the same `trace_id`/`span_id` and deep-link to the matching Grafana **Tempo** trace | `SENTRY_DSN` |
| Uptime / liveness | **UptimeRobot** | External HTTP monitor hitting the public readiness endpoint | dashboard only (no app env) |

```
                       ┌────────────────────────── Grafana Cloud ──────────────────────────┐
  Storytime API  ──────┤  Mimir (metrics)   Tempo (traces)   Loki (logs)                    │
  (OTel NodeSDK)       └───────────────────────────────▲───────────────────────────────────┘
        │                                               │ trace_id / span_id link
        └── @sentry/node ── errors ──▶ Sentry ──────────┘
        ▲
        │ GET /api/v1/health/ready (every 1–5 min)
   UptimeRobot (external)
```

## How Sentry links to traces

`src/otel-setup.ts` runs a single OpenTelemetry `NodeSDK`. `src/sentry-setup.ts`
initializes Sentry with `skipOpenTelemetrySetup: true` so it does **not** create a
second, conflicting SDK. When `SENTRY_DSN` is set, `otel-setup.ts` registers
Sentry's `SentrySpanProcessor`, `SentryPropagator`, `SentrySampler` and context
manager onto that same NodeSDK. As a result every Sentry event carries the active
OpenTelemetry `trace_id`/`span_id`, so an error in Sentry links directly to the
corresponding trace in Grafana Tempo.

Errors are captured via:

- The process-level `uncaughtException` / `unhandledRejection` handlers in
  `src/main.ts`.
- A catch-all `SentryExceptionFilter` (registered only when Sentry is enabled,
  with the lowest priority) for otherwise-unhandled request exceptions.
- The existing `HttpExceptionFilter` / `PrismaExceptionFilter`, which report 5xx
  failures. None of these change the HTTP response body.

All capture calls are no-ops when `SENTRY_DSN` is unset.

## UptimeRobot setup

UptimeRobot performs external liveness checks against the public readiness
endpoint. The readiness route aggregates database, Redis, email queue and TTS
provider health:

- **Endpoint:** `GET https://<your-api-host>/api/v1/health/ready`
- Returns `200` when all dependencies are healthy, `503` otherwise.

Steps:

1. Sign in at https://uptimerobot.com/ → **+ Add New Monitor**.
2. **Monitor Type:** `HTTP(s)`.
3. **Friendly Name:** `Storytime API — readiness`.
4. **URL (or IP):** `https://<your-api-host>/api/v1/health/ready`.
5. **Monitoring Interval:** `5 minutes` (free tier) or `1 minute` (paid) for
   faster detection.
6. **Advanced → Monitor Sub-Type / Keyword:** either
   - accept the default **HTTP 200** check (any non-2xx, including the `503`
     readiness failure, marks the monitor down), or
   - add a **Keyword** check for `"status":"ok"` to also catch soft failures
     where the body degrades but the status stays 200.
7. Optionally add a second monitor against the lighter liveness route
   `GET /api/v1/health` (returns 200 whenever the process is up) to distinguish
   "process down" from "a dependency is unhealthy".
8. Save the monitor.

> Note: `/health/ready` runs real dependency checks (DB, Redis, queue, TTS) and
> returns `503` if any are down, so a short interval gives fast, meaningful
> alerts. Use `/health` (liveness) if you only want to know the process is alive.

## Alerting — one channel

Route both UptimeRobot and Sentry alerts to a single notification channel (e.g. a
shared Slack channel or on-call email) so uptime and error signals land in one
place:

- **UptimeRobot:** **My Settings → Alert Contacts** → add your Slack webhook /
  email, then enable it on the monitor(s) above.
- **Sentry:** **Settings → Integrations** (Slack) or **Alerts → Create Alert
  Rule** → send notifications to the same Slack channel / email. Recommended
  rules: notify on a new issue and on an error-rate spike.

This keeps "the site is down" (UptimeRobot) and "the site is throwing errors"
(Sentry) — plus their linked Grafana traces — visible to the same responders.

## Environment variables (all optional)

See [GRAFANA_SETUP.md → Grafana Cloud](../GRAFANA_SETUP.md#grafana-cloud-managed--recommended-for-stagingprod)
for the full list. Summary:

| Var | Purpose |
|-----|---------|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OTLP traces endpoint (Grafana Cloud gateway `.../v1/traces`) |
| `OTEL_EXPORTER_LOGS_ENDPOINT` | OTLP logs endpoint (`.../v1/logs`) |
| `OTEL_EXPORTER_METRICS_ENDPOINT` | OTLP metrics endpoint (`.../v1/metrics`) |
| `OTEL_METRICS_EXPORTER` | `prometheus` (default) or `otlp` (push to cloud) |
| `OTEL_EXPORTER_OTLP_HEADERS` | Raw OTLP auth header (wins over the pair below) |
| `GRAFANA_CLOUD_INSTANCE_ID` + `GRAFANA_CLOUD_API_TOKEN` | Build `Authorization: Basic` for the OTLP gateway (legacy alias `GRAFANA_CLOUD_API_KEY`) |
| `SENTRY_DSN` | Enable Sentry error tracking (linked to OTel traces) |
| `SENTRY_TRACES_SAMPLE_RATE` | Optional Sentry-side perf sampling (0..1) |
| `SENTRY_RELEASE` | Optional release tag (defaults to package version) |

Unset everything ⇒ local behavior: Prometheus pull on `:9464`, OTLP to
`localhost:4318`, Sentry off.

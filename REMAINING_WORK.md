# Remaining Work Summary

**Last Updated:** 2026-07-22

This document provides an accurate, up-to-date summary of remaining work after verifying the actual codebase state.

---

## ✅ Recently Landed (integration/refactor-2026-02 → develop-v1.3.0)

- ✅ **God-file dissolution (complete)** — every god *service* AND god *controller*
  split into focused sub-units. `story.controller` and `admin.controller` split
  into cohesive sub-controllers; `story.service` reduced by extracting cohesive
  service groups.
- ✅ **Repository pattern everywhere** — all module services route DB access
  through per-model repositories (Symbol-token DI); no service touches Prisma
  directly. Straggler services + listeners migrated too.
- ✅ **Sync/async story generation unified** — both paths now go through a single
  `StoryGenerationService` (previously 8-way divergent), fixing the
  sync-vs-async story inconsistency.
- ✅ **develop-v1.2.0 delta-port** — subscription webhooks (Apple ASSN v2 + Google
  RTDN + Pub/Sub OIDC, incl. ReDoS fix), notification cron scheduler, guest-session
  keyv in-memory fallback, docker Redis password enforcement, TTS counter bug fix,
  and the chore backlog.
- ✅ **Blue-green dev environment** — v1.3.0 "blue" deployed alongside green on the
  shared host (backend `:3601` / frontend `:3010`, `storytime_db_blue`, Redis `/3`),
  with per-color nginx + TLS and manual-trigger deploy workflows across all three
  repos. See `docs/DEPLOYMENT_BLUE_GREEN.md`.

---

## ✅ What's Already Complete

### Testing
- ✅ **49 test suites, 686 passing tests** covering all major services
- ✅ **E2E tests** for authentication (41), payment (19), subscription (23), story CRUD (27), kid profiles (17), app health (1), global handlers (5)
- ✅ Test infrastructure with PostgreSQL and Redis services
- ✅ Jest coverage thresholds configured (70% lines/statements, 60% branches/functions)

### CI/CD
- ✅ **3 GitHub Actions workflows** (dev, staging, production)
- ✅ Code quality checks (lint, format, build)
- ✅ Automated deployment to EC2
- ✅ Health checks after deployment

### Code Quality
- ✅ **Error handling** — Domain exception hierarchy with error codes
- ✅ **Type safety** — Production `any` types eliminated, `noImplicitAny: true`
- ✅ **God-file refactoring** — all god services AND controllers dissolved into focused sub-units (see "Recently Landed")
- ✅ **Event-driven architecture** — 18+ events, 7 listeners, typed payloads
- ✅ **Repository pattern** — Implemented across **all** module services (not just the majors); no direct Prisma access in services
- ✅ **Circular dependency elimination** — 7 → 0 `forwardRef` usages
- ✅ **Shared utilities** — ErrorHandler, DateFormatUtil, isPremiumUser dedup
- ✅ **Lint cleanup** — 638 → 0 errors
- ✅ **Unused imports removed** — 16+ production files cleaned

### Performance
- ✅ **Database indexes** — 70+ indexes added
- ✅ **Caching** — Redis + in-memory with event-driven invalidation
- ✅ **Rate limiting** — All critical endpoints (auth, payment, story, device)
- ✅ **Transactions** — Atomic operations for critical paths
- ✅ **N+1 queries fixed** — Batched operations across services
- ✅ **Queue systems** — Story generation, voice synthesis, email queues with health monitoring
- ✅ **OpenTelemetry** — APM integration, HTTP latency tracking
- ✅ **Cache metrics** — Prometheus metrics for cache operations
- ✅ **Health indicators** — Database, Redis, SMTP, Queues, Firebase, Cloudinary, System
- ✅ **External API timeouts** — 30s on ElevenLabs, Deepgram, all HTTP services
- ✅ **Response optimization** — StoryListItemDto, excludeContent at DB level
- ✅ **Admin export chunking** — 1000-record batches

### Security
- ✅ **Session validation** — AuthSessionGuard, OAuth callbacks, token refresh
- ✅ **Input validation** — Global ValidationPipe, DTOs with class-validator
- ✅ **HTML sanitization** — Custom decorator for user content
- ✅ **Helmet security headers** — CSP, HSTS, X-Frame-Options
- ✅ **CORS** — Strict configuration per environment
- ✅ **Alerting thresholds** — WARNING/CRITICAL levels in config
- ✅ **GDPR cleanup** — Event-driven user deletion listener

### Infrastructure
- ✅ **Push notifications** — FCM integration
- ✅ **Server-Sent Events** — SSE for real-time updates
- ✅ **Device token management** — DeviceToken model and endpoints
- ✅ **Grafana setup documented** — GRAFANA_SETUP.md
- ✅ **Alerting rules documented** — ALERTING_RULES.md
- ✅ **Security audit complete** — SECURITY_AUDIT.md
- ✅ **Sentry (backend) LIVE** — project `storytime-be` (emerj org); `SENTRY_DSN`
  in the `ENV_FILE` secret (durable) + wired into green (`:3500`), staging (`:3600`),
  and blue (`:3601`) live envs, env-gated no-op when unset. Errors report + link to
  OTel traces. Issue-alert rule scoped (tag filter `environment` = production|staging)
  so dev noise never pages.
- ✅ **Grafana Cloud OTLP LIVE (blue only)** — traces/logs/metrics push to the
  Grafana Cloud gateway; `storytime-api` dashboard imported. Made durable in
  `blue-deploy.yml` (PR #437) so a redeploy re-injects the OTLP vars + token.
  Green/dev intentionally omits it.
- ✅ **Codecov LIVE** — repo activated, `CODECOV_TOKEN` secret set, coverage badge
  wired; CI upload gated + scoped to the upload step.

---

## 📋 What's Left To Do

### Priority 1 (Blue-green validation & promotion)

- [~] **Validate `blue.dev.*` end-to-end** — backend API smoke test PASSED
      2026-07-22 (see "Blue smoke-test results" below). Remaining: FE/mobile
      client validation against blue, and re-test after the TTS fix + a blue
      redeploy.
- [ ] Register mobile blue OAuth clients (Google iOS/Android, Firebase apps,
      Apple App ID for `net.emerj.storytime.blue`) and confirm blue backend trusts
      them — see the OAuth checklist in `docs/DEPLOYMENT_BLUE_GREEN.md`. **This is
      the one true blocker; requires console access (only the team can do it).**
- [ ] Promote blue → stable. **Model (decided):** `develop-v1.3.0` *becomes* the
      new stable branch — there is **NO merge-down** to `develop-v1.2.0`. Cut over
      green's deploy target to `develop-v1.3.0` (+ matching FE/mobile branches) once
      validated. (Supersedes the earlier "merge v1.3.0 → v1.2.0" plan.)

#### Blue smoke-test results (2026-07-22, backend API via `blue.dev.api.storytimeapp.me`)

**PASS:**
- Health/readiness (`/health/ready` 200) — DB up (4ms), Redis up on its own `/3`
  (22M), BullMQ queues clean, TTS circuit-breakers CLOSED. Swagger `/docs` 200
  (249 routes).
- Register → 200 + JWT (parent). Login correctly **blocked until email verified**
  ("Email not verified").
- 9 authed reads all 200: `/user/me`, `/stories/{categories,themes,seasons}`,
  `/stories/user/quota` (10 free), `/stories/homepage/parent`,
  `/subscription/{plans,me}`, `/payment/status`.
- **Async story generation** (`POST /stories/generate/async`) → 202 queued →
  worker processed → **completed in ~75s** → text story persisted
  ("Foxy's Brave Adventure") and retrievable in `/stories`. Confirms the BullMQ
  enqueue→worker→progress pipeline on blue's Redis `/3`.
- **SSE** (`GET /events/jobs`) → `text/event-stream` 200, stream held open.

**Issues found:**
- ⚠️ **TTS/audio generation fails** — generated story has `audioUrl` empty.
  Logs: Deepgram TTS timeout → Edge TTS timeout → "Voice generation failed on all
  providers". `ELEVENLABS_API_KEY` is **unset** on blue (the most reliable
  provider is missing), leaving only Deepgram + Edge TTS, both of which timed out.
  Needs: add an ElevenLabs key to blue's env and/or investigate the Deepgram/Edge
  timeouts. Observed once — confirm whether persistent or transient.
- ⚠️ **`Error: Socket closed unexpectedly` × ~114** in blue's PM2 error log
  (ioredis/BullMQ disconnect). Appears **stale** (log mtime predates the test; not
  spewing during it) — likely deploy/restart churn. Monitor; not currently blocking.
- ℹ️ **Catalog is empty** on blue (`/stories/categories|themes|seasons` → `[]`) —
  blue DB is unseeded. Run the seed if the FE needs a populated catalog.
- ℹ️ **`GET /user/me/export` (GDPR export, PR #432) is 404 on blue** — blue's
  running build predates that merge. A blue redeploy (`blue-deploy.yml`, manual
  `workflow_dispatch`) will pick it up along with PR #437's Grafana durability.
- 🧹 Two throwaway test accounts (`blue-smoke-*@example.com`, `reg-*@example.com`)
  were created in `storytime_db_blue` during the test; purge if desired.

### Priority 3 (Low — Optional)

**Infrastructure**
- [x] **Coverage badges in README** — Codecov upload wired into the `develop-v*`
      Test job (gated on `CODECOV_TOKEN`) + README badges (CI, coverage, tech
      stack, license, tooling). Codecov account/token setup **done** — repo
      activated, `CODECOV_TOKEN` secret set, badge graph token in README.
- [x] **Custom Grafana dashboards** — Grafana Cloud connected (blue OTLP push);
      `storytime-api` dashboard imported into the Cloud instance. Made durable via
      `blue-deploy.yml` (PR #437). NOTE: some panels may show "No Data" until the
      OTLP-converted metric names are reconciled with the dashboard's
      Prometheus-scrape names (or switch to Application Observability).

**Security (from SECURITY_AUDIT.md)**
- [x] **CSP hardening** — explicit strict global CSP with an `'unsafe-inline'`
      relaxation scoped to `/docs` only. (Honest form of "CSP nonce": the API
      renders no HTML of its own, so a per-request nonce would be dead config;
      the real gain is a strict CSP + a minimal scoped exception for Swagger UI.)
- [x] **Webhook authenticity** — the Google Pub/Sub verifier now **fails closed
      in production** (rejects when `GOOGLE_PUBSUB_AUDIENCE` is unset). Both
      webhooks already verify with platform-native crypto (Apple ASSN v2 JWS,
      Google OIDC) stronger than HMAC, so the real gap was this fail-open, not
      missing signing.
- [x] **GDPR data-portability export** — `GET /user/me/export` streams all
      user + kids data as a JSON download (secrets stripped; audit logs and
      payment tokens excluded).
- [ ] CAPTCHA for registration (~2h) — **un-blocked: free providers exist.**
      Recommended **Cloudflare Turnstile** (free at any scale, no request cap,
      privacy-friendly, near-drop-in server verify via
      `POST https://challenges.cloudflare.com/turnstile/v0/siteverify`). hCaptcha
      and reCAPTCHA v3 also have free tiers. Deferred earlier on the mistaken
      belief that no free option existed; ready to implement whenever prioritized.

---

## 📊 Current State Summary

| Area | Status | Coverage |
|------|--------|----------|
| **Unit Tests** | ✅ Excellent | 49 suites, 686 tests |
| **E2E Tests** | ✅ Complete | Auth, Payment, Subscription, Story, Kid |
| **CI/CD** | ✅ Complete | 3 workflows, quality gates |
| **Error Handling** | ✅ Complete | Domain exceptions, filters |
| **Type Safety** | ✅ Complete | Zero TS errors, noImplicitAny |
| **Architecture** | ✅ Excellent | God services refactored, event-driven |
| **Performance** | ✅ Excellent | Indexes, caching, queues, monitoring |
| **Security** | ✅ Complete | Rate limiting, validation, headers |
| **Infrastructure** | ✅ Complete | Health checks, metrics, notifications |
| **Lint** | ✅ Clean | Zero errors |

**Overall Assessment:** The codebase is in excellent shape. All P0/P1 code items are
complete. Blue's backend passed an end-to-end API smoke test (2026-07-22) with two
follow-ups: fix blue TTS/audio (ElevenLabs key unset + Deepgram/Edge timeouts) and
redeploy blue to pick up the GDPR export + Grafana durability. The remaining true
blocker for promotion is mobile blue OAuth client registration (console work). Then
promote by cutting green's deploy target to `develop-v1.3.0` (no merge-down).

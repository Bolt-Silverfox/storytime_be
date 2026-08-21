# Resilience: Retry + Circuit Breaker Consolidation — Design

**Date:** 2026-08-21
**Status:** Approved (design), pending implementation
**Repo:** storytime_be
**Base branch:** develop-v1.3.0

## Goal

Give storytime_be a single, reusable resilience layer — retry-with-exponential-backoff and a shared circuit breaker — that any external-service caller can compose, and route every external caller through it. This is the resilience4j equivalent for our NestJS/Node stack, built on the primitives we already have rather than a new dependency.

## Background — what already exists

- **Circuit breaker:** `src/shared/services/circuit-breaker.service.ts` — a real CLOSED/OPEN/HALF_OPEN state machine (`CircuitBreaker` + name-keyed `CircuitBreakerService` registry), with `isTransientError()` classifying 5xx/429/network errors as trippable and ignoring 4xx/validation. Defaults in `src/shared/constants/circuit-breaker.constants.ts`.
- **Breaker consumers today:** the TTS stack (`tts-batch.service.ts`, `tts-synthesis.service.ts`, `text-to-speech.service.ts`) via per-provider breakers (elevenlabs/deepgram/edgetts).
- **A duplicate inline breaker:** `src/story/gemini.service.ts` reimplements the same state machine privately (`CircuitState`, `canMakeRequest`, `recordSuccess`, `recordFailure`) with its own narrower transient predicate.
- **Retry-with-backoff:** exists only at the BullMQ job level (`attempts` + `backoff: exponential`) for story / email / push / voice-tts-batch queues, plus `NonRetryableProcessingException` to short-circuit permanent errors. There is **no** reusable retry for inline/request-path calls.
- **Unguarded external callers** (raw `httpService` axios, no breaker, no retry): `elevenlabs.service.ts`, `voice/providers/deepgram-tts.provider.ts` (has a manual timeout wrapper), `voice/services/voice-library.service.ts`, and `gemini.generateStoryImage` (HF FLUX). Payment (`payment.service.ts`, webhooks) also makes external calls.

## Non-goals

- No new npm dependency (no resilience4j-node, cockatiel, opossum, p-retry).
- No bulkhead, rate-limiter, or general time-limiter module (separate future work). The existing deepgram per-call timeout stays as-is.
- No change to the BullMQ job-level retry configuration.
- No changes to DB schema (no migrations).

## Design

### 1. New module: `src/shared/resilience/`

**`with-retry.ts`** — `withRetry<T>(fn: () => Promise<T>, opts?): Promise<T>`

- Options: `retries` (default 2), `baseDelayMs` (default 300), `maxDelayMs` (default 5000), `jitter` (default true, full-jitter), `isRetryable` (default `isTransientError`), optional `onRetry(attempt, error, delayMs)` hook for logging, optional `signal`/`shouldRetry` composition later.
- Behavior: attempt `fn`; on rejection, if `isRetryable(error)` is false OR attempts exhausted → rethrow the original error; else wait `min(maxDelayMs, baseDelayMs * 2^attempt)` with full jitter (`random(0, computed)`), then retry.
- Exponential base-2 growth. Full jitter = `Math.random() * cappedDelay`. Delay is never negative; `retries: 0` means exactly one attempt, no retry.
- Reuses the exported `isTransientError` from the circuit-breaker service — retry and breaker share one definition of "transient".

**`with-resilience.ts`** — `withResilience<T>(breaker: CircuitBreaker, fn: () => Promise<T>, opts?): Promise<T>`

- Compose semantics (decided): **breaker outer, retry inner.**
  1. `if (!breaker.canExecute()) throw new CircuitOpenError(breaker.name)` — fast-fail without retrying.
  2. Run `withRetry(fn, opts)`.
  3. On success → `breaker.recordSuccess()`, return.
  4. On final failure (after retries) → `breaker.recordFailure(error)`, rethrow.
- One logical call records exactly one success/failure to the breaker, regardless of how many inline retries happened. This matches how the TTS services already use `canExecute()`/`recordFailure()` — one model across the codebase.
- `CircuitOpenError` is a small typed error (extends `Error`) so callers can translate it to their own `ServiceUnavailableException` message. `withResilience` does NOT throw NestJS HTTP exceptions itself — callers own user-facing messaging.

**`index.ts`** — barrel export of `withRetry`, `withResilience`, `CircuitOpenError`, and re-export of `isTransientError` for convenience.

### 2. Migrate `gemini.service.ts` onto the shared breaker

- Delete the private `CircuitState`, `CIRCUIT_CONFIG`, `circuitState`/`failureCount`/`lastFailureTime`/`halfOpenAttempts`, `canMakeRequest`, `recordSuccess`, `recordFailure`.
- Inject `CircuitBreakerService`; obtain `getBreaker('gemini', { failureThreshold: 5, resetTimeoutMs: 60_000, halfOpenMaxAttempts: 1 })` (identical to today's constants).
- `generateStory`: gate with the breaker and record outcome. It already runs behind BullMQ story-queue retry, so **no inline `withRetry`** here (avoid double-retry). Preserve the existing user-facing exception mapping (network → ServiceUnavailable, 429/503 → ServiceUnavailable, else → InternalServerError) and the fast-fail-when-open message.
- Behavior parity: same thresholds; the shared `isTransientError` is a superset of Gemini's old predicate (adds other 5xx + more network patterns) — acceptable and arguably better. A regression test locks the trip threshold.
- Result: Gemini now appears in `getAllBreakers()`, so the TTS health indicator (or a renamed general resilience health indicator) reports it too — one breaker implementation, one health source.

### 3. Wrap the unguarded callers — path-aware to avoid double-retry

| Caller | Path | Treatment |
|---|---|---|
| `voice-library.service.ts` (GET) | request | breaker (`getBreaker('voice-library')`) + `withRetry` (default 2 retries) |
| `gemini.generateStoryImage` (HF FLUX POST) | request | breaker (`getBreaker('hf-image')`) + `withRetry` |
| `elevenlabs.service.ts` | queue (BullMQ processors) | breaker + **minimal** `withRetry` (`retries: 1`) — job backoff handles sustained outages |
| `deepgram-tts.provider.ts` | queue | breaker + `withRetry({ retries: 1 })`; keep existing per-call timeout wrapper |
| `payment.service.ts` / webhooks | request | **breaker only, NO auto-retry** — non-idempotent POSTs; retrying a charge is unsafe without idempotency keys (out of scope) |

- Breaker names are stable strings so each shows up independently in health/observability.
- Where a caller already maps errors to HTTP exceptions, keep that mapping; translate `CircuitOpenError` to the caller's existing "temporarily unavailable" message.

### 4. Health indicator

- The existing TTS health indicator reads `getAllBreakers()` filtered by `TTS_BREAKER_NAMES`. Broaden it (or add a sibling) to report all registered breakers — gemini, hf-image, voice-library, payment included — so the new breakers are observable. Keep the existing TTS-filtered view intact for its current consumer.

## Testing

- `with-retry.spec.ts`: succeeds first try (no delay); retries exactly `retries` times then rethrows original error; non-retryable predicate → immediate rethrow, no wait; backoff sequence and full-jitter bounds using fake timers; `retries: 0` = single attempt.
- `with-resilience.spec.ts`: open circuit → `CircuitOpenError`, `fn` never called; success records one success; failure-after-retries records exactly one failure; records are one-per-logical-call regardless of inner retries.
- `gemini.service.spec.ts` (extend existing): breaker trips after 5 transient failures and fast-fails; 4xx/parse errors do NOT trip; success closes it.
- Each wrapped caller: a focused test that a transient error is retried and a circuit-open state fast-fails; payment test asserts **no** retry on failure.

## Rollout

- Single feature branch `feat/resilience-retry-cb` off `develop-v1.3.0`, executed task-by-task (SDD). Opened as a PR for the owner to merge (deploy-triggering on merge). Standing constraints apply: no Claude signature in commits/PRs; never run `prisma migrate dev`.
- Green→blue parity: this lands on blue (`develop-v1.3.0`) first; if desired, port to green (`develop-v1.2.0`) as a follow-up per the parity invariant.

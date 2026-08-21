# Resilience: Retry + Circuit Breaker Consolidation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a reusable `withRetry` + `withResilience` layer, migrate Gemini's inline circuit breaker onto the shared `CircuitBreakerService`, route all external callers through breaker (+ path-appropriate retry), and make every breaker observable.

**Architecture:** New `src/shared/resilience/` module exporting `withRetry`, `withResilience`, `CircuitOpenError`. `withResilience` composes **breaker-outer / retry-inner**: the breaker gates and records one outcome per logical call; `withRetry` handles transient blips inside. Both reuse the existing `isTransientError` predicate so retry and breaker agree on "transient".

**Tech Stack:** NestJS 11, TypeScript, Jest. `@nestjs/axios` (`HttpService`) for HTTP callers. No new dependencies.

## Global Constraints

- **No new npm dependency.** Build only on existing primitives (`CircuitBreaker`, `CircuitBreakerService`, `isTransientError`).
- **`SharedModule` is `@Global()`** and already exports `CircuitBreakerService` — inject it directly anywhere; **no module `imports` wiring is needed**.
- **Compose order is fixed:** breaker outer, retry inner. One logical call records exactly one `recordSuccess`/`recordFailure` on the breaker.
- **`isTransientError` is the single source of truth** for what retry retries and what trips the breaker (5xx/429/network; never 4xx/validation).
- **Never double-retry:** callers already running under a BullMQ processor get `retries: 1` at most; request-path callers get the default (`retries: 2`).
- **Payment external calls: breaker only, never auto-retry** (non-idempotent).
- **No user-facing behavior regressions:** preserve each caller's existing error→HTTP-exception mapping; translate `CircuitOpenError` to that caller's existing "temporarily unavailable" message.
- No DB schema changes; never run `prisma migrate dev`. No Claude signature in commits/PRs.
- Path aliases use `@/` → `src/`.

---

## File Structure

- `src/shared/resilience/with-retry.ts` — `withRetry` + `RetryOptions`
- `src/shared/resilience/with-resilience.ts` — `withResilience` + `CircuitOpenError` + `ResilienceOptions`
- `src/shared/resilience/index.ts` — barrel
- `src/shared/resilience/with-retry.spec.ts`, `with-resilience.spec.ts` — unit tests
- Modified: `src/story/gemini.service.ts` (migrate breaker), `src/voice/services/voice-library.service.ts`, `src/story/elevenlabs.service.ts`, `src/voice/providers/deepgram-tts.provider.ts`, `src/payment/payment.service.ts`
- New: `src/health/indicators/circuit-breaker.health.ts` (general, all breakers) + registration in `src/health/health.module.ts`, `src/health/health.controller.ts`

---

### Task 1: `withRetry` helper

**Files:**
- Create: `src/shared/resilience/with-retry.ts`
- Test: `src/shared/resilience/with-retry.spec.ts`

**Interfaces:**
- Produces: `withRetry<T>(fn: () => Promise<T>, opts?: RetryOptions): Promise<T>`; `interface RetryOptions { retries?: number; baseDelayMs?: number; maxDelayMs?: number; jitter?: boolean; isRetryable?: (e: unknown) => boolean; onRetry?: (attempt: number, error: unknown, delayMs: number) => void; }`
- Consumes: `isTransientError` from `@/shared/services/circuit-breaker.service`.

- [ ] **Step 1: Write the failing test**

```ts
// src/shared/resilience/with-retry.spec.ts
import { withRetry } from './with-retry';

describe('withRetry', () => {
  it('returns immediately on first success without delay', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    await expect(withRetry(fn)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries transient failures up to `retries` then rethrows the original error', async () => {
    const err = { status: 503 };
    const fn = jest.fn().mockRejectedValue(err);
    await expect(
      withRetry(fn, { retries: 2, baseDelayMs: 0, jitter: false }),
    ).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(3); // 1 + 2 retries
  });

  it('does not retry non-transient errors', async () => {
    const err = { status: 400 };
    const fn = jest.fn().mockRejectedValue(err);
    await expect(withRetry(fn, { retries: 3, baseDelayMs: 0 })).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries: 0 means a single attempt', async () => {
    const fn = jest.fn().mockRejectedValue({ status: 500 });
    await expect(withRetry(fn, { retries: 0 })).rejects.toBeDefined();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('honors a custom isRetryable predicate', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('nope'));
    await expect(
      withRetry(fn, { retries: 2, baseDelayMs: 0, isRetryable: () => false }),
    ).rejects.toThrow('nope');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('caps delay at maxDelayMs and stays within full-jitter bounds', async () => {
    const delays: number[] = [];
    const fn = jest.fn().mockRejectedValue({ status: 500 });
    await expect(
      withRetry(fn, {
        retries: 3,
        baseDelayMs: 100,
        maxDelayMs: 250,
        jitter: true,
        onRetry: (_a, _e, d) => delays.push(d),
      }),
    ).rejects.toBeDefined();
    // computed caps: 100, 200, 250; full jitter => 0..cap
    expect(delays.length).toBe(3);
    expect(delays[0]).toBeGreaterThanOrEqual(0);
    expect(delays[0]).toBeLessThanOrEqual(100);
    expect(delays[2]).toBeLessThanOrEqual(250);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- with-retry.spec`
Expected: FAIL (module not found / `withRetry` undefined)

- [ ] **Step 3: Write minimal implementation**

```ts
// src/shared/resilience/with-retry.ts
import { isTransientError } from '@/shared/services/circuit-breaker.service';

export interface RetryOptions {
  /** Number of retries AFTER the first attempt. Default 2. */
  retries?: number;
  /** Base backoff delay in ms (grows 2^attempt). Default 300. */
  baseDelayMs?: number;
  /** Upper bound on a single backoff delay. Default 5000. */
  maxDelayMs?: number;
  /** Apply full jitter (random(0, cappedDelay)). Default true. */
  jitter?: boolean;
  /** Whether an error is worth retrying. Default: isTransientError. */
  isRetryable?: (error: unknown) => boolean;
  /** Observability hook, called before each backoff wait. */
  onRetry?: (attempt: number, error: unknown, delayMs: number) => void;
}

const sleep = (ms: number): Promise<void> =>
  ms <= 0 ? Promise.resolve() : new Promise((r) => setTimeout(r, ms));

/**
 * Run `fn`, retrying transient failures with exponential backoff + full jitter.
 * Rethrows the ORIGINAL error when retries are exhausted or the error is not
 * retryable. `retries: 0` runs `fn` exactly once.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const {
    retries = 2,
    baseDelayMs = 300,
    maxDelayMs = 5000,
    jitter = true,
    isRetryable = isTransientError,
    onRetry,
  } = opts;

  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= retries || !isRetryable(error)) throw error;
      const capped = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
      const delay = jitter ? Math.random() * capped : capped;
      onRetry?.(attempt + 1, error, delay);
      await sleep(delay);
      attempt++;
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- with-retry.spec`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/shared/resilience/with-retry.ts src/shared/resilience/with-retry.spec.ts
git commit -m "feat(resilience): add withRetry helper (exponential backoff + jitter)"
```

---

### Task 2: `withResilience` + `CircuitOpenError` + barrel

**Files:**
- Create: `src/shared/resilience/with-resilience.ts`
- Create: `src/shared/resilience/index.ts`
- Test: `src/shared/resilience/with-resilience.spec.ts`

**Interfaces:**
- Consumes: `withRetry`/`RetryOptions` (Task 1); `CircuitBreaker` from `@/shared/services/circuit-breaker.service`.
- Produces: `withResilience<T>(breaker: CircuitBreaker, fn: () => Promise<T>, opts?: RetryOptions): Promise<T>`; `class CircuitOpenError extends Error`. `index.ts` re-exports `withRetry`, `RetryOptions`, `withResilience`, `CircuitOpenError`, and `isTransientError`.

- [ ] **Step 1: Write the failing test**

```ts
// src/shared/resilience/with-resilience.spec.ts
import { withResilience, CircuitOpenError } from './with-resilience';
import {
  CircuitBreaker,
  CircuitState,
} from '@/shared/services/circuit-breaker.service';

const makeBreaker = () =>
  new CircuitBreaker('test', {
    failureThreshold: 2,
    resetTimeoutMs: 60_000,
    halfOpenMaxAttempts: 1,
  });

describe('withResilience', () => {
  it('fast-fails with CircuitOpenError when breaker is OPEN, never calling fn', async () => {
    const breaker = makeBreaker();
    // Trip it: 2 transient failures.
    breaker.recordFailure({ status: 500 });
    breaker.recordFailure({ status: 500 });
    expect(breaker.getSnapshot().state).toBe(CircuitState.OPEN);
    const fn = jest.fn();
    await expect(withResilience(breaker, fn)).rejects.toBeInstanceOf(
      CircuitOpenError,
    );
    expect(fn).not.toHaveBeenCalled();
  });

  it('records exactly one success on success, regardless of inner retries', async () => {
    const breaker = makeBreaker();
    const spy = jest.spyOn(breaker, 'recordSuccess');
    const fn = jest
      .fn()
      .mockRejectedValueOnce({ status: 503 })
      .mockResolvedValue('ok');
    await expect(
      withResilience(breaker, fn, { retries: 2, baseDelayMs: 0 }),
    ).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('records exactly one failure after retries are exhausted', async () => {
    const breaker = makeBreaker();
    const spy = jest.spyOn(breaker, 'recordFailure');
    const err = { status: 500 };
    const fn = jest.fn().mockRejectedValue(err);
    await expect(
      withResilience(breaker, fn, { retries: 2, baseDelayMs: 0 }),
    ).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(3);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- with-resilience.spec`
Expected: FAIL (module not found)

- [ ] **Step 3: Write minimal implementation**

```ts
// src/shared/resilience/with-resilience.ts
import { CircuitBreaker } from '@/shared/services/circuit-breaker.service';
import { withRetry, RetryOptions } from './with-retry';

/** Thrown when a call is rejected because its circuit breaker is OPEN. */
export class CircuitOpenError extends Error {
  constructor(readonly breakerName: string) {
    super(`Circuit breaker "${breakerName}" is OPEN`);
    this.name = 'CircuitOpenError';
  }
}

/**
 * Compose a circuit breaker (outer) with retry (inner).
 * - If the breaker is OPEN, fast-fail with CircuitOpenError; `fn` is not run.
 * - Otherwise run `withRetry(fn, opts)`; record ONE success/failure on the
 *   breaker for the whole logical call.
 */
export async function withResilience<T>(
  breaker: CircuitBreaker,
  fn: () => Promise<T>,
  opts?: RetryOptions,
): Promise<T> {
  if (!breaker.canExecute()) {
    throw new CircuitOpenError(breaker.name);
  }
  try {
    const result = await withRetry(fn, opts);
    breaker.recordSuccess();
    return result;
  } catch (error) {
    breaker.recordFailure(error);
    throw error;
  }
}
```

```ts
// src/shared/resilience/index.ts
export { withRetry } from './with-retry';
export type { RetryOptions } from './with-retry';
export { withResilience, CircuitOpenError } from './with-resilience';
export { isTransientError } from '@/shared/services/circuit-breaker.service';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- with-resilience.spec`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/shared/resilience/with-resilience.ts src/shared/resilience/index.ts src/shared/resilience/with-resilience.spec.ts
git commit -m "feat(resilience): add withResilience (breaker-outer/retry-inner) + CircuitOpenError"
```

---

### Task 3: Migrate `gemini.service.ts` onto the shared breaker

**Files:**
- Modify: `src/story/gemini.service.ts`
- Test: extend `src/story/gemini.service.spec.ts` (create if absent)

**Interfaces:**
- Consumes: `CircuitBreakerService` (injected; `@Global` SharedModule — no module edit), `CircuitOpenError` from `@/shared/resilience`.

**Context:** `generateStory` runs behind BullMQ story-queue retry, so it gets the breaker but **no inline `withRetry`** (avoid double-retry). Replace the private breaker with a named shared breaker `'gemini'`.

- [ ] **Step 1: Write the failing test** — assert breaker behavior via the shared service.

```ts
// src/story/gemini.service.spec.ts (add cases)
// Arrange GeminiService with a mocked genAI that rejects with { status: 503 }.
// After 5 rejections, canExecute() on the 'gemini' breaker is false and
// generateStory throws ServiceUnavailableException (fast-fail).
// A { status: 400 }/parse error must NOT trip the breaker.
```

Concretely: inject a real `CircuitBreakerService`, stub `genAI.models.generateContent`, and assert `cbService.getBreaker('gemini').getSnapshot().state` transitions to `OPEN` after 5 transient (503) failures, and stays `CLOSED` after a 400.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- gemini.service.spec`
Expected: FAIL (still using private breaker; no `'gemini'` breaker registered)

- [ ] **Step 3: Implement the migration**

- Delete: the local `enum CircuitState`, `const CIRCUIT_CONFIG`, fields `circuitState`/`failureCount`/`lastFailureTime`/`halfOpenAttempts`, and methods `canMakeRequest`/`recordSuccess`/`recordFailure`.
- Inject `private readonly cbService: CircuitBreakerService` and in the constructor obtain the breaker:
  ```ts
  private readonly breaker = this.cbService.getBreaker('gemini', {
    failureThreshold: 5,
    resetTimeoutMs: 60_000,
    halfOpenMaxAttempts: 1,
  });
  ```
  (Assign in the constructor body after `super`/field init, since it depends on the injected service.)
- In `generateStory`: replace `if (!this.canMakeRequest())` with `if (!this.breaker.canExecute())` (same fast-fail `ServiceUnavailableException`). Replace `this.recordSuccess()` with `this.breaker.recordSuccess()`. In the catch, replace the private `recordFailure()` logic with `this.breaker.recordFailure(error)` (the breaker already filters non-transient via `isTransientError`, so drop the local `isTransientError` computation used ONLY for the breaker; keep the separate error-message classification used for choosing the user-facing exception).
- Keep all user-facing exception mapping exactly as-is.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- gemini.service.spec`
Expected: PASS. Also run `pnpm test -- story` to confirm no story regressions.

- [ ] **Step 5: Commit**

```bash
git add src/story/gemini.service.ts src/story/gemini.service.spec.ts
git commit -m "refactor(story): migrate Gemini onto shared CircuitBreakerService"
```

---

### Task 4: Wrap request-path callers (voice-library GET, Gemini HF image)

**Files:**
- Modify: `src/voice/services/voice-library.service.ts`, `src/story/gemini.service.ts`
- Test: focused cases in the respective `.spec.ts`

**Context:** Both are request-path calls with no outer retry. Wrap each external `httpService` call in `withResilience(breaker, fn, { retries: 2 })`.

- [ ] **Step 1: Write failing tests** — a transient (503) rejection is retried then surfaced, and an OPEN breaker fast-fails (translated to the caller's existing "unavailable" message). Assert `httpService` call count reflects the retry.

- [ ] **Step 2: Run to verify failure.** Run: `pnpm test -- voice-library.service.spec` (and `gemini.service.spec`). Expected FAIL.

- [ ] **Step 3: Implement**

- `voice-library.service.ts`: inject `CircuitBreakerService`; `const breaker = this.cbService.getBreaker('voice-library')`. Wrap the `firstValueFrom(this.httpService.get(...))` body in `withResilience(breaker, () => firstValueFrom(this.httpService.get(...)))`. Catch `CircuitOpenError` (and exhausted transient errors) and map to the service's existing failure behavior.
- `gemini.generateStoryImage`: `const breaker = this.cbService.getBreaker('hf-image')`. Wrap the `firstValueFrom(this.httpService.post(HF_IMAGE_API_URL, ...))` in `withResilience`. Preserve the existing `InternalServerErrorException` mapping; map `CircuitOpenError` to the same "Failed to generate cover image" message (or a ServiceUnavailable variant).

- [ ] **Step 4: Run tests.** Expected PASS. Run `pnpm test -- voice` and `pnpm test -- story`.

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(resilience): wrap request-path callers (voice-library, HF image) in breaker+retry"
```

---

### Task 5: Wrap queue-path callers (ElevenLabs, Deepgram provider)

**Files:**
- Modify: `src/story/elevenlabs.service.ts`, `src/voice/providers/deepgram-tts.provider.ts`
- Test: focused cases in the respective `.spec.ts`

**Context:** Invoked under BullMQ processors that already retry with long backoff. Add breaker + **minimal** retry (`retries: 1`) so a one-off transient blip is smoothed without stacking two heavy retry loops. Keep Deepgram's existing per-call timeout wrapper.

- [ ] **Step 1: Write failing tests** — one transient retry happens (`retries: 1` ⇒ 2 attempts), OPEN breaker fast-fails; deepgram timeout wrapper still applies.

- [ ] **Step 2: Run to verify failure.** Expected FAIL.

- [ ] **Step 3: Implement** — inject `CircuitBreakerService` in each; reuse the existing breaker names already used by the TTS stack where applicable (`elevenlabs`, `deepgram`) via `getBreaker(...)` so there is ONE breaker per provider shared with `TTS_CIRCUIT_BREAKER_CONFIG`. Wrap the HTTP call in `withResilience(breaker, () => <existing call>, { retries: 1 })`. Preserve existing error mapping and the deepgram timeout.

  NOTE: verify whether `tts-synthesis`/`tts-batch` already create `getBreaker('elevenlabs'|'deepgram')`; if so, reuse the same name so state is shared (the registry returns the existing instance). Do not create a second differently-named breaker for the same provider.

- [ ] **Step 4: Run tests.** Run `pnpm test -- elevenlabs` and `pnpm test -- deepgram` and `pnpm test -- tts`. Expected PASS.

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(resilience): breaker + minimal retry for queue-path TTS providers"
```

---

### Task 6: Payment — breaker only, no auto-retry

**Files:**
- Modify: `src/payment/payment.service.ts`
- Test: focused case in `src/payment/*.spec.ts`

**Context:** Payment POSTs are not guaranteed idempotent; **never auto-retry**. Add breaker gating only, so a sustained payment-gateway outage fast-fails instead of hammering.

- [ ] **Step 1: Write failing test** — on repeated transient failures the `'payment'` breaker opens and subsequent calls fast-fail; assert the external call is **not** retried (call count == 1 per invocation).

- [ ] **Step 2: Run to verify failure.** Expected FAIL.

- [ ] **Step 3: Implement** — inject `CircuitBreakerService`; `const breaker = this.cbService.getBreaker('payment')`. Wrap outbound gateway call(s) in `withResilience(breaker, fn, { retries: 0 })` (retries: 0 ⇒ no retry; breaker still gates + records). Map `CircuitOpenError` to the existing payment failure exception.

- [ ] **Step 4: Run tests.** Run `pnpm test -- payment`. Expected PASS.

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(resilience): breaker-only guard for payment gateway calls (no retry)"
```

---

### Task 7: General circuit-breaker health indicator

**Files:**
- Create: `src/health/indicators/circuit-breaker.health.ts`
- Modify: `src/health/health.module.ts`, `src/health/health.controller.ts`
- Test: `src/health/indicators/circuit-breaker.health.spec.ts`

**Context:** The existing `TTSCircuitBreakerHealthIndicator` filters to `TTS_BREAKER_NAMES`. Add a sibling that reports ALL registered breakers (gemini, hf-image, voice-library, payment, plus TTS) so the new breakers are observable. Leave the TTS indicator untouched.

- [ ] **Step 1: Write failing test** — with two breakers registered (one OPEN), the indicator reports both in `details` and marks unhealthy when any is OPEN; healthy when all CLOSED.

- [ ] **Step 2: Run to verify failure.** Run: `pnpm test -- circuit-breaker.health`. Expected FAIL.

- [ ] **Step 3: Implement** — copy the structure of `tts-circuit-breaker.health.ts` but iterate ALL `getAllBreakers()` without the `TTS_BREAKER_NAMES` filter; key `'circuit_breakers'`. Register the provider in `health.module.ts` and add its check to the aggregate in `health.controller.ts` alongside the TTS one.

- [ ] **Step 4: Run tests.** Run `pnpm test -- health`. Expected PASS.

- [ ] **Step 5: Commit**

```bash
git add src/health/indicators/circuit-breaker.health.ts src/health/indicators/circuit-breaker.health.spec.ts src/health/health.module.ts src/health/health.controller.ts
git commit -m "feat(health): report all circuit breakers via general health indicator"
```

---

## Self-Review Notes

- **Spec coverage:** withRetry (T1), withResilience/CircuitOpenError (T2), gemini migration (T3), request-path wrap (T4), queue-path wrap (T5), payment breaker-only (T6), health broadening (T7) — all spec sections covered.
- **Type consistency:** `withResilience(breaker, fn, opts?: RetryOptions)` uses the same `RetryOptions` from T1; barrel re-exports match. `getBreaker(name, config?)` matches the existing signature.
- **Double-retry guard:** T3 (gemini generateStory) and T5 (queue-path) explicitly avoid/​minimize inline retry; T4 request-path uses default; T6 payment uses `retries: 0`.
- **No wiring churn:** SharedModule `@Global` — every task injects `CircuitBreakerService` directly.

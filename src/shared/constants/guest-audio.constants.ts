/**
 * Limits for guest (unauthenticated) story audio. Guest sessions are free to
 * create, so every knob that can cost money is capped here.
 */

/** Max paragraphs considered per guest audio request (matches the authed cap). */
export const GUEST_AUDIO_MAX_PARAGRAPHS = 50;

/**
 * Max characters of NEW audio a single guest request may generate. A typical
 * story is ~8k characters, so this leaves headroom for long ones while
 * bounding the worst case. Cache hits are free and not counted.
 */
export const GUEST_AUDIO_MAX_GENERATE_CHARS = 20_000;

/** Paragraphs generated synchronously so playback can start immediately. */
export const GUEST_AUDIO_EAGER_PARAGRAPHS = 2;

/**
 * Throttle values for the guest audio routes.
 *
 * Per IP (global ThrottlerGuard, tracker = req.ip): sessions are free to mint,
 * so the IP is the only identity an attacker cannot rotate cheaply. A NAT'd
 * classroom may share one IP, hence 20 starts/min but only 120/hour.
 *
 * Per guest session (GuestSessionThrottleGuard): a session may open at most 3
 * stories, so 6 starts per 10 minutes covers re-opens; status polling runs
 * every few seconds while a story generates.
 */
export const GUEST_AUDIO_THROTTLE = {
  start: {
    ip: { limit: 20, ttl: 60_000 },
    ipHourly: { limit: 120, ttl: 3_600_000 },
    session: { limit: 6, ttl: 600_000 },
  },
  status: {
    ip: { limit: 120, ttl: 60_000 },
    session: { limit: 240, ttl: 600_000 },
  },
} as const;

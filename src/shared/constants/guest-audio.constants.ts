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
 * Throttle values for the guest audio routes. They map onto the app's three
 * named throttlers (see throttle.config.ts), overridden per route:
 *  - `short`  -> per IP, per minute  (global tracker = req.ip)
 *  - `medium` -> per IP, per hour    (start route only)
 *  - `long`   -> per GUEST SESSION   (custom tracker = x-guest-session-id)
 *
 * Guest sessions are free to mint, so the IP is the identity an attacker
 * cannot rotate cheaply; the hourly IP cap bounds how fast one source can walk
 * the catalogue (each story only ever generates once, then is cached). A NAT'd
 * classroom can still start 20 stories/min. A session may open at most 3
 * stories, so 6 starts per 10 minutes covers legitimate re-opens; status polls
 * run every few seconds while a story generates.
 */
export const GUEST_AUDIO_THROTTLE = {
  start: {
    ipPerMinute: { limit: 20, ttl: 60_000 },
    ipPerHour: { limit: 60, ttl: 3_600_000 },
    perSession: { limit: 6, ttl: 600_000 },
  },
  status: {
    ipPerMinute: { limit: 120, ttl: 60_000 },
    perSession: { limit: 240, ttl: 600_000 },
  },
} as const;

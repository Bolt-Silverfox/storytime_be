export const PASSWORDLESS_CODE_TTL_SECONDS = 600;
export const PASSWORDLESS_RESEND_AFTER_SECONDS = 60;
export const PASSWORDLESS_INVALID_MESSAGE = 'Invalid or expired code';
export const PASSWORDLESS_CLEANUP_GRACE_MS = 24 * 60 * 60 * 1000;
export const PASSWORDLESS_CLEANUP_BATCH = 1000;
export const PASSWORDLESS_CLEANUP_MAX_BATCHES = 20;

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

export const PASSWORDLESS_LIMITS = {
  requestPerEmailBurst: { windowMs: MINUTE_MS, max: 1 },
  requestPerEmailHour: { windowMs: HOUR_MS, max: 5 },
  requestPerIp: { windowMs: 15 * MINUTE_MS, max: 10 },
  requestPerEmailDay: { windowMs: 24 * HOUR_MS, max: 10 },
  requestGlobal: { windowMs: HOUR_MS, max: 1000 },
  verifyPerIp: { windowMs: 15 * MINUTE_MS, max: 20 },
  verifyPerEmail: { windowMs: 15 * MINUTE_MS, max: 10 },
  failedVerifyPerEmailDay: { windowMs: 24 * HOUR_MS, max: 20 },
} as const;

export const PASSWORDLESS_GLOBAL_KEY = 'pwl:req:global';

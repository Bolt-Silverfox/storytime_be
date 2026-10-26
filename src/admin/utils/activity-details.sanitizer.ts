/**
 * Sanitiser for `ActivityLog.details` before it is shown to an admin.
 *
 * `details` is a free-form string column: some writers store JSON
 * (`{"provider":"..","credits":3}`), others store prose
 * (`"User registered: a@b.com"`). Either may carry something that must not be
 * shown even to an admin (tokens, passwords, PINs, other people's emails), so
 * the output is built by redaction rather than passed through:
 *
 *  - JSON objects: keys that look secret-like have their value replaced; every
 *    string value is scanned for emails / JWTs / bearer tokens / long opaque
 *    blobs; depth, array length and string length are capped.
 *  - Anything else (prose, arrays, scalars) is returned as `{ message }` with
 *    the same string scrubbing applied.
 */
export const REDACTED = '[REDACTED]';
export const TRUNCATED = '[truncated]';

const MAX_DEPTH = 5;
const MAX_ARRAY_ITEMS = 50;
const MAX_STRING_LENGTH = 500;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

// Whole-word key tokens (split on camelCase / non-alphanumerics) that mark a
// value as secret. Whole-token matching keeps `shipping` / `mapping` visible.
const SECRET_KEY_TOKENS = new Set([
  'pin',
  'otp',
  'pwd',
  'hash',
  'cookie',
  'cvv',
  'signature',
  'email',
  'jwt',
]);
// Substrings of the lower-cased, separator-stripped key.
const SECRET_KEY_SUBSTRINGS = [
  'password',
  'passwd',
  'secret',
  'token',
  'apikey',
  'privatekey',
  'authorization',
  'credential',
];

const EMAIL_RE = /[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const JWT_RE = /eyJ[\w-]+\.[\w-]+\.[\w-]+/g;
const BEARER_RE = /\bBearer\s+\S+/gi;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OPAQUE_BLOB_RE = /^[A-Za-z0-9+/=_-]{32,}$/;

function isSecretKey(key: string): boolean {
  const tokens = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  if (tokens.some((t) => SECRET_KEY_TOKENS.has(t))) return true;
  const joined = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  return SECRET_KEY_SUBSTRINGS.some((s) => joined.includes(s));
}

function scrubString(value: string): string {
  if (UUID_RE.test(value)) return value;
  const scrubbed = value
    .replace(JWT_RE, REDACTED)
    .replace(BEARER_RE, REDACTED)
    .replace(EMAIL_RE, REDACTED);
  if (OPAQUE_BLOB_RE.test(scrubbed)) return REDACTED;
  return scrubbed.length > MAX_STRING_LENGTH
    ? `${scrubbed.slice(0, MAX_STRING_LENGTH)}…`
    : scrubbed;
}

function scrubValue(value: unknown, depth: number): unknown {
  if (value === null || typeof value === 'number' || typeof value === 'boolean')
    return value;
  if (typeof value === 'string') return scrubString(value);
  if (depth > MAX_DEPTH) return TRUNCATED;
  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((item) => scrubValue(item, depth + 1));
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN_KEYS.has(key)) continue;
      out[key] = isSecretKey(key) ? REDACTED : scrubValue(v, depth + 1);
    }
    return out;
  }
  return TRUNCATED; // undefined / function / symbol / bigint: never expected
}

export function sanitizeActivityDetails(
  raw: string | null | undefined,
): Record<string, unknown> | null {
  if (raw === null || raw === undefined || raw.trim() === '') return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { message: scrubString(raw) };
  }
  if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
    return scrubValue(parsed, 1) as Record<string, unknown>;
  }
  return { message: scrubString(raw) };
}

/** The story an activity row refers to, when its (sanitised) details say so. */
export function extractStoryId(
  details: Record<string, unknown> | null,
): string | null {
  if (!details) return null;
  const candidate = details.storyId ?? details.story_id;
  return typeof candidate === 'string' && candidate.length > 0
    ? candidate
    : null;
}

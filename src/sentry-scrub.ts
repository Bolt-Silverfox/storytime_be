import type {
  Breadcrumb,
  ErrorEvent,
  Event as SentryEvent,
  NodeOptions,
} from '@sentry/node';

/**
 * Pure helpers that strip credentials from Sentry events before they leave the
 * process. @sentry/node copies every request header (incl. `authorization` and
 * `cookie`) onto events raised during an HTTP request, so we redact by key name.
 * No side effects on import; safe to unit test.
 */
type TxEvent = Parameters<NonNullable<NodeOptions['beforeSendTransaction']>>[0];

export const REDACTED = '[Filtered]';

const SENSITIVE_SUBSTRING =
  /auth|token|cookie|secret|key|session|password|passwd|pwd|credential|jwt|bearer|private|signature/i;

/**
 * Whole words (split on non-alphanumerics and camelCase boundaries) that mark a
 * key as secret. Word matching keeps e.g. `spinner` / `company` / `expand`
 * readable while still catching `pin`, `newPin`, `pin-reset-otp`, `cardNumber`.
 */
const SENSITIVE_WORDS = new Set([
  'pin',
  'otp',
  'code',
  'cvv',
  'cvc',
  'card',
  'pan',
  'sig',
  'reset',
  'nonce',
  'state',
]);

const PII_SUBSTRING =
  /e-?mail|phone|msisdn|first.?name|last.?name|full.?name|display.?name|user.?name|birth|age.?range|avatar|client.?ip|forwarded|real.?ip|remote.?addr/i;

const ADDRESS_SUBSTRING = /address/i;

const USER_AGENT_KEY = /user.?agent/i;

const CLIENT_IDENTITY_KEYS = new Set([
  'client.address',
  'client.socket.address',
  'http.client_ip',
  'net.peer.ip',
  'net.sock.peer.addr',
  'network.peer.address',
  'user_agent.original',
]);

const HEADER_ATTR_PREFIX = 'http.request.header.';

const OUTCOME_VALUES = new Set([
  'invalid_request',
  'invalid_client',
  'invalid_grant',
  'unauthorized_client',
  'unsupported_grant_type',
  'invalid_scope',
  'invalid_token',
  'access_denied',
  'expired',
  'invalid',
  'missing',
  'required',
]);

type Scope = 'credentials' | 'headers' | 'attrs';

const PII_WORDS = new Set([
  'name',
  'dob',
  'age',
  'kid',
  'kids',
  'child',
  'children',
  'ip',
]);

const OUTCOME_WORDS = new Set(['status']);

const MAX_DEPTH = 10;
const MAX_TEXT = 20_000;

function words(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function isSensitive(key: string, scope: Scope = 'attrs'): boolean {
  if (SENSITIVE_SUBSTRING.test(key)) return true;
  const pii = scope !== 'credentials';
  if (pii && PII_SUBSTRING.test(key)) return true;
  if (scope === 'attrs' && USER_AGENT_KEY.test(key)) return true;
  const lower = key.toLowerCase();
  if (pii && CLIENT_IDENTITY_KEYS.has(lower)) return true;
  if (lower.startsWith(HEADER_ATTR_PREFIX)) {
    return isSensitive(key.slice(HEADER_ATTR_PREFIX.length), scope);
  }
  if (key.includes('.')) return false;
  if (pii && ADDRESS_SUBSTRING.test(key)) return true;
  const w = words(key);
  if (w.some((x) => OUTCOME_WORDS.has(x))) return false;
  return w.some((x) => SENSITIVE_WORDS.has(x) || (pii && PII_WORDS.has(x)));
}

function decodeKey(raw: string): string {
  try {
    return decodeURIComponent(raw.replace(/\+/g, ' '));
  } catch {
    return raw;
  }
}

/**
 * True when a (possibly percent-encoded, up to 3 layers) value itself carries a
 * sensitive `k=v` pair, e.g. `continue=%2Fcb%3Ftoken%3Dsecret`.
 */
function hasNestedSecret(value: string): boolean {
  let cur = value;
  for (let i = 0; i < 4; i++) {
    if (cur.includes('=') && scrubText(cur, false) !== cur) return true;
    let next: string;
    try {
      next = decodeURIComponent(cur.replace(/\+/g, ' '));
    } catch {
      return false;
    }
    if (next === cur) return false;
    cur = next;
  }
  return false;
}

/** Redact sensitive params in a `a=b&c=d` string (a leading `?` is allowed). */
function scrubQueryString(qs: string): string {
  return qs
    .split('&')
    .map((pair) => {
      const eq = pair.indexOf('=');
      if (eq < 0) return pair;
      const rawKey = pair.slice(0, eq);
      const key = decodeKey(rawKey.startsWith('?') ? rawKey.slice(1) : rawKey);
      return isSensitive(key) || hasNestedSecret(pair.slice(eq + 1))
        ? `${pair.slice(0, eq)}=${REDACTED}`
        : pair;
    })
    .join('&');
}

const KEY_VALUE_HEAD =
  /(?<![^\s=:&?#{}()[\],;<>"'])(["']?)([^\s=:&?#{}()[\],;<>"']{1,100})\1(?:[ \t]*(?:=>|[:=])[ \t]*|([ \t]+))/g;

const UNQUOTED_VALUE = /[^\s&,;"'})\]]+/y;

function isSecretLabel(key: string): boolean {
  return (
    (SENSITIVE_SUBSTRING.test(key) && !key.includes('.')) ||
    words(key).some((x) => x === 'pin' || x === 'otp')
  );
}

interface ValueSpan {
  inner: string;
  end: number;
  quote: string;
}

function readValue(text: string, at: number): ValueSpan | null {
  const quote = text[at];
  if (quote === '"' || quote === "'") {
    for (let i = at + 1; i < text.length; i++) {
      if (text[i] === '\\') i++;
      else if (text[i] === quote) {
        return { inner: text.slice(at + 1, i), end: i + 1, quote };
      }
    }
    return { inner: text.slice(at + 1), end: text.length, quote };
  }
  UNQUOTED_VALUE.lastIndex = at;
  const m = UNQUOTED_VALUE.exec(text);
  return m ? { inner: m[0], end: at + m[0].length, quote: '' } : null;
}

function scrubText(text: string, nested = true): string {
  if (text.length > MAX_TEXT) return REDACTED;
  const src = text.replace(
    /\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{4,}/gi,
    (_m, scheme: string) => `${scheme} ${REDACTED}`,
  );
  let out = '';
  let last = 0;
  for (const m of src.matchAll(KEY_VALUE_HEAD)) {
    if (m.index < last) continue;
    const byWhitespace = m[3] !== undefined;
    if (byWhitespace && !isSecretLabel(decodeKey(m[2]))) continue;
    const valueAt = m.index + m[0].length;
    if (src.startsWith(REDACTED, valueAt)) continue;
    const sensitive = isSensitive(decodeKey(m[2]));
    const mayHideSecret = nested && !byWhitespace && m[0].includes('=');
    if (!sensitive && !mayHideSecret) continue;
    const value = readValue(src, valueAt);
    if (!value || value.inner === '') continue;
    const { inner, quote } = value;
    if (!quote && OUTCOME_VALUES.has(inner.toLowerCase())) continue;
    if (byWhitespace && /^[a-z]+$/.test(inner)) continue;
    if (!sensitive && (quote || !hasNestedSecret(inner))) continue;
    out += src.slice(last, valueAt) + quote + REDACTED + quote;
    last = value.end;
  }
  return out + src.slice(last);
}

const QUERY_KEYS = new Set([
  'http.query',
  'url.query',
  'query',
  'query_string',
]);

/** Redact a bag of attributes (breadcrumb / span / trace `data`). */
function scrubAttrs(data: unknown, depth = 0, scope: Scope = 'attrs'): unknown {
  if (data === null || typeof data !== 'object') {
    return typeof data === 'string' ? scrubText(data) : data;
  }
  if (depth > MAX_DEPTH) return REDACTED;
  if (Array.isArray(data)) {
    return data.map((v) => scrubAttrs(v, depth + 1, scope));
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
    if (isSensitive(k, scope)) out[k] = REDACTED;
    else if (typeof v === 'string' && QUERY_KEYS.has(k.toLowerCase())) {
      out[k] = scrubQueryString(v);
    } else out[k] = scrubAttrs(v, depth + 1, scope);
  }
  return out;
}

/** Recursively redact values of sensitive keys. Returns a copy; depth-capped. */
function scrubValue(value: unknown, scope: Scope = 'attrs'): unknown {
  return scrubAttrs(value, 0, scope);
}

function scrubUrl(url: string): string {
  return scrubText(url);
}

function scrubQuery(q: unknown): unknown {
  if (typeof q === 'string') return scrubQueryString(q);
  if (Array.isArray(q)) {
    return q.map((p) =>
      Array.isArray(p) && typeof p[0] === 'string' && isSensitive(p[0])
        ? [p[0], REDACTED, ...p.slice(2)]
        : p,
    );
  }
  return scrubValue(q);
}

export function scrubSentryBreadcrumb<B extends Breadcrumb>(crumb: B): B {
  const out = { ...crumb };
  if (crumb.data) out.data = scrubAttrs(crumb.data) as B['data'];
  if (typeof crumb.message === 'string') out.message = scrubText(crumb.message);
  return out;
}

function scrubSpan<S extends { data?: unknown; description?: unknown }>(
  span: S,
): S {
  const out = { ...span };
  if (span.data) out.data = scrubAttrs(span.data);
  if (typeof span.description === 'string') {
    out.description = scrubText(span.description);
  }
  return out;
}

function scrubEventUnsafe<E extends SentryEvent>(event: E): E {
  const req = event.request;
  if (req) {
    if (req.headers) {
      req.headers = scrubValue(req.headers, 'headers') as typeof req.headers;
      for (const k of Object.keys(req.headers)) {
        if (USER_AGENT_KEY.test(k)) delete req.headers[k];
      }
    }
    if (req.cookies) {
      // Cookie names are arbitrary (e.g. `sid`), so redact every value.
      req.cookies = Object.fromEntries(
        Object.keys(req.cookies).map((k) => [k, REDACTED]),
      );
    }
    if (req.query_string !== undefined) {
      req.query_string = scrubQuery(
        req.query_string,
      ) as typeof req.query_string;
    }
    delete req.data;
    if (typeof req.url === 'string') req.url = scrubUrl(req.url);
  }
  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.map((b) => scrubSentryBreadcrumb(b));
  }
  if (typeof event.message === 'string')
    event.message = scrubText(event.message);
  if (typeof event.transaction === 'string') {
    event.transaction = scrubText(event.transaction);
  }
  for (const ex of event.exception?.values ?? []) {
    if (typeof ex.value === 'string') ex.value = scrubText(ex.value);
  }
  const trace = event.contexts?.trace;
  if (trace?.data) trace.data = scrubAttrs(trace.data) as typeof trace.data;
  if (event.spans) event.spans = event.spans.map((s) => scrubSpan(s));
  if (event.extra) event.extra = scrubValue(event.extra) as typeof event.extra;
  return event;
}

const SAFE_EVENT_KEYS = [
  'event_id',
  'type',
  'timestamp',
  'start_timestamp',
  'level',
  'platform',
  'release',
  'environment',
  'dist',
  'sdk',
] as const;

const SAFE_SPAN_KEYS = [
  'span_id',
  'trace_id',
  'parent_span_id',
  'op',
  'origin',
  'status',
  'start_timestamp',
  'timestamp',
] as const;

const SAFE_TRACE_KEYS = [
  'trace_id',
  'span_id',
  'parent_span_id',
  'op',
  'origin',
  'status',
] as const;

function pick(
  source: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (source === null || typeof source !== 'object') return out;
  const src = source as Record<string, unknown>;
  for (const k of keys) {
    const v = src[k];
    if (v === undefined) continue;
    if (v === null || ['string', 'number', 'boolean'].includes(typeof v)) {
      out[k] = v;
    } else if (k === 'sdk') {
      out[k] = pick(v, ['name', 'version']);
    }
  }
  return out;
}

function allowlistEvent<E extends SentryEvent>(event: E): E {
  const out: Record<string, unknown> = pick(event, SAFE_EVENT_KEYS);
  const trace = pick(event.contexts?.trace, SAFE_TRACE_KEYS);
  if (Object.keys(trace).length > 0) out.contexts = { trace };
  if (Array.isArray(event.spans)) {
    out.spans = event.spans.map((s) => pick(s, SAFE_SPAN_KEYS));
  }
  return out as E;
}

function scrubOrDrop<E extends SentryEvent>(event: E): E | null {
  try {
    return scrubEventUnsafe(event);
  } catch {
    try {
      return allowlistEvent(event);
    } catch {
      return null;
    }
  }
}

function safeBreadcrumb(crumb: Breadcrumb): Breadcrumb | null {
  try {
    return scrubSentryBreadcrumb(crumb);
  } catch {
    return null;
  }
}

/** Options merged into Sentry.init so every outgoing event is scrubbed. */
export function buildSentryOptions(): Required<
  Pick<
    NodeOptions,
    | 'sendDefaultPii'
    | 'beforeSend'
    | 'beforeSendTransaction'
    | 'beforeBreadcrumb'
  >
> {
  return {
    sendDefaultPii: false,
    beforeSend: (event: ErrorEvent) => scrubOrDrop(event),
    beforeSendTransaction: (event: TxEvent) => scrubOrDrop(event),
    beforeBreadcrumb: (crumb: Breadcrumb) => safeBreadcrumb(crumb),
  };
}

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

/** Substrings that mark a key (header, cookie, body/query field) as secret. */
const SENSITIVE_SUBSTRING =
  /auth|token|cookie|secret|key|session|password|passwd|credential|jwt|bearer|private|signature/i;

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

/** Keys that merely report an outcome (`status_code`) are never secret by word. */
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

function isSensitive(key: string): boolean {
  if (SENSITIVE_SUBSTRING.test(key)) return true;
  const w = words(key);
  if (w.some((x) => OUTCOME_WORDS.has(x))) return false;
  return w.some((x) => SENSITIVE_WORDS.has(x));
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

/**
 * Redact `k=v` params (after start, whitespace, `?`, `&` or `#`) and bearer or
 * basic credentials embedded anywhere in free text.
 */
function scrubText(text: string, nested = true): string {
  if (text.length > MAX_TEXT) return REDACTED;
  let out = text.replace(
    /\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{4,}/gi,
    (_m, scheme: string) => `${scheme} ${REDACTED}`,
  );
  if (!out.includes('=')) return out;
  out = out.replace(
    /([?&#\s]|^)([^=&\s#?]{1,200})=([^&\s#"']*)/g,
    (m, pre: string, k: string, v: string) =>
      isSensitive(decodeKey(k)) || (nested && hasNestedSecret(v))
        ? `${pre}${k}=${REDACTED}`
        : m,
  );
  return out;
}

const QUERY_KEYS = new Set([
  'http.query',
  'url.query',
  'query',
  'query_string',
]);

/** Redact a bag of attributes (breadcrumb / span / trace `data`). */
function scrubAttrs(data: unknown, depth = 0): unknown {
  if (data === null || typeof data !== 'object') {
    return typeof data === 'string' ? scrubText(data) : data;
  }
  if (depth > MAX_DEPTH) return REDACTED;
  if (Array.isArray(data)) return data.map((v) => scrubAttrs(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
    if (isSensitive(k)) out[k] = REDACTED;
    else if (typeof v === 'string' && QUERY_KEYS.has(k.toLowerCase())) {
      out[k] = scrubQueryString(v);
    } else out[k] = scrubAttrs(v, depth + 1);
  }
  return out;
}

/** Recursively redact values of sensitive keys. Returns a copy; depth-capped. */
function scrubValue(value: unknown): unknown {
  return scrubAttrs(value);
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

function scrubBody(data: unknown): unknown {
  if (typeof data !== 'string') return scrubValue(data);
  try {
    return JSON.stringify(scrubValue(JSON.parse(data)));
  } catch {
    // Truncated JSON (Sentry cuts bodies at 10 KB) or other text. Only plain
    // urlencoded bodies can be scrubbed safely; anything else is dropped.
    return /^[^\s{[]*=[^\s]*$/.test(data) && data.length <= MAX_TEXT
      ? scrubQueryString(data)
      : REDACTED;
  }
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
    if (req.headers)
      req.headers = scrubValue(req.headers) as typeof req.headers;
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
    if (req.data !== undefined) req.data = scrubBody(req.data);
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

/** Scrub an event; on any failure strip everything that could carry secrets. */
export function scrubSentryEvent<E extends SentryEvent>(event: E): E {
  try {
    return scrubEventUnsafe(event);
  } catch {
    const stripped: E = {
      ...event,
      request: undefined,
      message: undefined,
      transaction: undefined,
      exception: undefined,
      breadcrumbs: undefined,
      contexts: undefined,
      extra: undefined,
    };
    try {
      if (stripped.spans) {
        stripped.spans = stripped.spans.map((s) => ({ ...s, data: {} }));
      }
    } catch {
      stripped.spans = undefined;
    }
    return stripped;
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
    beforeSend: (event: ErrorEvent) => scrubSentryEvent(event),
    beforeSendTransaction: (event: TxEvent) => scrubSentryEvent(event),
    beforeBreadcrumb: (crumb: Breadcrumb) => safeBreadcrumb(crumb),
  };
}

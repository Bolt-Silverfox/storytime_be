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

/** Keys (headers, cookies, body/query fields) whose values must never be sent. */
const SENSITIVE_KEY =
  /auth|token|cookie|secret|key|session|password|passwd|credential/i;

const MAX_DEPTH = 10;

function isSensitive(key: string): boolean {
  return SENSITIVE_KEY.test(key);
}

/** Recursively redact values of sensitive keys. Returns a copy; depth-capped. */
function scrubValue(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH || value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((v) => scrubValue(v, depth + 1));
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = isSensitive(k) ? REDACTED : scrubValue(v, depth + 1);
  }
  return out;
}

/** Redact sensitive params in a `a=b&c=d` string (no leading `?`). */
function scrubQueryString(qs: string): string {
  return qs
    .split('&')
    .map((pair) => {
      const eq = pair.indexOf('=');
      if (eq < 0) return pair;
      let key = pair.slice(0, eq);
      try {
        key = decodeURIComponent(key.replace(/\+/g, ' '));
      } catch {
        // keep raw key
      }
      return isSensitive(key) ? `${pair.slice(0, eq)}=${REDACTED}` : pair;
    })
    .join('&');
}

function scrubUrl(url: string): string {
  const q = url.indexOf('?');
  if (q < 0) return url;
  const hash = url.indexOf('#', q);
  const end = hash < 0 ? url.length : hash;
  return `${url.slice(0, q + 1)}${scrubQueryString(url.slice(q + 1, end))}${url.slice(end)}`;
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
    return data.includes('=') ? scrubQueryString(data) : data;
  }
}

export function scrubSentryBreadcrumb<B extends Breadcrumb>(crumb: B): B {
  if (!crumb.data) return crumb;
  const data = scrubValue(crumb.data) as Record<string, unknown>;
  if (typeof data.url === 'string') data.url = scrubUrl(data.url);
  return { ...crumb, data };
}

export function scrubSentryEvent<E extends SentryEvent>(event: E): E {
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
  return event;
}

/** Options merged into Sentry.init so every outgoing event is scrubbed. */
export function buildSentryOptions() {
  return {
    sendDefaultPii: false,
    beforeSend: (event: ErrorEvent) => scrubSentryEvent(event),
    beforeSendTransaction: (event: TxEvent) => scrubSentryEvent(event),
    beforeBreadcrumb: (crumb: Breadcrumb) => scrubSentryBreadcrumb(crumb),
  };
}

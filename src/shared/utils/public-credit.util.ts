/**
 * Public Domain works keep `sourceName` / `sourceUrl` internally (provenance),
 * but those values name the upstream site, so they are masked on the
 * responses this helper is applied to (the public-credit interceptor and the
 * guest story controller). Other endpoints are not covered.
 * Public credit comes from attributionText, authorName, licenseCode and
 * licenseUrl. See docs/story-provenance.md.
 */
const MASKED_KEYS = ['sourceName', 'sourceUrl'] as const;

const GUTENBERG_HOST =
  /(?:^|\.)gutenberg(?:\.|$)|(?:^|\.)(?:pglaf\.org|readingroo\.ms)$/;
const GUTENBERG_PATH = /(?:^|\/)gutenberg(?:\/|$)/i;

function isGutenbergUrl(url: string): boolean {
  try {
    const u = new URL(url.trim());
    return (
      GUTENBERG_HOST.test(u.hostname.toLowerCase()) ||
      GUTENBERG_PATH.test(u.pathname)
    );
  } catch {
    return /gutenberg/i.test(url); // unparseable: fail closed
  }
}

const isMaskable = (o: Record<string, unknown>): boolean => {
  if (!('sourceName' in o || 'sourceUrl' in o)) return false;
  if (o.licenseCode === 'PD-US') return true;
  if (
    typeof o.sourceName === 'string' &&
    /gutenberg/i.test(o.sourceName.trim())
  ) {
    return true;
  }
  return typeof o.sourceUrl === 'string' && isGutenbergUrl(o.sourceUrl);
};

/** Real responses never nest this deep; beyond it we stop instead of overflowing. */
export const MAX_MASK_DEPTH = 64;

const isWalkable = (v: unknown): v is object =>
  typeof v === 'object' &&
  v !== null &&
  !(v instanceof Date) &&
  !ArrayBuffer.isView(v) &&
  !(v instanceof ArrayBuffer);

/**
 * Returns `value` with sourceName/sourceUrl nulled on nested objects that are
 * public-credit rows. A row that serialises itself through toJSON is masked
 * when either the original row or its serialised output is a credit row, and
 * toJSON is called with the real property key (array index for elements).
 * Not every nested row is masked: a cyclic back-reference is returned as the
 * original object.
 * Copy on write: never mutates the input (it may be a cached object) and
 * returns the same reference when nothing changed.
 */
export function maskSourceFieldsForPublic<T>(value: T): T {
  return walk(value, new Map(), 0) as T;
}

function walk(
  value: unknown,
  seen: Map<object, unknown>,
  depth: number,
  key = '',
  forceMask = false,
): unknown {
  if (!isWalkable(value)) return value;
  if (depth > MAX_MASK_DEPTH) return null;
  if (forceMask) seen = new Map();
  if (seen.has(value)) return seen.get(value);
  // Cycle guard: provisional answer is the original object.
  seen.set(value, value);

  let result: unknown;
  const toJSON = (value as { toJSON?: unknown }).toJSON;
  if (typeof toJSON === 'function') {
    let json: unknown;
    try {
      json = (toJSON as (k: string) => unknown).call(value, key);
    } catch {
      seen.set(value, null);
      return null;
    }
    if (json !== value) {
      const originalIsCredit = isMaskable(value as Record<string, unknown>);
      const masked = walk(json, seen, depth + 1, key, originalIsCredit);
      result = masked === json ? value : masked;
      seen.set(value, result);
      return result;
    }
  }
  if (Array.isArray(value)) {
    let copy: unknown[] | null = null;
    for (let i = 0; i < value.length; i++) {
      const next = walk(value[i], seen, depth + 1, String(i));
      if (next !== value[i]) {
        copy ??= value.slice();
        copy[i] = next;
      }
    }
    result = copy ?? value;
  } else {
    const rec = value as Record<string, unknown>;
    let copy: Record<string, unknown> | null = null;
    const ensure = () =>
      (copy ??= Object.assign(
        Object.create(Object.getPrototypeOf(rec) as object | null) as Record<
          string,
          unknown
        >,
        rec,
      ));
    for (const k of Object.keys(rec)) {
      const next = walk(rec[k], seen, depth + 1, k);
      if (next !== rec[k]) ensure()[k] = next;
    }
    if (forceMask || isMaskable(rec)) {
      for (const k of MASKED_KEYS) {
        if (k in rec && rec[k] !== null) ensure()[k] = null;
      }
    }
    result = copy ?? value;
  }
  seen.set(value, result);
  return result;
}

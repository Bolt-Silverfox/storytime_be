/**
 * Public Domain works keep `sourceName` / `sourceUrl` internally (provenance),
 * but those values name the upstream site, so they are never returned to
 * clients: public credit comes from attributionText, authorName, licenseCode
 * and licenseUrl. See docs/story-provenance.md.
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
 * public-domain credit rows. Not every nested row is masked: a cyclic
 * back-reference is returned as the original object, and a toJSON that depends
 * on its key argument is called without one, so its keyed output is not seen.
 * A toJSON that drops licenseCode also hides the PD-US marker, so the output
 * is masked only if sourceName or sourceUrl still names a gutenberg source.
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
): unknown {
  if (!isWalkable(value)) return value;
  if (depth > MAX_MASK_DEPTH) return null;
  if (seen.has(value)) return seen.get(value);
  // Cycle guard: provisional answer is the original object.
  seen.set(value, value);

  let result: unknown;
  const toJSON = (value as { toJSON?: unknown }).toJSON;
  if (typeof toJSON === 'function') {
    let json: unknown;
    try {
      json = (toJSON as () => unknown).call(value);
    } catch {
      seen.set(value, null);
      return null;
    }
    if (json !== value) {
      const masked = walk(json, seen, depth + 1);
      result = masked === json ? value : masked;
      seen.set(value, result);
      return result;
    }
  }
  if (Array.isArray(value)) {
    let copy: unknown[] | null = null;
    for (let i = 0; i < value.length; i++) {
      const next = walk(value[i], seen, depth + 1);
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
    for (const key of Object.keys(rec)) {
      const next = walk(rec[key], seen, depth + 1);
      if (next !== rec[key]) ensure()[key] = next;
    }
    if (isMaskable(rec)) {
      for (const k of MASKED_KEYS) {
        if (k in rec && rec[k] !== null) ensure()[k] = null;
      }
    }
    result = copy ?? value;
  }
  seen.set(value, result);
  return result;
}

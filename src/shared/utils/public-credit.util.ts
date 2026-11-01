/**
 * Public Domain works keep `sourceName` / `sourceUrl` internally (provenance),
 * but those values name the upstream site, so they are never returned to
 * clients: public credit comes from attributionText, authorName, licenseCode
 * and licenseUrl. See docs/story-provenance.md.
 */
const MASKED_KEYS = ['sourceName', 'sourceUrl'] as const;

const GUTENBERG_HOST = /(?:^|\.)gutenberg\.(?:org|net|ca|eu|info)$/;

function isGutenbergUrl(url: string): boolean {
  try {
    return GUTENBERG_HOST.test(new URL(url.trim()).hostname.toLowerCase());
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
  !(v instanceof ArrayBuffer) &&
  typeof (v as { toJSON?: unknown }).toJSON !== 'function';

/**
 * Returns `value` with sourceName/sourceUrl nulled on every nested object that
 * is a public-domain credit row. Copy on write: never mutates the input (it may
 * be a cached object) and returns the same reference when nothing changed.
 */
export function maskSourceFieldsForPublic<T>(value: T): T {
  return walk(value, new Map(), 0) as T;
}

function walk(
  value: unknown,
  seen: Map<object, unknown>,
  depth: number,
): unknown {
  if (depth > MAX_MASK_DEPTH || !isWalkable(value)) return value;
  if (seen.has(value)) return seen.get(value);
  // Cycle guard: provisional answer is the original object.
  seen.set(value, value);

  let result: unknown = value;
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

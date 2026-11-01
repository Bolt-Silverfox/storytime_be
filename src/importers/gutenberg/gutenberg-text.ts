import { AllowListEntry } from './allowlist.types';

/** Hard cap on one imported story. Larger works need splitting first. */
export const MAX_IMPORT_WORDS = 8000;

/** Plain pattern for scanning stored fields (tests, allow-list validation). */
export const GUTENBERG_REFERENCE =
  /gutenberg|\bpgdp\b|distributed\s+proofreading/i;

export type ProcessFailure =
  | 'no-start-marker'
  | 'no-end-marker'
  | 'header-mismatch'
  | 'unlisted-translator'
  | 'transcriber-note-unbracketed'
  | 'residual-reference'
  | 'empty-after-clean'
  | 'oversized';

export type ProcessResult =
  | { ok: true; content: string; wordCount: number; notes: string[] }
  | { ok: false; reason: ProcessFailure };

export interface ProcessOptions {
  maxWords?: number;
}

const START =
  /^[ \t]*\*{3}[ \t]*START OF (?:THE|THIS) PROJECT GUTENBERG EBOOK\b/i;
const END = /^[ \t]*\*{3}[ \t]*END OF (?:THE|THIS) PROJECT GUTENBERG EBOOK\b/i;

const BOM = new RegExp('^\\ufeff');
const INVISIBLE = new RegExp('[\\u00ad\\u200b-\\u200d\\u2060\\ufeff]', 'g');
const ODD_SPACE = new RegExp('[\\u00a0\\t]', 'g');

/** Stored-text normalisation (NFC; keeps typography). */
const normalise = (raw: string): string =>
  raw
    .replace(BOM, '')
    .replace(/\r\n?/g, '\n')
    .replace(INVISIBLE, '')
    .replace(ODD_SPACE, ' ')
    .normalize('NFC');

// Look-alike letters (Cyrillic, Greek, Armenian, script g) -> Latin.
const CONFUSABLE: Record<string, string> = {
  а: 'a',
  с: 'c',
  е: 'e',
  о: 'o',
  р: 'p',
  х: 'x',
  у: 'y',
  і: 'i',
  ј: 'j',
  ѕ: 's',
  ԁ: 'd',
  һ: 'h',
  ԛ: 'q',
  ԝ: 'w',
  к: 'k',
  т: 't',
  н: 'h',
  м: 'm',
  п: 'n',
  г: 'r',
  α: 'a',
  ο: 'o',
  ε: 'e',
  ν: 'v',
  υ: 'u',
  ρ: 'p',
  τ: 't',
  ι: 'i',
  κ: 'k',
  η: 'n',
  ս: 'u',
  ո: 'n',
  օ: 'o',
  ց: 'g',
  ɡ: 'g',
};

/** Compatibility-folded (NFKC) form used only for matching, never stored. */
const matchForm = (s: string): string => s.normalize('NFKC');

/**
 * Letters and digits only, look-alikes folded, so "G u t e n-\nberg",
 * full-width and Cyrillic variants all collapse to "gutenberg".
 */
const CONFUSABLE_RE = new RegExp(`[${Object.keys(CONFUSABLE).join('')}]`, 'g');
const NOT_ALNUM = /[^\p{L}\p{N}]+/gu;

function probe(s: string): string {
  return matchForm(s)
    .toLowerCase()
    .replace(CONFUSABLE_RE, (c) => CONFUSABLE[c])
    .replace(NOT_ALNUM, '');
}

const MICHAEL_HART = /michael\s+s\.?\s+hart/i;
const PGDP = /\bpgdp\b/i;
const EBOOK_NUMBER = /e-?(?:book|text)\s*(?:(?:no\.?|number|#)\s*)?\d+/gi;
const EBOOK_NUMBER_TEST = /e-?(?:book|text)\s*(?:(?:no\.?|number|#)\s*)?\d+/i;

function hasSourceReference(s: string): boolean {
  const m = matchForm(s);
  if (PGDP.test(m) || MICHAEL_HART.test(m)) return true;
  const p = probe(s);
  return p.includes('gutenberg') || p.includes('distributedproofread');
}

const BOILERPLATE_START = new RegExp(
  '^(?:' +
    [
      'this\\s+(?:e-?book|e-?text|file)\\s+(?:was|is|should)\\b',
      '(?:e-?text\\s+)?(?:produced|prepared|transcribed|scanned|proofread|proofed|digitized|digitised|converted)\\s+(?:by|from)\\b',
      '(?:e-?text|e-?book)\\s*(?:(?:no\\.?|number|#)\\s*)?\\d+',
      'pg\\s+(?:edition|version)\\b',
      '(?:the\\s+)?project\\s+gutenberg\\b',
      'end\\s+of\\s+(?:the\\s+)?project\\b',
      'updated\\s+editions\\b',
      'online\\s+distributed\\b',
      'distributed\\s+proofread',
      'michael\\s+s\\.?\\s+hart\\b',
    ].join('|') +
    ')',
  'i',
);

const lineValue = (lines: string[], field: string): string | null => {
  const re = new RegExp(`^${field}:[ \\t]*(.+)$`, 'i');
  for (const l of lines) {
    const m = re.exec(l);
    if (m) return m[1].trim();
  }
  return null;
};

/** First letter of each word upper-case, rest lower; apostrophes untouched. */
const titleCase = (s: string): string =>
  s
    .toLowerCase()
    .split(' ')
    .map((w) =>
      w.replace(
        /^([^\p{L}]*)(\p{L})/u,
        (_m, a: string, b: string) => a + b.toUpperCase(),
      ),
    )
    .join(' ');

const HEADING = /^(chapter|book|part)\s+([ivxlcdm\d]+)\b\.?\s*(.*)$/i;

/** Linear removal of [Illustration ...]; an unclosed one runs to the end. */
function stripIllustrations(p: string): { text: string; changed: boolean } {
  let out = '';
  let i = 0;
  let changed = false;
  while (i < p.length) {
    const b = p.indexOf('[', i);
    if (b < 0) {
      out += p.slice(i);
      break;
    }
    let j = b + 1;
    while (j < p.length && p[j] === ' ') j++;
    if (p.slice(j, j + 12).toLowerCase() === 'illustration') {
      out += p.slice(i, b);
      changed = true;
      const close = p.indexOf(']', j);
      if (close < 0) break;
      i = close + 1;
    } else {
      out += p.slice(i, b + 1);
      i = b + 1;
    }
  }
  return { text: out.replace(/ {2,}/g, ' ').trim(), changed };
}

const count = (s: string, ch: string): number => s.split(ch).length - 1;

/** Join wrapped lines; a line ending in "-" joins the next word with no space. */
function unwrap(lines: string[]): string {
  let out = '';
  for (const l of lines) {
    if (!out) out = l;
    else if (out.endsWith('-') && /^\p{L}/u.test(l)) out += l;
    else out += ` ${l}`;
  }
  return out.replace(/ {2,}/g, ' ');
}

/**
 * Strip edition boilerplate from a Gutenberg-format text and turn the rest
 * into paragraphs separated by one blank line. Pure and deterministic, linear
 * time. Fails closed: any doubt returns { ok: false } so the work goes to
 * human review. Only recognised boilerplate paragraphs are dropped; a story
 * paragraph that mentions the source is never silently removed.
 */
export function processGutenbergText(
  raw: string,
  entry: AllowListEntry,
  options: ProcessOptions = {},
): ProcessResult {
  const maxWords = options.maxWords ?? MAX_IMPORT_WORDS;
  const all = normalise(raw).split('\n');
  const startIdx = all.findIndex((l) => START.test(l));
  if (startIdx < 0) return { ok: false, reason: 'no-start-marker' };
  const endRel = all.slice(startIdx + 1).findIndex((l) => END.test(l));
  if (endRel < 0) return { ok: false, reason: 'no-end-marker' };
  const head = all.slice(0, startIdx);
  const bodyLines = all.slice(startIdx + 1, startIdx + 1 + endRel);

  const mf = (v: string | null) => (v === null ? null : matchForm(v));
  const hTitle = mf(lineValue(head, 'Title'));
  const hAuthor = mf(lineValue(head, 'Author'));
  const hTranslator = mf(lineValue(head, 'Translator'));
  const has = (hay: string | null, needle: string) =>
    !!hay && hay.toLowerCase().includes(matchForm(needle).toLowerCase());
  if (
    !has(hTitle, entry.expect.title) ||
    !has(hAuthor, entry.expect.author) ||
    (entry.expect.translator && !has(hTranslator, entry.expect.translator))
  ) {
    return { ok: false, reason: 'header-mismatch' };
  }
  if (hTranslator && !entry.translator) {
    return { ok: false, reason: 'unlisted-translator' };
  }

  // Paragraphs: runs of non-blank lines.
  const paras: string[][] = [];
  let cur: string[] = [];
  for (const l of bodyLines) {
    const t = l.trim();
    if (t === '') {
      if (cur.length) paras.push(cur);
      cur = [];
    } else cur.push(t);
  }
  if (cur.length) paras.push(cur);

  const notes = new Set<string>([
    'source-edition header, footer and licence text removed',
    'hard line wraps rejoined into paragraphs',
  ]);
  const out: string[] = [];
  let skipNext = false;
  let noteDepth = 0;
  const titleLc = matchForm(entry.title).toLowerCase();

  for (const lines of paras) {
    const flat = unwrap(lines);
    const m = matchForm(flat);

    if (noteDepth > 0) {
      noteDepth += count(m, '[') - count(m, ']');
      continue;
    }
    if (skipNext) {
      skipNext = false;
      continue;
    }
    if (/^contents\.?$/i.test(m)) {
      skipNext = true;
      notes.add('table of contents removed');
      continue;
    }
    if (/^contents\b/i.test(m)) {
      notes.add('table of contents removed');
      continue;
    }
    if (/^\[\s*transcriber/i.test(m)) {
      noteDepth = Math.max(0, count(m, '[') - count(m, ']'));
      notes.add('transcriber and producer notes removed');
      continue;
    }
    if (/^transcriber['’]?s?\s+notes?:?$/i.test(m)) {
      return { ok: false, reason: 'transcriber-note-unbracketed' };
    }
    if (/^transcriber['’]?s?\s+notes?\b/i.test(m)) {
      notes.add('transcriber and producer notes removed');
      continue;
    }
    if (BOILERPLATE_START.test(m)) {
      notes.add('transcriber and producer notes removed');
      continue;
    }

    let p = flat;
    const ill = stripIllustrations(p);
    if (ill.changed) {
      notes.add('illustration placeholders removed');
      p = ill.text;
      if (!p) continue;
    }
    if (EBOOK_NUMBER_TEST.test(p)) {
      p = p
        .replace(EBOOK_NUMBER, '')
        .replace(/[[(]\s*[\])]/g, '')
        .replace(/ {2,}/g, ' ')
        .trim();
      if (!p) continue;
    }
    if (matchForm(p).toLowerCase() === titleLc) continue; // title page line

    const h = HEADING.exec(p);
    if (h) {
      const rest = h[3]
        ? ` ${titleCase(h[3].replace(/^[.:\-–—\s]+/, ''))}`
        : '';
      p = `${titleCase(h[1])} ${h[2].toUpperCase()}.${rest}`.trim();
      notes.add(
        'chapter headings kept as separate paragraphs, capitals normalised',
      );
    }
    const unItalic = p.replace(
      /(^|[\s(“"'‘])_([^_]+?)_(?=[\s.,;:!?)”"'’]|$)/g,
      '$1$2',
    );
    if (unItalic !== p) notes.add('italic markers removed');
    out.push(unItalic);
  }

  const content = out.join('\n\n').trim();
  const wordCount = content ? content.split(/\s+/).length : 0;
  if (wordCount === 0) return { ok: false, reason: 'empty-after-clean' };
  if (
    hasSourceReference(content) ||
    EBOOK_NUMBER_TEST.test(matchForm(content))
  ) {
    return { ok: false, reason: 'residual-reference' };
  }
  if (wordCount > maxWords) return { ok: false, reason: 'oversized' };
  return { ok: true, content, wordCount, notes: [...notes] };
}

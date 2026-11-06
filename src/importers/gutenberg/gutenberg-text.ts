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
  | 'copyright-signal'
  | 'transcriber-note-unbracketed'
  | 'table-of-contents-ambiguous'
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
  ԍ: 'g',
  β: 'b',
  ᴜ: 'u',
  ɢ: 'g',
  ʙ: 'b',
  ᴇ: 'e',
  ɴ: 'n',
  ʀ: 'r',
  ᴛ: 't',
};

/** Compatibility-folded (NFKC) form used only for matching, never stored. */
const matchForm = (s: string): string => s.normalize('NFKC');

/**
 * Letters and digits only, look-alikes folded, so "G u t e n-\nberg",
 * full-width and Cyrillic variants all collapse to "gutenberg".
 */
const CONFUSABLE_RE = new RegExp(`[${Object.keys(CONFUSABLE).join('')}]`, 'g');
const NOT_ALNUM = /[^\p{L}\p{N}]+/gu;

const MARKS = /\p{M}+/gu;

function probe(s: string): string {
  return s
    .normalize('NFKD')
    .toLowerCase()
    .replace(MARKS, '')
    .replace(CONFUSABLE_RE, (c) => CONFUSABLE[c])
    .replace(NOT_ALNUM, '');
}

const MICHAEL_HART = /michael\s+(?:s\.?\s+)?hart/i;
const PGDP = /\bpgdp\b/i;
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
      '(?:this\\s+)?pg\\s+(?:edition|version)\\b',
      '(?:the\\s+)?project\\s+gutenberg\\b',
      'end\\s+of\\s+(?:the\\s+)?project\\b',
      'updated\\s+editions\\b',
      'online\\s+distributed\\b',
      'distributed\\s+proofread',
      'michael\\s+(?:s\\.?\\s+)?hart\\b',
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

const COPYRIGHT_SIGNAL =
  /copyrighted\s+project\s+gutenberg|all\s+rights\s+reserved|^contributor:/i;
const COPYRIGHT_STATUS = /^copyright\s+status:[ \t]*(.*)$/i;
const NOT_COPYRIGHTED = /^(?:not\s+copyrighted|public\s+domain)\b/i;
const TRANSLATION_CREDIT = /\btranslated\b[^\n]{0,100}?\bby\b/i;

function hasCopyrightSignal(head: string[], entry: AllowListEntry): boolean {
  const translator = entry.translator
    ? matchForm(entry.translator.name).toLowerCase()
    : null;
  return head.some((raw) => {
    const l = matchForm(raw).trim();
    if (COPYRIGHT_SIGNAL.test(l)) return true;
    const status = COPYRIGHT_STATUS.exec(l);
    if (status && !NOT_COPYRIGHTED.test(status[1].trim())) return true;
    return (
      TRANSLATION_CREDIT.test(l) &&
      !(translator && l.toLowerCase().includes(translator))
    );
  });
}

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

const AMBIGUOUS_CONTENTS = {
  ok: false,
  reason: 'table-of-contents-ambiguous',
} as const;

const CONTENTS_ENTRY =
  /^(?:(chapter|book|part|section|story)\s+)?([ivxlcdm]+|\d+)[.:)](?:\s+(.*))?$/i;
const CONTENTS_HEADING = /^(?:table\s+of\s+)?contents[.:]?$/i;
const MAX_CONTENTS_ENTRY_CHARS = 100;
const MAX_CONTENTS_CAPS_LINE_CHARS = 40;
const ROMAN_VALUES: Record<string, number> = {
  i: 1,
  v: 5,
  x: 10,
  l: 50,
  c: 100,
  d: 500,
  m: 1000,
};

interface ContentsEntry {
  prefix: string;
  system: 'roman' | 'arabic';
  ordinal: number;
  title: string;
  short: boolean;
}

function romanOrdinal(label: string): number | null {
  let total = 0;
  for (let i = 0; i < label.length; i++) {
    const v = ROMAN_VALUES[label[i]];
    total += v < (ROMAN_VALUES[label[i + 1]] ?? 0) ? -v : v;
  }
  const canonical = [
    ['m', 1000],
    ['cm', 900],
    ['d', 500],
    ['cd', 400],
    ['c', 100],
    ['xc', 90],
    ['l', 50],
    ['xl', 40],
    ['x', 10],
    ['ix', 9],
    ['v', 5],
    ['iv', 4],
    ['i', 1],
  ] as const;
  let rest = total;
  let out = '';
  for (const [sym, val] of canonical) {
    while (rest >= val) {
      out += sym;
      rest -= val;
    }
  }
  return out === label ? total : null;
}

function parseContentsEntry(line: string): ContentsEntry | null {
  const m = CONTENTS_ENTRY.exec(line);
  if (!m) return null;
  const label = m[2].toLowerCase();
  const isArabic = /^\d+$/.test(label);
  const ordinal = isArabic ? Number(label) : romanOrdinal(label);
  if (ordinal === null || !Number.isSafeInteger(ordinal)) return null;
  return {
    prefix: (m[1] ?? '').toLowerCase(),
    system: isArabic ? 'arabic' : 'roman',
    ordinal,
    title: m[3] ?? '',
    short: line.length <= MAX_CONTENTS_ENTRY_CHARS,
  };
}

type ContentsList =
  { ok: true; first: ContentsEntry; last: ContentsEntry } | { ok: false };

function parseContentsList(
  lines: string[],
  after: ContentsEntry | null,
): ContentsList {
  let prev = after;
  let first: ContentsEntry | null = null;
  for (const line of lines) {
    const e = parseContentsEntry(line);
    if (!e || !e.short) return { ok: false };
    if (prev) {
      if (
        e.prefix !== prev.prefix ||
        e.system !== prev.system ||
        e.ordinal !== prev.ordinal + 1
      )
        return { ok: false };
    } else if (e.ordinal !== 1) return { ok: false };
    first ??= e;
    prev = e;
  }
  return first && prev ? { ok: true, first, last: prev } : { ok: false };
}

const titleKey = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

function restartsStory(lines: string[], first: ContentsEntry): boolean {
  if (lines.length !== 1) return false;
  const e = parseContentsEntry(lines[0]);
  return (
    !!e &&
    HEADING.test(lines[0]) &&
    e.system === first.system &&
    e.ordinal === first.ordinal &&
    titleKey(e.title) === titleKey(first.title)
  );
}

const isShortCapsBlock = (lines: string[]) =>
  lines.every(
    (l) =>
      l.length <= MAX_CONTENTS_CAPS_LINE_CHARS &&
      /\p{Lu}/u.test(l) &&
      l === l.toUpperCase(),
  );

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

/**
 * Join wrapped lines; a line ending in "-" joins the next word with no space.
 * Parts are collected in an array (no growing-string re-reads): linear time.
 */
function unwrap(lines: string[]): string {
  const parts: string[] = [];
  let prevHyphen = false;
  for (const l of lines) {
    if (parts.length === 0) parts.push(l);
    else if (prevHyphen && /^\p{L}/u.test(l)) parts.push(l);
    else parts.push(' ', l);
    prevHyphen = l.endsWith('-');
  }
  return parts.join('').replace(/ {2,}/g, ' ');
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
  if (hasCopyrightSignal(head, entry)) {
    return { ok: false, reason: 'copyright-signal' };
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
  let contents:
    | { stage: 'expect-list' }
    | { stage: 'in-list'; first: ContentsEntry; last: ContentsEntry }
    | null = null;
  let noteDepth = 0;
  const titleLc = matchForm(entry.title).toLowerCase();

  for (const lines of paras) {
    const flat = unwrap(lines);
    const m = matchForm(flat);

    if (noteDepth > 0) {
      noteDepth += count(m, '[') - count(m, ']');
      continue;
    }
    if (contents) {
      if (/^\[\s*illustration/i.test(m) && !stripIllustrations(flat).text)
        continue;
      const ml = lines.map(matchForm);
      if (contents.stage === 'expect-list') {
        const list = parseContentsList(ml, null);
        if (!list.ok) return AMBIGUOUS_CONTENTS;
        contents = { stage: 'in-list', first: list.first, last: list.last };
        continue;
      }
      if (parseContentsEntry(ml[0])) {
        if (!restartsStory(ml, contents.first)) {
          const list = parseContentsList(ml, contents.last);
          if (!list.ok) return AMBIGUOUS_CONTENTS;
          contents = { ...contents, last: list.last };
          continue;
        }
      } else if (isShortCapsBlock(ml)) {
        return AMBIGUOUS_CONTENTS;
      }
      contents = null;
    }
    if (
      /^(?:table|contents)/i.test(m) &&
      CONTENTS_HEADING.test(matchForm(lines[0]))
    ) {
      notes.add('table of contents removed');
      if (lines.length === 1) {
        contents = { stage: 'expect-list' };
        continue;
      }
      const list = parseContentsList(lines.slice(1).map(matchForm), null);
      if (!list.ok) return AMBIGUOUS_CONTENTS;
      contents = { stage: 'in-list', first: list.first, last: list.last };
      continue;
    }
    if (/^\[\s*transcriber/i.test(m)) {
      noteDepth = Math.max(0, count(m, '[') - count(m, ']'));
      notes.add('transcriber and producer notes removed');
      continue;
    }
    if (/^transcriber['’]?s?\s+notes?\b/i.test(m)) {
      return { ok: false, reason: 'transcriber-note-unbracketed' };
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
    // An ebook number inside a story sentence is NOT deleted (that would drop
    // story words); it stays and the final residual check fails the work.
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

  if (contents?.stage === 'expect-list') return AMBIGUOUS_CONTENTS;

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

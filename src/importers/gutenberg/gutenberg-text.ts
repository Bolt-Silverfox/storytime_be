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
  | 'transcriber-note-unclosed'
  | 'boilerplate-mid-body'
  | 'boilerplate-ambiguous'
  | 'table-of-contents-ambiguous'
  | 'residual-reference'
  | 'empty-after-clean'
  | 'heading-ambiguous'
  | 'illustration-unclosed'
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

export function hasSourceReference(s: string): boolean {
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
  const joined = head.map((raw) => matchForm(raw).trim()).join(' ');
  const credit = new RegExp(TRANSLATION_CREDIT.source, 'gi');
  for (const m of joined.matchAll(credit)) {
    const after = joined
      .slice(m.index + m[0].length)
      .trimStart()
      .toLowerCase();
    if (!(translator && after.startsWith(translator))) return true;
  }
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

const UNCLOSED_NOTE = {
  ok: false,
  reason: 'transcriber-note-unclosed',
} as const;
const MID_BODY_BOILERPLATE = {
  ok: false,
  reason: 'boilerplate-mid-body',
} as const;
const BOILERPLATE_AMBIGUOUS = {
  ok: false,
  reason: 'boilerplate-ambiguous',
} as const;
const NOTE_TAIL = /^[.,;:!?)”"'’]*\s*$/;
const MAX_NOTE_PARAGRAPHS = 3;

const AMBIGUOUS_CONTENTS = {
  ok: false,
  reason: 'table-of-contents-ambiguous',
} as const;

const MAX_CONTENTS_HEADING_CHARS = 100;
const CONTENTS_HEADING = [
  /^(?:table\s+of\s+)?contents[.:]?$/i,
  /^contents\s+of\s+(?:volume|vol\.?|book|part)\b/i,
  /^list\s+of\s+illustrations[.:]?$/i,
  /^illustrations[.:]?$/i,
  /^index(?:\s*[.:\u2026]+.*|\s+of\b.*)?$/i,
];
const ROMAN_NUMERAL =
  '(?=[ivxlcdm])m{0,3}(?:cm|cd|d?c{0,3})(?:xc|xl|l?x{0,3})(?:ix|iv|v?i{0,3})';
const TRAILING_PAGE_LABEL = new RegExp(
  `(?:\\s+(?:page|pp?\\.)|[\\s.\\u2026\\u00b7\\u2013\\u2014-]+(?:${ROMAN_NUMERAL}|\\d+))\\s*$`,
  'i',
);
const CONTENTS_LABELLED = /^contents:\s*\S/i;
const PAGE_REFERENCE = /[\s.\u2026\u00b7]+[ivxlcdm\d]+\s*$/i;
const CONTENTS_FAMILY =
  /^(?:tableof)?(?:contents?|listof|illustrations?|index|plates|colou?redplates)/;

const CONTENTS_WORD = /contents|illustrations|index/i;
const HEADING_INITIAL = /^[^\p{L}\p{N}]*[CLITP]/iu;
const NON_ASCII = /[^ -~\t\r\n]/;

const mayBeContentsHeading = (line: string): boolean =>
  CONTENTS_WORD.test(line) ||
  NON_ASCII.test(line) ||
  (line.length <= MAX_CONTENTS_HEADING_CHARS &&
    HEADING_INITIAL.test(line) &&
    !/\p{Ll}/u.test(line.replace(PAGE_REFERENCE, '')));

const isContentsHeading = (line: string): boolean => {
  if (!mayBeContentsHeading(line)) return false;
  const h = matchForm(line).trim();
  if (CONTENTS_LABELLED.test(h)) return true;
  if (h.length > MAX_CONTENTS_HEADING_CHARS) return false;
  const bare = h.replace(TRAILING_PAGE_LABEL, '');
  if (CONTENTS_HEADING.some((re) => re.test(h) || re.test(bare))) return true;
  return (
    !/\p{Ll}/u.test(h.replace(PAGE_REFERENCE, '')) &&
    CONTENTS_FAMILY.test(probe(h))
  );
};

const HEADING = /^(chapter|book|part)\s+([ivxlcdm\d]+)\b\.?\s*(.*)$/i;
const ILLUSTRATION_UNCLOSED = {
  ok: false,
  reason: 'illustration-unclosed',
} as const;
const HEADING_AMBIGUOUS = {
  ok: false,
  reason: 'heading-ambiguous',
} as const;

/** Linear removal of [Illustration ...]; an unclosed one is reported, not dropped. */
function stripIllustrations(p: string): {
  text: string;
  changed: boolean;
  unclosed: boolean;
} {
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
      if (close < 0) return { text: '', changed, unclosed: true };
      i = close + 1;
    } else {
      out += p.slice(i, b + 1);
      i = b + 1;
    }
  }
  return { text: out.replace(/ {2,}/g, ' ').trim(), changed, unclosed: false };
}

function scanNote(m: string, startDepth: number): number | null {
  let depth = startDepth;
  for (let i = 0; i < m.length; i++) {
    const c = m[i];
    if (c === '[') depth++;
    else if (c === ']') {
      depth--;
      if (depth === 0) return NOTE_TAIL.test(m.slice(i + 1)) ? 0 : null;
    }
  }
  return depth > 0 && m.trimEnd().endsWith(']') ? null : depth;
}

const PRODUCER_SHAPE =
  /\be-?texts?\b|\be-?books?\b|\bpgdp\b|\bpglaf\b|\S+@\S+\.\S+|https?:\/\/\S+|www\.\S+|internet archive|page images|proofreading team|this file was produced/i;
const KNOWN_SHORT_BOILERPLATE =
  /^(?:this\s+(?:e-?book|e-?text|file)\s+was\s+produced\b|(?:e-?text|e-?book)\s*(?:(?:no\.?|number|#)\s*)?\d+|(?:this\s+)?pg\s+(?:edition|version)\b|updated\s+editions\s+will\s+replace\b|distributed\s+proofread)/i;
const MAX_SHAPE_PARAGRAPH_CHARS = 200;
const PRODUCER_CREDIT =
  /^(?:e-?text\s+)?(?:produced|prepared|transcribed|scanned|proofread|proofed|digitized|digitised|converted)\s+by\s+(.+)$/i;

function isProducerParagraph(m: string): boolean {
  const short = m.length <= MAX_SHAPE_PARAGRAPH_CHARS;
  if (short && KNOWN_SHORT_BOILERPLATE.test(m)) return true;
  const opener = BOILERPLATE_START.exec(m);
  const rest = opener ? m.slice(opener[0].length) : m;
  if (hasSourceReference(rest) || (short && PRODUCER_SHAPE.test(rest)))
    return true;
  const credit = PRODUCER_CREDIT.exec(m);
  return (
    !!credit &&
    short &&
    credit[1]
      .split(/[\s,]+/)
      .filter(Boolean)
      .every((tok) => /^(?:and|&|\p{Lu}[\p{L}.'’-]*)$/u.test(tok))
  );
}

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
  const maxWords = Math.min(
    options.maxWords ?? MAX_IMPORT_WORDS,
    MAX_IMPORT_WORDS,
  );
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
  let noteDepth = 0;
  let noteParagraphs = 0;
  let boilerplateAfterStory = false;
  const titleLc = hTitle === null ? null : hTitle.toLowerCase();

  let next = 0;
  let carry: string[] | null = null;
  while (carry || next < paras.length) {
    const lines: string[] = carry ?? paras[next++];
    carry = null;
    const flat = unwrap(lines);
    const m = matchForm(flat);

    if (noteDepth > 0) {
      if (HEADING.test(m) || ++noteParagraphs > MAX_NOTE_PARAGRAPHS)
        return UNCLOSED_NOTE;
      const depth = scanNote(m, noteDepth);
      if (depth === null) return UNCLOSED_NOTE;
      noteDepth = depth;
      continue;
    }
    if (lines.some(isContentsHeading)) {
      return AMBIGUOUS_CONTENTS;
    }
    if (/^\[\s*transcriber/i.test(m)) {
      const depth = scanNote(m, 0);
      if (depth === null) return UNCLOSED_NOTE;
      noteDepth = depth;
      noteParagraphs = 1;
      notes.add('transcriber and producer notes removed');
      continue;
    }
    if (/^transcriber['’]?s?\s+notes?\b/i.test(m)) {
      return { ok: false, reason: 'transcriber-note-unbracketed' };
    }
    if (BOILERPLATE_START.test(m)) {
      if (!isProducerParagraph(m)) {
        return out.length > 0 ? MID_BODY_BOILERPLATE : BOILERPLATE_AMBIGUOUS;
      }
      if (out.length > 0) boilerplateAfterStory = true;
      notes.add('transcriber and producer notes removed');
      continue;
    }

    let p = flat;
    let pLines = lines;
    const ill = stripIllustrations(lines.join('\n'));
    if (ill.unclosed) return ILLUSTRATION_UNCLOSED;
    if (ill.changed) {
      notes.add('illustration placeholders removed');
      pLines = ill.text
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
      if (pLines.length === 0) continue;
      p = unwrap(pLines);
    }
    // An ebook number inside a story sentence is NOT deleted (that would drop
    // story words); it stays and the final residual check fails the work.
    if (matchForm(p).toLowerCase() === titleLc) continue; // title page line

    let headings = 0;
    while (headings < pLines.length) {
      const h = HEADING.exec(pLines[headings]);
      if (!h) break;
      if (/\p{Ll}/u.test(pLines[headings].slice(h[1].length)))
        return HEADING_AMBIGUOUS;
      if (boilerplateAfterStory) return MID_BODY_BOILERPLATE;
      const title = h[3]
        ? ` ${titleCase(h[3].replace(/^[.:\-–—\s]+/, ''))}`
        : '';
      out.push(`${titleCase(h[1])} ${h[2].toUpperCase()}.${title}`.trim());
      headings++;
    }
    if (headings > 0) {
      notes.add(
        'chapter headings kept as separate paragraphs, capitals normalised',
      );
      if (headings < pLines.length) carry = pLines.slice(headings);
      continue;
    }
    const unItalic = p.replace(
      /(^|[\s(“"'‘])_([^_]+?)_(?=[\s.,;:!?)”"'’]|$)/g,
      '$1$2',
    );
    if (unItalic !== p) notes.add('italic markers removed');
    if (boilerplateAfterStory) return MID_BODY_BOILERPLATE;
    out.push(unItalic);
  }

  if (noteDepth > 0) return UNCLOSED_NOTE;

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

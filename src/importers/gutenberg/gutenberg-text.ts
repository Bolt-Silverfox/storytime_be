import { AllowListEntry } from './allowlist.types';

/** Any surviving match means the text must not be stored. */
export const GUTENBERG_REFERENCE =
  /gutenberg|\bpgdp\b|distributed\s+proofreading/i;
const EBOOK_NUMBER = /\[?\s*e-?book\s*#?\s*\d+\s*\]?/gi;
const EBOOK_NUMBER_TEST = /e-?book\s*#?\s*\d+/i;

export type ProcessResult =
  | { ok: true; content: string; wordCount: number; notes: string[] }
  | {
      ok: false;
      reason:
        | 'no-start-marker'
        | 'no-end-marker'
        | 'header-mismatch'
        | 'unlisted-translator'
        | 'residual-reference'
        | 'empty-after-clean';
    };

const START =
  /^[ \t]*\*{3}[ \t]*START OF (?:THE|THIS) PROJECT GUTENBERG EBOOK[^\n]*$/im;
const END =
  /^[ \t]*\*{3}[ \t]*END OF (?:THE|THIS) PROJECT GUTENBERG EBOOK[^\n]*$/im;

const BOM = new RegExp('^\\ufeff');
const INVISIBLE = new RegExp('[\\u200b-\\u200d\\u2060\\ufeff]', 'g');
const ODD_SPACE = new RegExp('[\\u00a0\\t]', 'g');

const normalise = (raw: string): string =>
  raw
    .replace(BOM, '')
    .replace(/\r\n?/g, '\n')
    .replace(INVISIBLE, '')
    .replace(ODD_SPACE, ' ')
    .normalize('NFC');

const header = (head: string, field: string): string | null => {
  const m = new RegExp(`^${field}:[ \\t]*(.+)$`, 'im').exec(head);
  return m ? m[1].trim() : null;
};

const titleCase = (s: string) =>
  s
    .toLowerCase()
    .replace(
      /(^|[\s'"“‘(-])([a-z])/g,
      (_m, a: string, b: string) => a + b.toUpperCase(),
    );

const HEADING = /^(chapter|book|part)\s+[ivxlcdm\d]+\b.*$/i;

/**
 * Strip edition boilerplate from a Gutenberg-format text and turn the rest
 * into paragraphs separated by one blank line. Pure and deterministic. Fails
 * closed: any doubt returns { ok: false } so the work goes to human review.
 */
export function processGutenbergText(
  raw: string,
  entry: AllowListEntry,
): ProcessResult {
  const text = normalise(raw);
  const start = START.exec(text);
  if (!start) return { ok: false, reason: 'no-start-marker' };
  const afterStart = text.slice(start.index + start[0].length);
  const end = END.exec(afterStart);
  if (!end) return { ok: false, reason: 'no-end-marker' };
  const head = text.slice(0, start.index);
  const body = afterStart.slice(0, end.index);

  const hTitle = header(head, 'Title');
  const hAuthor = header(head, 'Author');
  const hTranslator = header(head, 'Translator');
  const has = (hay: string | null, needle: string) =>
    !!hay && hay.toLowerCase().includes(needle.toLowerCase());
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

  const notes = new Set<string>([
    'source-edition header, footer and licence text removed',
  ]);
  const paras = body.split(/\n[ \t]*\n/).map((p) => p.trim());
  const out: string[] = [];
  let skipNext = false;
  for (let p of paras) {
    if (!p) continue;
    if (skipNext) {
      skipNext = false;
      continue;
    }
    if (/^contents\.?$/i.test(p)) {
      skipNext = true;
      notes.add('table of contents removed');
      continue;
    }
    if (/^contents\b/i.test(p)) {
      notes.add('table of contents removed');
      continue;
    }
    const flat = p.replace(/\s*\n\s*/g, ' ').replace(/ {2,}/g, ' ');
    if (
      /^\[?\s*transcriber/i.test(flat) ||
      /transcriber['’]?s? note/i.test(flat) ||
      /^(produced|e-?text prepared|scanned|proofed|updated|this file should be named)\b/i.test(
        flat,
      ) ||
      GUTENBERG_REFERENCE.test(flat)
    ) {
      notes.add('transcriber, producer and edition notes removed');
      continue;
    }
    p = flat;
    if (/\[\s*illustration[^\]]*\]/i.test(p)) {
      p = p.replace(/\[\s*illustration[^\]]*\]/gi, '').trim();
      notes.add('illustration placeholders removed');
      if (!p) continue;
    }
    if (EBOOK_NUMBER_TEST.test(p)) {
      p = p.replace(EBOOK_NUMBER, '').trim();
      if (!p) continue;
    }
    if (p.toLowerCase() === entry.title.toLowerCase()) continue; // title page line
    if (HEADING.test(p)) {
      const m = /^(chapter|book|part)\s+([ivxlcdm\d]+)\.?\s*(.*)$/i.exec(p);
      if (m) {
        const rest = m[3]
          ? ` ${titleCase(m[3].replace(/^[.:\-–—\s]+/, ''))}`
          : '';
        p = `${titleCase(m[1])} ${m[2].toUpperCase()}.${rest}`.trim();
        notes.add(
          'chapter headings kept as separate paragraphs, capitals normalised',
        );
      }
    }
    const unItalic = p.replace(
      /(^|[\s(“"'‘])_([^_]+?)_(?=[\s.,;:!?)”"'’]|$)/g,
      '$1$2',
    );
    if (unItalic !== p) notes.add('italic markers removed');
    out.push(unItalic);
  }
  notes.add('hard line wraps rejoined into paragraphs');

  const content = out.join('\n\n').trim();
  const wordCount = content ? content.split(/\s+/).length : 0;
  if (wordCount === 0) return { ok: false, reason: 'empty-after-clean' };
  if (GUTENBERG_REFERENCE.test(content) || EBOOK_NUMBER_TEST.test(content)) {
    return { ok: false, reason: 'residual-reference' };
  }
  return { ok: true, content, wordCount, notes: [...notes] };
}

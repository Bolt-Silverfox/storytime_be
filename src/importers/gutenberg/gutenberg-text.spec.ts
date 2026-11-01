import * as fs from 'fs';
import * as path from 'path';
import { processGutenbergText, GUTENBERG_REFERENCE } from './gutenberg-text';
import { AllowListEntry } from './allowlist.types';

const fx = (n: string) =>
  fs.readFileSync(path.resolve('test/fixtures/gutenberg', n));

const entry = (over: Partial<AllowListEntry> = {}): AllowListEntry => ({
  ebookId: '90001',
  title: 'The Little Lantern Fox',
  authorName: 'Ada Example',
  translator: { name: 'Bram Sample', deathYear: 1900 },
  firstPublished: 1890,
  status: 'approved',
  flags: [],
  ageMin: 4,
  ageMax: 7,
  categories: [],
  themes: [],
  description: 'A fox borrows a light.',
  expect: { title: 'Lantern Fox', author: 'Example' },
  pdJustification: 'invented',
  idVerified: true,
  ...over,
});

describe('processGutenbergText', () => {
  it('strips header, footer, licence, transcriber and producer lines (BOM + CRLF file)', () => {
    const r = processGutenbergText(fx('90001-0.txt').toString('utf8'), entry());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.content).not.toMatch(GUTENBERG_REFERENCE);
    expect(r.content).not.toMatch(/pgdp|proofreading|Transcriber|eBook\s*#/i);
    expect(r.content).not.toContain('\r');
    expect(r.content).not.toContain('﻿');
    expect(r.content).toContain('Once upon a time a small fox lived');
    expect(r.content).toContain('The fox was very surprised.');
    expect(r.content).not.toContain('_');
    expect(r.content).not.toMatch(/CONTENTS/);
    expect(r.content).not.toMatch(/END OF|licen[cs]e/i);
    expect(r.wordCount).toBeGreaterThan(50);
    expect(r.notes.join(' ')).not.toMatch(GUTENBERG_REFERENCE);
  });

  it('handles the older START marker without spaces, illustration markers, producer lines', () => {
    const r = processGutenbergText(
      fx('90002.txt').toString('utf8'),
      entry({
        ebookId: '90002',
        expect: { title: 'Moon Spoon', author: 'Invented' },
        translator: undefined,
        illustrator: 'Dot Drawn',
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.content).not.toMatch(GUTENBERG_REFERENCE);
    expect(r.content).not.toMatch(/Illustration|E-text|90002/);
    expect(r.content).toContain('A spoon fell from the moon');
    expect(r.content).not.toMatch(/\n{3,}/);
  });

  it('joins hard-wrapped lines into paragraphs separated by one blank line', () => {
    const r = processGutenbergText(fx('90001-0.txt').toString('utf8'), entry());
    if (!r.ok) throw new Error('expected ok');
    const paras = r.content.split('\n\n');
    expect(paras.every((p) => !p.includes('\n'))).toBe(true);
    expect(paras.length).toBeGreaterThanOrEqual(4);
  });

  it('fails closed to needs-review when there is no start marker', () => {
    const r = processGutenbergText(fx('90004-0.txt').toString('utf8'), entry());
    expect(r).toEqual({ ok: false, reason: 'no-start-marker' });
  });

  it('flags a header that does not match the allow-list expectation', () => {
    const r = processGutenbergText(fx('90005-0.txt').toString('utf8'), entry());
    expect(r).toMatchObject({ ok: false, reason: 'header-mismatch' });
  });

  it('flags an unlisted translator in the header', () => {
    const r = processGutenbergText(
      fx('90001-0.txt').toString('utf8'),
      entry({ translator: undefined }),
    );
    expect(r).toMatchObject({ ok: false, reason: 'unlisted-translator' });
  });

  it('fails closed (not a silent drop) when a story paragraph mentions the source', () => {
    const r = processGutenbergText(
      fx('90006-0.txt').toString('utf8'),
      entry({
        ebookId: '90006',
        translator: undefined,
        expect: { title: 'Sneaky', author: 'Example' },
      }),
    );
    expect(r).toEqual({ ok: false, reason: 'residual-reference' });
  });

  it('property: no Gutenberg string survives for any fixture or random injection', () => {
    const base = fx('90001-0.txt').toString('utf8');
    const injections = [
      'Project Gutenberg',
      'PROJECT GUTENBERG-tm',
      'gutenberg.org/ebooks/1',
      'www.gutenberg.net',
      'Project\nGutenberg',
      'Distributed Proofreading Team',
      '[eBook #12345]',
    ];
    for (const inj of injections) {
      const injected = base.replace(
        'CHAPTER II. THE LANTERN',
        `CHAPTER II. THE LANTERN\n\nA stray line: ${inj} appears here.\n`,
      );
      const r = processGutenbergText(injected, entry());
      if (!r.ok) continue; // failing closed is also safe
      expect(r.content).not.toMatch(GUTENBERG_REFERENCE);
      expect(r.content).not.toMatch(/eBook\s*#?\s*\d/i);
      expect(r.content).not.toMatch(/proofreading/i);
    }
  });
});


// ---- hardening round ------------------------------------------------------
const wrap = (body: string, head = 'Title: Lantern Fox\nAuthor: Ada Example') =>
  `${head}\n\n*** START OF THE PROJECT GUTENBERG EBOOK X ***\n\n${body}\n\n*** END OF THE PROJECT GUTENBERG EBOOK X ***\n`;
const plain = (e: Partial<AllowListEntry> = {}) =>
  entry({ translator: undefined, expect: { title: 'Lantern Fox', author: 'Example' }, ...e });
const STORY = 'A small fox found a lantern in the wood and carried it home.';

describe('processGutenbergText hardening', () => {
  it.each([
    ['multi-paragraph bracketed transcriber note', '[Transcriber\'s Note: spelling kept.\n\nThe list of volunteers follows here.\n\nMore about the edition.]'],
    ['This eBook was produced by', 'This eBook was produced by Some Volunteers at a library.'],
    ['This etext was produced by', 'This etext was produced by A. Person.'],
    ['Etext number line', 'Etext #14838\n'],
    ['PG edition line', 'PG edition, revised.'],
    ['Michael S. Hart', 'Michael S. Hart began the e-text effort.'],
    ['Distributed Proofreaders', 'Produced by Distributed Proofreaders Canada'],
    ['Internet Archive', 'Digitized by the Internet Archive in 2008.'],
    ['end-of line', 'End of the Project Gutenberg EBook of X'],
  ])('drops boilerplate: %s', (_n, junk) => {
    const r = processGutenbergText(wrap(`${junk}\n\n${STORY}`), plain());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.content).toBe(STORY);
  });

  it('strips an etext number embedded in a line and leaves the story text', () => {
    const r = processGutenbergText(wrap(`${STORY} (Etext #14838)`), plain());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.content).not.toMatch(/etext|14838/i);
  });

  it.each([
    ['soft hyphen', 'Guten\u00adberg'],
    ['line-break hyphen', 'Guten-\nberg'],
    ['spaced letters', 'G u t e n b e r g'],
    ['full-width', '\uff27utenberg'],
    ['Cyrillic e', 'Gut\u0435nberg'],
    ['Cyrillic o in Project', 'Pr\u043eject Gutenberg'],
    ['zero-width', 'Guten\u200bberg'],
  ])('fails closed on an obfuscated mention inside story text: %s', (_n, v) => {
    const r = processGutenbergText(wrap(`She read about ${v} in a book.\n\n${STORY}`), plain());
    expect(r).toEqual({ ok: false, reason: 'residual-reference' });
  });

  it('does not drop a story paragraph just because it is near the source name: fails closed instead', () => {
    const r = processGutenbergText(wrap(`The fox met Gutenberg the owl.\n\n${STORY}`), plain());
    expect(r.ok).toBe(false);
  });

  it('obfuscated boilerplate (start pattern) is still dropped cleanly', () => {
    const r = processGutenbergText(
      wrap(`Produced by Jane at the Online Distributed Proofreading Team\n\n${STORY}`),
      plain(),
    );
    expect(r).toMatchObject({ ok: true, content: STORY });
  });

  describe('START/END markers are strict', () => {
    const body = `${STORY}\n`;
    it('ignores a marker that is not at the start of a line', () => {
      const t = `Title: Lantern Fox\nAuthor: Ada Example\n\nsee *** START OF THE PROJECT GUTENBERG EBOOK X ***\n\n${body}\n*** END OF THE PROJECT GUTENBERG EBOOK X ***`;
      expect(processGutenbergText(t, plain())).toEqual({ ok: false, reason: 'no-start-marker' });
    });
    it('requires three asterisks and the words', () => {
      for (const m of ['** START OF THE PROJECT GUTENBERG EBOOK X **', 'START OF THE PROJECT GUTENBERG EBOOK X', '*** START OF PROJECT GUTENBERG EBOOK X ***', '*** BEGIN OF THE PROJECT GUTENBERG EBOOK X ***']) {
        const t = `Title: Lantern Fox\nAuthor: Ada Example\n\n${m}\n\n${body}\n*** END OF THE PROJECT GUTENBERG EBOOK X ***`;
        expect(processGutenbergText(t, plain())).toEqual({ ok: false, reason: 'no-start-marker' });
      }
    });
    it('requires an END marker at line start', () => {
      const t = `Title: Lantern Fox\nAuthor: Ada Example\n\n*** START OF THE PROJECT GUTENBERG EBOOK X ***\n\n${body}\nx *** END OF THE PROJECT GUTENBERG EBOOK X ***`;
      expect(processGutenbergText(t, plain())).toEqual({ ok: false, reason: 'no-end-marker' });
    });
    it('accepts THIS and mixed case', () => {
      const t = `Title: Lantern Fox\nAuthor: Ada Example\n\n*** start of this project gutenberg ebook x ***\n\n${body}\n*** end of this project gutenberg ebook x ***`;
      expect(processGutenbergText(t, plain())).toMatchObject({ ok: true });
    });
  });

  it('the final residual check is the safety net (a reference no strip rule knows)', () => {
    const r = processGutenbergText(wrap(`${STORY} Visit gutenberg.org today.`), plain());
    expect(r).toEqual({ ok: false, reason: 'residual-reference' });
  });

  it('unclosed [Illustration marker is dropped to the end of its paragraph', () => {
    const r = processGutenbergText(wrap(`${STORY} [Illustration: a fox\n\nNext.`), plain());
    expect(r).toMatchObject({ ok: true });
    if (r.ok) expect(r.content).not.toMatch(/illustration/i);
  });

  it('unbracketed multi-paragraph transcriber note fails closed', () => {
    const r = processGutenbergText(
      wrap(`Transcriber's Note:\n\nSome notes continue here.\n\n${STORY}`),
      plain(),
    );
    expect(r).toEqual({ ok: false, reason: 'transcriber-note-unbracketed' });
  });

  it('title-cases chapter headings without capitalising after apostrophes', () => {
    const r = processGutenbergText(wrap(`CHAPTER I. THE FOX'S LANTERN\n\n${STORY}`), plain());
    expect(r.ok && r.content.split('\n\n')[0]).toBe("Chapter I. The Fox's Lantern");
  });

  it('refuses oversized works (cap on words)', () => {
    const big = Array.from({ length: 30 }, () => STORY).join('\n\n');
    expect(processGutenbergText(wrap(big), plain(), { maxWords: 100 })).toEqual({
      ok: false,
      reason: 'oversized',
    });
    expect(processGutenbergText(wrap(big), plain(), { maxWords: 100000 })).toMatchObject({ ok: true });
  });

  describe('performance (no quadratic regex)', () => {
    const ms = (t: string) => {
      const st = Date.now();
      processGutenbergText(t, plain());
      return Date.now() - st;
    };
    const N = 80_000;
    it.each([
      ['spaces in a paragraph', () => wrap(`a${' '.repeat(N)}b`)],
      ['spaces then newline then spaces', () => wrap(`a${' '.repeat(N)}\n${' '.repeat(N)}b`)],
      ['eBook followed by spaces', () => wrap(`eBook${' '.repeat(N)}x`)],
      ['many unclosed illustration markers', () => wrap('[Illustration '.repeat(N / 14))],
      ['many newlines', () => wrap(`a${'\n'.repeat(N)}b`)],
      ['many underscores', () => wrap('_a '.repeat(N / 3))],
      ['many opening brackets', () => wrap('['.repeat(N))],
    ])('%s under 100 ms', (_n, make) => {
      const t = make();
      expect(ms(t)).toBeLessThan(100);
    });
  });
});

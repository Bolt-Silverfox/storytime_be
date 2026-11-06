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
  entry({
    translator: undefined,
    expect: { title: 'Lantern Fox', author: 'Example' },
    ...e,
  });
const STORY = 'A small fox found a lantern in the wood and carried it home.';

describe('processGutenbergText hardening', () => {
  it.each([
    [
      'multi-paragraph bracketed transcriber note',
      "[Transcriber's Note: spelling kept.\n\nThe list of volunteers follows here.\n\nMore about the edition.]",
    ],
    [
      'This eBook was produced by',
      'This eBook was produced by Some Volunteers at a library.',
    ],
    ['This etext was produced by', 'This etext was produced by A. Person.'],
    ['Etext number line', 'Etext #14838\n'],
    ['PG edition line', 'PG edition, revised.'],
    ['Michael S. Hart', 'Michael S. Hart began the e-text effort.'],
    ['Michael Hart without initial', 'Michael Hart began the e-text effort.'],
    ['This PG edition', 'This PG edition has been updated.'],
    ['Distributed Proofreaders', 'Produced by Distributed Proofreaders Canada'],
    ['Internet Archive', 'Digitized by the Internet Archive in 2008.'],
    ['end-of line', 'End of the Project Gutenberg EBook of X'],
  ])('drops boilerplate: %s', (_n, junk) => {
    const r = processGutenbergText(wrap(`${junk}\n\n${STORY}`), plain());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.content).toBe(STORY);
  });

  it('an ebook number inside a story sentence fails closed instead of deleting words', () => {
    const r = processGutenbergText(
      wrap(`${STORY} We read (Etext #14838) twice.`),
      plain(),
    );
    expect(r).toEqual({ ok: false, reason: 'residual-reference' });
  });

  it.each([
    ['soft hyphen', 'Guten\u00adberg'],
    ['line-break hyphen', 'Guten-\nberg'],
    ['spaced letters', 'G u t e n b e r g'],
    ['full-width', '\uff27utenberg'],
    ['Cyrillic e', 'Gut\u0435nberg'],
    ['Cyrillic o in Project', 'Pr\u043eject Gutenberg'],
    ['zero-width', 'Guten\u200bberg'],
    ['umlaut (combining mark)', 'G\u00fctenberg'],
    ['combining diaeresis', 'Gu\u0308tenberg'],
    ['Cyrillic Ge U+050C', '\u050cutenberg'],
    ['Greek beta', 'Gutenberg'.replace('b', '\u03b2')],
    ['small-cap G U+0262', '\u0262utenberg'],
    ['small-cap U U+1D1C', 'G\u1d1ctenberg'],
    ['Michael Hart mid story', 'Michael Hart'],
  ])('fails closed on an obfuscated mention inside story text: %s', (_n, v) => {
    const r = processGutenbergText(
      wrap(`She read about ${v} in a book.\n\n${STORY}`),
      plain(),
    );
    expect(r).toEqual({ ok: false, reason: 'residual-reference' });
  });

  it('does not drop a story paragraph just because it is near the source name: fails closed instead', () => {
    const r = processGutenbergText(
      wrap(`The fox met Gutenberg the owl.\n\n${STORY}`),
      plain(),
    );
    expect(r.ok).toBe(false);
  });

  it('obfuscated boilerplate (start pattern) is still dropped cleanly', () => {
    const r = processGutenbergText(
      wrap(
        `Produced by Jane at the Online Distributed Proofreading Team\n\n${STORY}`,
      ),
      plain(),
    );
    expect(r).toMatchObject({ ok: true, content: STORY });
  });

  describe('START/END markers are strict', () => {
    const body = `${STORY}\n`;
    it('ignores a marker that is not at the start of a line', () => {
      const t = `Title: Lantern Fox\nAuthor: Ada Example\n\nsee *** START OF THE PROJECT GUTENBERG EBOOK X ***\n\n${body}\n*** END OF THE PROJECT GUTENBERG EBOOK X ***`;
      expect(processGutenbergText(t, plain())).toEqual({
        ok: false,
        reason: 'no-start-marker',
      });
    });
    it('requires three asterisks and the words', () => {
      for (const m of [
        '** START OF THE PROJECT GUTENBERG EBOOK X **',
        'START OF THE PROJECT GUTENBERG EBOOK X',
        '*** START OF PROJECT GUTENBERG EBOOK X ***',
        '*** BEGIN OF THE PROJECT GUTENBERG EBOOK X ***',
      ]) {
        const t = `Title: Lantern Fox\nAuthor: Ada Example\n\n${m}\n\n${body}\n*** END OF THE PROJECT GUTENBERG EBOOK X ***`;
        expect(processGutenbergText(t, plain())).toEqual({
          ok: false,
          reason: 'no-start-marker',
        });
      }
    });
    it('requires an END marker at line start', () => {
      const t = `Title: Lantern Fox\nAuthor: Ada Example\n\n*** START OF THE PROJECT GUTENBERG EBOOK X ***\n\n${body}\nx *** END OF THE PROJECT GUTENBERG EBOOK X ***`;
      expect(processGutenbergText(t, plain())).toEqual({
        ok: false,
        reason: 'no-end-marker',
      });
    });
    it('accepts THIS and mixed case', () => {
      const t = `Title: Lantern Fox\nAuthor: Ada Example\n\n*** start of this project gutenberg ebook x ***\n\n${body}\n*** end of this project gutenberg ebook x ***`;
      expect(processGutenbergText(t, plain())).toMatchObject({ ok: true });
    });
  });

  it('the final residual check is the safety net (a reference no strip rule knows)', () => {
    const r = processGutenbergText(
      wrap(`${STORY} Visit gutenberg.org today.`),
      plain(),
    );
    expect(r).toEqual({ ok: false, reason: 'residual-reference' });
  });

  it('unclosed [Illustration marker is dropped to the end of its paragraph', () => {
    const r = processGutenbergText(
      wrap(`${STORY} [Illustration: a fox\n\nNext.`),
      plain(),
    );
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
    const r = processGutenbergText(
      wrap(`CHAPTER I. THE FOX'S LANTERN\n\n${STORY}`),
      plain(),
    );
    expect(r.ok && r.content.split('\n\n')[0]).toBe(
      "Chapter I. The Fox's Lantern",
    );
  });

  it('refuses oversized works (cap on words)', () => {
    const big = Array.from({ length: 30 }, () => STORY).join('\n\n');
    expect(processGutenbergText(wrap(big), plain(), { maxWords: 100 })).toEqual(
      {
        ok: false,
        reason: 'oversized',
      },
    );
    expect(
      processGutenbergText(wrap(big), plain(), { maxWords: 100000 }),
    ).toMatchObject({ ok: true });
  });

  describe('copyright signals in the header', () => {
    const head = (extra: string) =>
      `Title: Lantern Fox\nAuthor: Ada Example\n${extra}`;
    it.each([
      [
        'copyrighted eBook notice',
        'This is a COPYRIGHTED Project Gutenberg eBook.',
      ],
      ['copyright status line', 'Copyright Status: Copyrighted'],
      ['all rights reserved', 'Copyright 2001 Someone. All rights reserved.'],
      [
        'free-text translation credit',
        'Translated from the French by Living Person (2001)',
      ],
      ['plain translated by', 'Translated by Living Person'],
      ['contributor line', 'Contributor: Living Person'],
    ])('routes %s to review', (_n, line) => {
      expect(processGutenbergText(wrap(STORY, head(line)), plain())).toEqual({
        ok: false,
        reason: 'copyright-signal',
      });
    });

    it.each([
      ['an indented contributor line', '    Contributor: Living Person'],
      ['an indented copyright status line', '  Copyright Status: Copyrighted'],
      [
        'a full-width copyright status line',
        '\uff23\uff4f\uff50\uff59\uff52\uff49\uff47\uff48\uff54 Status: Copyrighted',
      ],
      [
        'a full-width all-rights-reserved line',
        '\uff21\uff2c\uff2c \uff32\uff29\uff27\uff28\uff34\uff33 \uff32\uff25\uff33\uff25\uff32\uff36\uff25\uff24',
      ],
      [
        'a full-width translation credit',
        '\uff34\uff52\uff41\uff4e\uff53\uff4c\uff41\uff54\uff45\uff44 by Living Person',
      ],
    ])('routes %s to review', (_n, line) => {
      expect(processGutenbergText(wrap(STORY, head(line)), plain())).toEqual({
        ok: false,
        reason: 'copyright-signal',
      });
    });

    it('routes a translator named in the Title line to review', () => {
      expect(
        processGutenbergText(
          wrap(
            STORY,
            'Title: Lantern Fox (translated by Living Person)\nAuthor: Ada Example',
          ),
          plain(),
        ),
      ).toEqual({ ok: false, reason: 'copyright-signal' });
    });

    it('routes a translation credit naming someone other than the listed translator to review', () => {
      const e = entry({ expect: { title: 'Lantern Fox', author: 'Example' } });
      expect(
        processGutenbergText(
          wrap(
            STORY,
            head('Translator: Bram Sample\nTranslated by Living Person'),
          ),
          e,
        ),
      ).toEqual({ ok: false, reason: 'copyright-signal' });
    });

    it('accepts a translation credit naming the listed translator', () => {
      const e = entry({ expect: { title: 'Lantern Fox', author: 'Example' } });
      expect(
        processGutenbergText(
          wrap(
            STORY,
            head('Translator: Bram Sample\nTranslated by Bram Sample'),
          ),
          e,
        ),
      ).toMatchObject({ ok: true });
    });

    it('accepts an explicit not-copyrighted status line', () => {
      expect(
        processGutenbergText(
          wrap(
            STORY,
            head('Copyright Status: Not copyrighted in the United States.'),
          ),
          plain(),
        ),
      ).toMatchObject({ ok: true });
    });

    it('accepts a clean public-domain header', () => {
      expect(
        processGutenbergText(
          wrap(
            STORY,
            head(
              'Release date: March 3, 2010 [eBook #90001]\nLanguage: English',
            ),
          ),
          plain(),
        ),
      ).toMatchObject({ ok: true });
    });

    it('ignores signal words in the book body', () => {
      expect(
        processGutenbergText(
          wrap(
            'The tale was translated by an owl. All rights reserved for foxes.',
          ),
          plain(),
        ),
      ).toMatchObject({ ok: true });
    });
  });

  describe('contents and transcriber notes', () => {
    const contentOf = (body: string) => {
      const r = processGutenbergText(wrap(body), plain());
      return r.ok ? r.content : r;
    };
    const AMBIGUOUS = { ok: false, reason: 'table-of-contents-ambiguous' };
    const long = 'x'.repeat(120);

    it.each([
      ['CONTENTS'],
      ['CONTENTS.'],
      ['contents'],
      ['Contents:'],
      ['TABLE OF CONTENTS'],
      ['Table of Contents'],
      ['CONTENTS OF VOLUME I'],
      ['Contents: I. The Wood'],
      ['LIST OF ILLUSTRATIONS'],
      ['ILLUSTRATIONS'],
      ['INDEX'],
      ['INDEX ........ 3'],
      ['\uff23\uff2f\uff2e\uff34\uff25\uff2e\uff34\uff33'],
      ['    CONTENTS'],
      ['CONTENTS\nI. The Dark Wood\nII. The Lantern'],
      ['CONTENTS\n\nI. The Dark Wood\n\nII. The Lantern'],
      ['CONTENTS\nChapter I ........ 3\nChapter II ....... 9'],
      ['CONTENTS\nI.\u2014The Dark Wood\nII.\u2014The Lantern'],
      ['CONTENTS\n\nI. A\n\nII. B\n\nAppendix'],
      ['CONTENTS\n\nI. A\n\nII. B\n\nPart Two'],
      ['CONTENTS\n\nI. A\n\nII. B\n\nIII. ' + long],
      ['CONTENTS\n\nI. The Hill\n\nChapter II. Home'],
      ['CONTENTS\n\nIIII. The River'],
      [
        'CONTENTS\n\n1. The owl and the pussy-cat went to sea\n\n2. In a beautiful pea-green boat',
      ],
      ['CONTENTS\n1. Spring\n2. Summer\n\n3. Autumn came and the fox slept.'],
      ['CONTENTS\n\n3. Autumn came and the fox slept.'],
    ])(
      'a contents-like heading is ambiguous, never silently shortened: %j',
      (body) => {
        expect(contentOf(`${body}\n\n${STORY}`)).toEqual(AMBIGUOUS);
      },
    );

    it('is ambiguous even when the heading comes mid-paragraph or last', () => {
      expect(contentOf(`${STORY}\nCONTENTS\nI. A`)).toEqual(AMBIGUOUS);
      expect(contentOf(`${STORY}\n\nCONTENTS`)).toEqual(AMBIGUOUS);
    });

    it('drops nothing and sets no contents note when ambiguous', () => {
      const r = processGutenbergText(
        wrap(`CONTENTS\n\nI. A\n\n${STORY}`),
        plain(),
      );
      expect(r).toEqual(AMBIGUOUS);
    });

    it.each([
      'Contents of the basket spilled across the floor.',
      '"Contents under pressure," she said.',
      'She checked the contents of her pocket, then the index finger of her glove.',
      'The table of contents was a mystery to the fox, who could not read.',
    ])('keeps prose that merely mentions the word: %s', (sentence) => {
      const r = processGutenbergText(wrap(`${sentence}\n\n${STORY}`), plain());
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.content).toContain(sentence.replace(/\s+/g, ' '));
      expect(r.notes.join(' ')).not.toMatch(/contents/);
    });

    it('keeps numbered stanza paragraphs when there is no contents heading', () => {
      const body = `I.\n\nII.\n\n${STORY}`;
      expect(contentOf(body)).toContain(STORY);
      expect(contentOf(body)).toContain('II.');
    });

    it('a work with a contents block goes to needs-review (fixture 90001 with its original block)', () => {
      const text = fx('90001-0.txt')
        .toString('utf8')
        .replace(
          'CHAPTER I.',
          'CONTENTS\n\n  I. The Dark Wood\n  II. The Lantern\n\nCHAPTER I.',
        );
      expect(processGutenbergText(text, entry())).toEqual(AMBIGUOUS);
    });

    it.each([
      "Transcriber's Note: spelling kept as printed.\n\nMore about the edition.",
      "Transcriber's Notes\n\nMore about the edition.",
      'TRANSCRIBER NOTE: Page numbers removed.',
    ])('an unbracketed transcriber note fails closed: %s', (note) => {
      expect(contentOf(`${note}\n\n${STORY}`)).toEqual({
        ok: false,
        reason: 'transcriber-note-unbracketed',
      });
    });
  });

  describe('performance (linear scaling, no quadratic regex)', () => {
    const FACTOR = 8;
    const RUNS = 5;
    const PROBE_DIVISOR = 16;
    const MAX_RATIO = 32;
    const MIN_DENOMINATOR_MS = 1;

    const cpuMs = (text: string): number => {
      const before = process.cpuUsage();
      processGutenbergText(text, plain());
      const used = process.cpuUsage(before);
      return (used.user + used.system) / 1000;
    };
    const WARM_UP_TOLERANCE = 3;
    const warmUpCpuMs = (text: string, budgetMs: number): number => {
      const first = cpuMs(text);
      return first >= budgetMs && first < budgetMs * WARM_UP_TOLERANCE
        ? Math.min(first, cpuMs(text))
        : first;
    };
    const median = (text: string, limitMs = Infinity): number => {
      const samples: number[] = [];
      for (let i = 0; i < RUNS; i++) {
        samples.push(cpuMs(text));
        const over = samples.filter((t) => t > limitMs);
        if (over.length > RUNS / 2) return Math.min(...over);
      }
      samples.sort((a, b) => a - b);
      return samples[Math.floor(RUNS / 2)];
    };

    it.each([
      [
        'spaces in a paragraph',
        1_500_000,
        100,
        (n: number) => wrap(`a${' '.repeat(n)}b`),
      ],
      [
        'spaces then newline then spaces',
        900_000,
        100,
        (n: number) => wrap(`a${' '.repeat(n)}\n${' '.repeat(n)}b`),
      ],
      [
        'eBook followed by spaces',
        1_500_000,
        100,
        (n: number) => wrap(`eBook${' '.repeat(n)}x`),
      ],
      [
        'many unclosed illustration markers',
        1_500_000,
        100,
        (n: number) => wrap('[Illustration '.repeat(n / 14)),
      ],
      [
        'many newlines',
        300_000,
        150,
        (n: number) => wrap(`a${'\n'.repeat(n)}b`),
      ],
      [
        'many underscores',
        450_000,
        80,
        (n: number) => wrap('_a '.repeat(n / 3)),
      ],
      [
        'many opening brackets',
        300_000,
        150,
        (n: number) => wrap('['.repeat(n)),
      ],
      [
        'hyphen-ended lines',
        400_000,
        80,
        (n: number) => wrap('abcd-\n'.repeat(n / 5)),
      ],
      [
        'hyphen-ended lines then letters',
        250_000,
        90,
        (n: number) => wrap('ab-\ncd\n'.repeat(n / 6)),
      ],
      [
        'plain lines in one paragraph',
        300_000,
        80,
        (n: number) => wrap('word\n'.repeat(n / 5)),
      ],
      [
        'many one-line paragraphs',
        200_000,
        150,
        (n: number) => wrap('word\n\n'.repeat(n / 6)),
      ],
    ])(
      '%s: cpu stays within budget and 8x input costs under 32x',
      (_n, size, budgetMs, make) => {
        expect(cpuMs(make(size / PROBE_DIVISOR))).toBeLessThan(budgetMs);
        const text = make(size);
        expect(warmUpCpuMs(text, budgetMs)).toBeLessThan(budgetMs);
        const small = median(text, budgetMs);
        const floor = Math.max(small, MIN_DENOMINATOR_MS);
        const large = median(make(size * FACTOR), MAX_RATIO * floor);
        expect(large / floor).toBeLessThan(MAX_RATIO);
      },
      120_000,
    );
  });
});

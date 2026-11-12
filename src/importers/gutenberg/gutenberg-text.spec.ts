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

  it('unclosed [Illustration marker fails closed instead of dropping prose', () => {
    expect(
      processGutenbergText(
        wrap(`${STORY} [Illustration: a fox\n\nNext.`),
        plain(),
      ),
    ).toEqual({ ok: false, reason: 'illustration-unclosed' });
  });

  it.each([
    [
      'a multi-line caption',
      `${STORY}\n[Illustration: a fox\nin a hollow tree]`,
    ],
    ['an inline caption', `${STORY} [Illustration: a fox] Then it ran.`],
    ['a bare marker', `${STORY} [Illustration] Then it ran.`],
  ])('removes %s without failing', (_n, body) => {
    const r = processGutenbergText(wrap(body), plain());
    expect(r).toMatchObject({ ok: true });
    if (r.ok) expect(r.content).not.toMatch(/illustration|hollow tree/i);
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

    it('routes a translation credit split across lines to review', () => {
      expect(
        processGutenbergText(
          wrap(STORY, head('Translated\nby Jane Living')),
          plain(),
        ),
      ).toEqual({ ok: false, reason: 'copyright-signal' });
    });

    it('routes a split credit naming someone other than the listed translator to review', () => {
      const e = entry({ expect: { title: 'Lantern Fox', author: 'Example' } });
      expect(
        processGutenbergText(
          wrap(
            STORY,
            head('Translator: Bram Sample\nTranslated\nby Living Person'),
          ),
          e,
        ),
      ).toEqual({ ok: false, reason: 'copyright-signal' });
    });

    it('accepts a split credit naming the listed translator', () => {
      const e = entry({ expect: { title: 'Lantern Fox', author: 'Example' } });
      expect(
        processGutenbergText(
          wrap(
            STORY,
            head('Translator: Bram Sample\nTranslated\nby Bram Sample'),
          ),
          e,
        ),
      ).toMatchObject({ ok: true });
    });

    it.each([
      ['a Translation credit', 'Translation by Living Person'],
      ['a revised credit', 'Revised by Living Person'],
      ['an English version credit', 'English version by Living Person'],
    ])('routes %s to review', (_n, line) => {
      expect(processGutenbergText(wrap(STORY, head(line)), plain())).toEqual({
        ok: false,
        reason: 'copyright-signal',
      });
    });

    it.each([
      [
        'a second name after the listed translator',
        'Translated by Bram Sample and John Modern',
      ],
      [
        'the listed translator named elsewhere',
        'Translated by Living Person (with Bram Sample)',
      ],
      [
        'a name that only starts with the listed one',
        'Translated by Bram Samplewell',
      ],
      [
        'a split credit with extra names',
        'Translated\nby Bram Sample, John Modern',
      ],
    ])('routes %s to review', (_n, credit) => {
      const e = entry({ expect: { title: 'Lantern Fox', author: 'Example' } });
      expect(
        processGutenbergText(
          wrap(STORY, head(`Translator: Bram Sample\n${credit}`)),
          e,
        ),
      ).toEqual({ ok: false, reason: 'copyright-signal' });
    });

    it('routes a credit to someone else to review even when the listed translator is named on the next line', () => {
      const e = entry({
        translator: { name: 'Lucy Crane', deathYear: 1900 },
        expect: { title: 'Lantern Fox', author: 'Example' },
      });
      expect(
        processGutenbergText(
          wrap(
            STORY,
            head(
              'Translator: Lucy Crane\nTranslated by Jim Modern\nLucy Crane',
            ),
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

    it.each([
      ['CONTENTS     PAGE'],
      ['CONTENTS 3'],
      ['CONTENTS ..... vii'],
      ['CONTENTS\u2014'],
      ['CONTENTS;'],
      ['LIST OF PLATES'],
      ['LIST OF FULL-PAGE ILLUSTRATIONS'],
      ['ILLUSTRATIONS IN COLOUR'],
      ['LIST OF COLOURED PLATES'],
      ['INDEX TO FIRST LINES'],
      ['CONTENTS OF THE FIRST VOLUME'],
      ['CONTENTS OF\nVOLUME I.'],
      ['CONTENT'],
      ['LIST OF ILLUSTRATION'],
      ['C O N T E N T S'],
      ['CONTE\u0301NTS'],
      ['\u0421ONTENTS'],
      ['Index of Names'],
      ['Contents: ' + 'x'.repeat(95)],
    ])('a common heading form is ambiguous, not stored: %j', (heading) => {
      expect(
        contentOf(
          `${heading}\n\nI. The Dark Wood\nII. The Lantern\n\n${STORY}`,
        ),
      ).toEqual(AMBIGUOUS);
    });

    it.each([
      'THE INDEX FINGER POINTED',
      'CHAPTER III. THE INDEX',
      'THE CONTENTS OF THE BOX',
      'Index fingers pointed at the moon.',
      'INDEX OF ' + 'a very long line of ordinary story words '.repeat(3),
    ])('keeps a story line that only resembles a heading: %s', (line) => {
      const r = processGutenbergText(wrap(`${line}\n\n${STORY}`), plain());
      expect(r.ok).toBe(true);
    });

    it.each([
      ['contents.'],
      ['contents: a key to the map'],
      ['index of the great atlas'],
      ['index:'],
    ])('hard-wrapped prose with a line starting %j fails closed', (line) => {
      expect(
        contentOf(`The fox looked at the\n${line}\nand went home.\n\n${STORY}`),
      ).toEqual(AMBIGUOUS);
    });

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

    it('drops a leading producer line and trailing edition lines but not mid-body paragraphs', () => {
      expect(
        contentOf(
          `Produced by Jane Doe.\n\n${STORY}\n\nUpdated editions will replace the previous one.\n\nOnline Distributed Proofreading Team`,
        ),
      ).toBe(STORY);
      for (const line of [
        'Prepared by the cook, the soup was hot and the fox ate it all up.',
        'Produced by the mill, the flour was fine.',
        'Converted from the old tongue, the song was sweet.',
        'This file was a gift, said the fox.',
      ]) {
        expect(
          contentOf(`${STORY}\n\n${line}\n\nCHAPTER II. HOME\n\n${STORY}`),
        ).toEqual({ ok: false, reason: 'boilerplate-mid-body' });
      }
    });

    it.each([
      'Prepared by the cook, the soup was hot and the fox ate it all.',
      'Transcribed by a monk long ago, the book was old and brown.',
      'Prepared by the cook at the library.',
    ])(
      'a story-like line that opens like a credit is never dropped: %s',
      (line) => {
        expect(contentOf(`${STORY}\n\n${line}`)).toEqual({
          ok: false,
          reason: 'boilerplate-mid-body',
        });
        expect(contentOf(`${line}\n\nCHAPTER I. HOME\n\n${STORY}`)).toEqual({
          ok: false,
          reason: 'boilerplate-ambiguous',
        });
      },
    );

    it.each([
      'Michael Hart lived in a little house by the sea and loved the fox.',
      'Michael Hart was a poor fisherman.',
      'MICHAEL HART AND THE FOX',
      'Updated editions of the book were sold at the market, and the fox bought one.',
      'Project Gutenberg Street was where the fox lived.',
      "Online distributed the fox's letters to every house.",
      'This file was a gift, said the fox.',
      'Prepared by the cook at the pg diner.',
      'Prepared by the cook, who liked the @ sign.',
    ])(
      'a story line that opens like boilerplate fails closed at both ends: %s',
      (line) => {
        expect(contentOf(`${line}\n\nCHAPTER I. HOME\n\n${STORY}`)).toEqual({
          ok: false,
          reason: 'boilerplate-ambiguous',
        });
        expect(contentOf(`${STORY}\n\n${line}`)).toEqual({
          ok: false,
          reason: 'boilerplate-mid-body',
        });
      },
    );

    it('a long paragraph is never dropped on a producer token alone', () => {
      const line = `Prepared by the cook, who read an e-book aloud. ${'The soup was hot and the fox ate it all up. '.repeat(6)}`;
      expect(contentOf(`${STORY}\n\n${line}`)).toEqual({
        ok: false,
        reason: 'boilerplate-mid-body',
      });
    });

    it('keeps a line that only looks like the This ebook opener', () => {
      const line = 'This ebook-reading owl hooted at the moon.';
      expect(contentOf(`${STORY}\n\n${line}`)).toBe(`${STORY}\n\n${line}`);
    });

    it.each([
      'Michael S. Hart began the e-text effort.',
      'Michael Hart, Project Gutenberg founder.',
      'Updated editions will replace the previous one--the old editions will be renamed.',
      'Online Distributed Proofreading Team',
      'Distributed Proofreaders Canada',
      'Etext #14838',
      'This PG edition has been updated.',
    ])('a real boilerplate line is still dropped at both ends: %s', (line) => {
      expect(contentOf(`${line}\n\n${STORY}`)).toBe(STORY);
      expect(contentOf(`${STORY}\n\n${line}`)).toBe(STORY);
    });

    it.each([
      'Produced by David Widger',
      'Produced by Sue Asscher, John Hamm and Al Haines.',
      'Transcribed from the 1894 Macmillan edition by David Price, email ccx074@pglaf.org',
      'This file was produced from images generously made available by the Internet Archive.',
      'E-text prepared by Some Volunteers',
      'Transcribed from the 1894 edition by David Price, email dprice@example.org',
      'Transcribed from the 1894 edition by David Price, see pglaf.org',
    ])('a positive producer credit is dropped: %s', (line) => {
      expect(contentOf(`${line}\n\n${STORY}`)).toBe(STORY);
      expect(contentOf(`${STORY}\n\n${line}`)).toBe(STORY);
    });

    it.each([
      ["[Transcriber's Note: spelling kept.]\nThe fox found the box [sic]."],
      [
        "[Transcriber's Note: spelling kept.]\nThe fox ran home to the den.\n[Illustration]",
      ],
      ["[Transcriber's Note: x.]] The badger dug a hole."],
      ["[Transcriber's Note: x.\n\nThe badger dug a hole]]"],
    ])(
      'note text with story text after a closing bracket fails closed: %s',
      (note) => {
        expect(contentOf(`${STORY}\n\n${note}\n\n${STORY}`)).toEqual({
          ok: false,
          reason: 'transcriber-note-unclosed',
        });
      },
    );

    it('an open note whose first paragraph ends in ] fails closed', () => {
      expect(
        contentOf(
          `${STORY}\n\n[Transcriber's Note: the word [sic on page 3.]\n\nThe badger dug a deep hole by the river.\n\nThe owl said it was late]\n\n${STORY}`,
        ),
      ).toEqual({ ok: false, reason: 'transcriber-note-unclosed' });
    });

    it('a note may span at most three paragraphs', () => {
      const note = (n: number) =>
        [
          "[Transcriber's Note: one",
          ...Array.from({ length: n - 2 }, (_v, i) => `middle ${i}`),
          'end.]',
        ].join('\n\n');
      expect(contentOf(`${STORY}\n\n${note(3)}\n\n${STORY}`)).toBe(
        `${STORY}\n\n${STORY}`,
      );
      expect(contentOf(`${STORY}\n\n${note(4)}\n\n${STORY}`)).toEqual({
        ok: false,
        reason: 'transcriber-note-unclosed',
      });
    });

    it.each([
      ['T A B L E  O F  C O N T E N T S'],
      ['I N D E X'],
      ['L I S T  O F  P L A T E S'],
      ['P L A T E S'],
    ])('a spaced-letter heading is ambiguous: %j', (heading) => {
      expect(
        contentOf(
          `${heading}\n\nI. The Dark Wood\nII. The Lantern\n\n${STORY}`,
        ),
      ).toEqual(AMBIGUOUS);
    });

    it.each([
      'Contents did not matter to the fox.',
      'Contents did',
      'Index mild',
      'Contents vivid',
      'Index mild and vivid were the words.',
    ])(
      'prose after the word Contents or Index with a roman-looking word is kept: %s',
      (line) => {
        expect(
          processGutenbergText(wrap(`${line}\n\n${STORY}`), plain()).ok,
        ).toBe(true);
      },
    );

    it.each([
      ["[Transcriber's Note: the word [sic on page 3 is as printed.]"],
      ["[Transcriber's Note: spelling is as printed."],
    ])('an unclosed transcriber note fails closed: %s', (note) => {
      expect(
        contentOf(`${STORY}\n\n${note}\n\nCHAPTER II. HOME\n\n${STORY}`),
      ).toEqual({ ok: false, reason: 'transcriber-note-unclosed' });
      expect(contentOf(`${STORY}\n\n${note}\n\n${STORY}`)).toEqual({
        ok: false,
        reason: 'transcriber-note-unclosed',
      });
    });

    it('a chapter heading inside an open note fails closed even if a later ] would balance it', () => {
      expect(
        contentOf(
          `${STORY}\n\n[Transcriber's Note: spelling.\n\nCHAPTER II. HOME\n\nThe fox left.]\n\n${STORY}`,
        ),
      ).toEqual({ ok: false, reason: 'transcriber-note-unclosed' });
    });

    it.each([
      ["[Transcriber's Note: a\n\nThe fox said ] and left."],
      ["[Transcriber's Note: x] The fox ran home."],
    ])(
      'a note that closes before the paragraph ends fails closed: %s',
      (note) => {
        expect(contentOf(`${STORY}\n\n${note}\n\n${STORY}`)).toEqual({
          ok: false,
          reason: 'transcriber-note-unclosed',
        });
      },
    );

    it('keeps balanced notes, including [sic] and multi-paragraph ones', () => {
      expect(
        contentOf(
          `${STORY}\n\n[Transcriber's Note: the word [sic] on page 3 is as printed.]\n\nCHAPTER II. HOME\n\n${STORY}`,
        ),
      ).toBe(`${STORY}\n\nChapter II. Home\n\n${STORY}`);
    });

    it.each([
      ['Contents      Page'],
      ['Contents vii'],
      ['Contents  ix'],
      ['Table of Contents   Page'],
      ['CONTENTS\u2014vii'],
      ['TABLE OF CONTENTS 5'],
      ['TABLE OF CONTENTS VOLUME I'],
      ['PLATES'],
      ['COLOURED PLATES'],
      ['COLORED PLATES'],
      ['\uff23\uff4f\uff4e\uff54\uff45\uff4e\uff54\uff53\uff1a I. The Wood'],
    ])(
      'a heading with a page label or odd spelling is ambiguous: %j',
      (heading) => {
        expect(
          contentOf(
            `${heading}\n\nI. The Dark Wood\nII. The Lantern\n\n${STORY}`,
          ),
        ).toEqual(AMBIGUOUS);
      },
    );

    it.each([
      'Contents\u2014I said, and the fox smiled.',
      'Contents 3 jars of jam.',
    ])('keeps prose that starts with the word Contents: %s', (line) => {
      expect(
        processGutenbergText(wrap(`${line}\n\n${STORY}`), plain()).ok,
      ).toBe(true);
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
    const MIN_OF = 3;
    const minCpuMs = (text: string): number =>
      Math.min(...Array.from({ length: MIN_OF }, () => cpuMs(text)));
    beforeAll(() => {
      cpuMs(wrap('word\n'.repeat(60_000)));
    });
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

    it('a header of repeated listed-translator credits scans in linear time', () => {
      const credits = 'Translated by Lucy Crane\n'.repeat(40_000);
      const text = wrap(
        STORY,
        `Title: Lantern Fox\nAuthor: Ada Example\nTranslator: Lucy Crane\n${credits}`,
      );
      const e = entry({
        translator: { name: 'Lucy Crane', deathYear: 1900 },
        expect: {
          title: 'Lantern Fox',
          author: 'Example',
          translator: 'Lucy Crane',
        },
      });
      const run = () => {
        const before = process.cpuUsage();
        const r = processGutenbergText(text, e);
        const used = process.cpuUsage(before);
        expect(r).toMatchObject({ ok: true });
        return (used.user + used.system) / 1000;
      };
      expect(Math.min(run(), run(), run())).toBeLessThan(600);
    }, 120_000);

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
        'lines mentioning an index in one paragraph',
        300_000,
        80,
        (n: number) => wrap('the index finger\n' + 'word\n'.repeat(n / 5)),
      ],
      [
        'plain lines in one paragraph',
        300_000,
        80,
        (n: number) => wrap('word\n'.repeat(n / 5)),
      ],
      [
        'all-caps lines in one paragraph',
        300_000,
        400,
        (n: number) => wrap('CODE\n'.repeat(n / 5)),
      ],
      [
        'curly-quoted lines in one paragraph',
        300_000,
        400,
        (n: number) => wrap('\u201cword\u201d\n'.repeat(n / 8)),
      ],
      [
        'many heading lines in one paragraph',
        300_000,
        400,
        (n: number) => wrap('CHAPTER I.\n'.repeat(n / 11)),
      ],
      [
        'many headings glued to prose',
        300_000,
        400,
        (n: number) => wrap('CHAPTER I.\nword\n\n'.repeat(n / 17)),
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
        expect(minCpuMs(make(size / PROBE_DIVISOR))).toBeLessThan(budgetMs);
        const text = make(size);
        expect(minCpuMs(text)).toBeLessThan(budgetMs);
        const small = median(text, budgetMs);
        const floor = Math.max(small, MIN_DENOMINATOR_MS);
        const large = median(make(size * FACTOR), MAX_RATIO * floor);
        expect(large / floor).toBeLessThan(MAX_RATIO);
      },
      120_000,
    );
  });
});

describe('processGutenbergText chapter headings', () => {
  const content = (body: string) => {
    const r = processGutenbergText(wrap(body), plain());
    return r.ok ? r.content : r;
  };

  it('splits a heading off and keeps prose glued to it verbatim', () => {
    expect(
      content(`CHAPTER I.\nOnce upon a TIME the Fox walked.\n\n${STORY}`),
    ).toBe(`Chapter I.\n\nOnce upon a TIME the Fox walked.\n\n${STORY}`);
  });

  it('keeps prose after a titled heading verbatim', () => {
    expect(content(`CHAPTER II. THE LANTERN\nShe said HELLO to Fox.`)).toBe(
      'Chapter II. The Lantern\n\nShe said HELLO to Fox.',
    );
  });

  it('still processes the prose that follows a heading', () => {
    expect(content(`CHAPTER I.\n${STORY} [Illustration]`)).toBe(
      `Chapter I.\n\n${STORY}`,
    );
  });

  it.each([
    ['story words that look like a numeral', 'Part civil and part military.'],
    ['a mixed-case heading', 'Chapter I. The Hill'],
    ['a lower-case numeral', 'chapter iv'],
  ])('routes %s to review', (_n, line) => {
    expect(content(`${line}\n\n${STORY}`)).toEqual({
      ok: false,
      reason: 'heading-ambiguous',
    });
  });
});

describe('processGutenbergText title page line', () => {
  const curated = plain({ title: 'The Fox and the Lantern' });
  const content = (body: string) => {
    const r = processGutenbergText(wrap(body), curated);
    return r.ok ? r.content : r;
  };

  it('drops a paragraph equal to the source header title even when the curated title differs', () => {
    expect(content(`LANTERN FOX\n\n${STORY}`)).toBe(STORY);
  });

  it('drops only the first paragraph equal to the title, keeping a later refrain', () => {
    expect(content(`Lantern Fox\n\n${STORY}\n\nLantern Fox\n\n${STORY}`)).toBe(
      `${STORY}\n\nLantern Fox\n\n${STORY}`,
    );
  });

  it.each([
    ['directly', 'Lantern Fox\n\nLantern Fox'],
    [
      'by an illustration-only paragraph',
      'Lantern Fox\n\n[Illustration]\n\nLantern Fox',
    ],
  ])('drops a repeated title only once when separated %s', (_n, titles) => {
    expect(content(`${titles}\n\n${STORY}`)).toBe(`Lantern Fox\n\n${STORY}`);
  });

  it.each([
    ['repeated title lines', 'Lantern  Fox\n\nLANTERN FOX'],
    ['a single title line', 'Lantern Fox'],
    [
      'title lines around an illustration',
      'Lantern Fox\n\n[Illustration]\n\nLantern Fox',
    ],
  ])('a body made only of %s is empty after cleaning', (_n, body) => {
    expect(content(body)).toEqual({ ok: false, reason: 'empty-after-clean' });
  });

  it('keeps a paragraph that only contains the source title', () => {
    expect(content(`Lantern Fox and the wood.\n\n${STORY}`)).toBe(
      `Lantern Fox and the wood.\n\n${STORY}`,
    );
  });
});

describe('processGutenbergText title page residue', () => {
  const run = (body: string) => processGutenbergText(wrap(body), plain());
  const STORY_WORDS = STORY.split(' ').length;

  it.each([
    [
      'a byline paragraph after the title',
      `Lantern Fox\n\nBy Ada Example\n\n${STORY}`,
    ],
    [
      'a lower-case byline with a full stop',
      `Lantern Fox\n\nby ada example.\n\n${STORY}`,
    ],
    ['a byline with no title paragraph', `BY ADA EXAMPLE\n\n${STORY}`],
    [
      'a byline in the title paragraph',
      `LANTERN FOX\nBy Ada Example\n\n${STORY}`,
    ],
    [
      'a byline around an illustration',
      `Lantern Fox\n\n[Illustration]\n\nBy Ada Example\n\n${STORY}`,
    ],
  ])('drops %s from content and word count', (_n, body) => {
    const r = run(body);
    if (!r.ok) throw new Error(`expected ok, got ${r.reason}`);
    expect(r.content).toBe(STORY);
    expect(r.wordCount).toBe(STORY_WORDS);
  });

  it.each([
    [
      'a subtitle paragraph after the title',
      "Lantern Fox\n\nOr, The Fox's Lantern\n\n" + STORY,
    ],
    [
      'an all-capitals tagline after the title',
      `Lantern Fox\n\nA TALE FOR CHILDREN.\n\n${STORY}`,
    ],
    [
      'a subtitle line in the title paragraph',
      `LANTERN FOX\nA tale for children\n\n${STORY}`,
    ],
    [
      'a byline naming someone else',
      `Lantern Fox\n\nBy Someone Else\n\n${STORY}`,
    ],
    [
      'a title paragraph followed by a non-byline line',
      `Lantern Fox\nBy the light of the moon, a fox walked home.\n\n${STORY}`,
    ],
  ])('routes %s to review', (_n, body) => {
    expect(run(body)).toEqual({ ok: false, reason: 'title-page-ambiguous' });
  });

  it.each([
    ['CHAPTER ONE'],
    ['Chapter One'],
    ['CHAPTER THE FIRST'],
    ['STAVE ONE'],
    ['PREFACE'],
    ['I.'],
    ['Twinkle, twinkle, little star'],
    ['The fox walked home'],
  ])('keeps %s as the opening after the title', (opening) => {
    const r = run(`Lantern Fox\n\n${opening}\n\n${STORY}`);
    if (!r.ok) throw new Error(`expected ok, got ${r.reason}`);
    expect(r.content).toContain(opening);
  });

  it.each([
    ['James Matthew Barrie', 'J. M. Barrie (James Matthew)', 'Barrie'],
    ['Selma Lagerlof', 'Selma Lagerl\u00f6f', 'Lagerl\u00f6f'],
    ['Aesop', '\u00c6sop', '\u00c6sop'],
  ])('drops a byline "By %s" for header author %s', (named, header, key) => {
    const r = processGutenbergText(
      wrap(
        `Lantern Fox\n\nBy ${named}\n\n${STORY}`,
        `Title: Lantern Fox\nAuthor: ${header}`,
      ),
      plain({ expect: { title: 'Lantern Fox', author: key } }),
    );
    expect(r).toMatchObject({ ok: true, content: STORY });
  });

  it.each([['By Dot Drawn'], ['By Ada Example and Dot Drawn']])(
    'routes a first paragraph "%s" naming someone else to review',
    (line) => {
      expect(run(`${line}\n\n${STORY}`)).toEqual({
        ok: false,
        reason: 'title-page-ambiguous',
      });
    },
  );

  it('keeps a first sentence that merely starts with "By"', () => {
    const line = 'By the light of the moon the fox walked home.';
    expect(run(`${line}\n\n${STORY}`)).toMatchObject({ ok: true });
  });

  it('routes a wrapped title with a byline in one paragraph to review', () => {
    expect(run(`THE TALE OF\nLANTERN FOX\nBY ADA EXAMPLE\n\n${STORY}`)).toEqual(
      { ok: false, reason: 'title-page-ambiguous' },
    );
  });

  it.each([['A Story for Children.'], ['A tale for the little ones.']])(
    'routes the punctuated subtitle "%s" after the title to review',
    (line) => {
      expect(run(`Lantern Fox\n\n${line}\n\n${STORY}`)).toEqual({
        ok: false,
        reason: 'title-page-ambiguous',
      });
    },
  );

  it('keeps a full first sentence that follows the title', () => {
    const r = run(`Lantern Fox\n\n${STORY}`);
    expect(r).toMatchObject({ ok: true, content: STORY });
  });

  it('does not treat a byline after story text as title page residue', () => {
    const r = run(`${STORY}\n\nBy Ada Example\n\n${STORY}`);
    expect(r).toMatchObject({
      ok: true,
      content: `${STORY}\n\nBy Ada Example\n\n${STORY}`,
    });
  });
});

describe('processGutenbergText word cap', () => {
  it('never allows more than the hard cap, even when maxWords is raised', () => {
    const body = Array.from({ length: 700 }, () => STORY).join('\n\n');
    expect(
      processGutenbergText(wrap(body), plain(), { maxWords: 1_000_000 }),
    ).toEqual({ ok: false, reason: 'oversized' });
  });
});

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

  it('removes paragraphs with obfuscated references and ebook numbers', () => {
    const r = processGutenbergText(
      fx('90006-0.txt').toString('utf8'),
      entry({
        ebookId: '90006',
        translator: undefined,
        expect: { title: 'Sneaky', author: 'Example' },
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.content).toBe('Plain paragraph here.');
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

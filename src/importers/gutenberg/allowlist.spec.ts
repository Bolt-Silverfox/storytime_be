import {
  validateAllowList,
  effectiveStatus,
  GUTENBERG_ALLOWLIST,
} from './allowlist';
import { AllowListEntry } from './allowlist.types';
import { GUTENBERG_REFERENCE } from './gutenberg-text';

const base = (over: Partial<AllowListEntry> = {}): AllowListEntry => ({
  ebookId: '1',
  title: 'T',
  authorName: 'A',
  firstPublished: 1900,
  status: 'approved',
  flags: [],
  ageMin: 4,
  ageMax: 7,
  categories: [],
  themes: [],
  description: 'd',
  expect: { title: 't', author: 'a' },
  pdJustification: 'x',
  ...over,
});

describe('allow-list rules', () => {
  const NOW = new Date('2026-11-01T00:00:00Z');

  it('approved plain entry stays approved', () => {
    expect(effectiveStatus(base(), NOW)).toEqual({ status: 'approved' });
  });

  it('dated-content flag forces needs-editorial-retell', () => {
    expect(effectiveStatus(base({ flags: ['dated-content'] }), NOW)).toEqual({
      status: 'needs-editorial-retell',
      reason: expect.stringMatching(/dated-content/),
    });
  });

  it('translator without a death year is needs-review', () => {
    const r = effectiveStatus(base({ translator: { name: 'X' } }), NOW);
    expect(r.status).toBe('needs-review');
  });

  it('translator dead less than 70 full years is needs-review (life+70)', () => {
    // died 1956 -> PD from 1 Jan 2027, so still needs-review on 2026-11-01
    expect(
      effectiveStatus(
        base({ translator: { name: 'H', deathYear: 1956 } }),
        NOW,
      ).status,
    ).toBe('needs-review');
    expect(
      effectiveStatus(
        base({ translator: { name: 'H', deathYear: 1955 } }),
        NOW,
      ).status,
    ).toBe('approved');
  });

  it('explicit needs-review / excluded win and carry the reason', () => {
    expect(
      effectiveStatus(
        base({ status: 'excluded', statusReason: 'no' }),
        NOW,
      ),
    ).toEqual({ status: 'excluded', reason: 'no' });
  });

  it('validateAllowList rejects duplicates, bad ids, bad ages, Gutenberg in public fields', () => {
    expect(() => validateAllowList([base(), base()])).toThrow(/duplicate/i);
    expect(() => validateAllowList([base({ ebookId: '../x' })])).toThrow(/id/i);
    expect(() => validateAllowList([base({ ageMin: 9, ageMax: 3 })])).toThrow(
      /age/i,
    );
    expect(() =>
      validateAllowList([base({ title: 'Project Gutenberg Tales' })]),
    ).toThrow(/reference/i);
    expect(() =>
      validateAllowList([base({ status: 'excluded' })]),
    ).toThrow(/statusReason/);
    expect(() =>
      validateAllowList([base({ firstPublished: 1950, status: 'approved' })]),
    ).toThrow(/pre-1931|published/i);
  });

  describe('shipped allow-list', () => {
    it('passes validation and has no Gutenberg reference in any public field', () => {
      expect(() => validateAllowList(GUTENBERG_ALLOWLIST)).not.toThrow();
      for (const e of GUTENBERG_ALLOWLIST) {
        const pub = [
          e.title,
          e.authorName,
          e.description,
          e.translator?.name,
          e.illustrator,
        ].join(' ');
        expect(pub).not.toMatch(GUTENBERG_REFERENCE);
      }
    });
    it('has about ten entries, with at least one of each outcome', () => {
      expect(GUTENBERG_ALLOWLIST.length).toBeGreaterThanOrEqual(9);
      const s = GUTENBERG_ALLOWLIST.map((e) => effectiveStatus(e, NOW).status);
      expect(s).toContain('approved');
      expect(s).toContain('needs-editorial-retell');
      expect(s).toContain('needs-review');
      expect(s).toContain('excluded');
    });
  });
});

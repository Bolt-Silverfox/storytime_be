import { maskSourceFieldsForPublic } from './public-credit.util';

const pd = (over = {}) => ({
  id: 's1',
  title: 'T',
  licenseCode: 'PD-US',
  sourceName: 'gutenberg',
  sourceUrl: 'https://example.org/ebooks/1',
  attributionText: 'T by A. Public domain in the United States.',
  authorName: 'A',
  licenseUrl: 'https://example.org/pdm',
  ...over,
});

describe('maskSourceFieldsForPublic', () => {
  it('nulls sourceName and sourceUrl for PD-US, keeps the public credit', () => {
    const out = maskSourceFieldsForPublic(pd());
    expect(out.sourceName).toBeNull();
    expect(out.sourceUrl).toBeNull();
    expect(out.attributionText).toContain('Public domain');
    expect(out.authorName).toBe('A');
    expect(out.licenseCode).toBe('PD-US');
    expect(out.licenseUrl).toBe('https://example.org/pdm');
  });

  it('masks when sourceName is gutenberg even if licenseCode is missing', () => {
    const out = maskSourceFieldsForPublic(pd({ licenseCode: null }));
    expect(out.sourceName).toBeNull();
    expect(out.sourceUrl).toBeNull();
  });

  it('leaves other licences (CC BY needs the link back) untouched', () => {
    const cc = pd({ licenseCode: 'CC-BY-4.0', sourceName: 'bookdash' });
    expect(maskSourceFieldsForPublic(cc)).toEqual(cc);
  });

  it('reaches nested rows: arrays, wrappers, includes, favourites', () => {
    const out = maskSourceFieldsForPublic({
      data: [{ story: pd() }, { id: 'x', story: { ...pd(), images: [] } }],
      page: { items: [pd()] },
    });
    for (const s of [out.data[0].story, out.data[1].story, out.page.items[0]]) {
      expect(s.sourceName).toBeNull();
      expect(s.sourceUrl).toBeNull();
    }
  });

  it('does not mutate its input (cached objects stay intact)', () => {
    const input = { story: pd() };
    const copy = JSON.parse(JSON.stringify(input));
    maskSourceFieldsForPublic(input);
    expect(input).toEqual(copy);
  });

  it('returns the same reference when nothing needs masking', () => {
    const o = { a: [1, 2], b: { c: 'd' } };
    expect(maskSourceFieldsForPublic(o)).toBe(o);
  });

  it('keeps Dates, Buffers and nulls, and survives cycles', () => {
    const d = new Date();
    const cyc: any = { name: 'c', story: pd(), when: d };
    cyc.self = cyc;
    const out = maskSourceFieldsForPublic(cyc);
    expect(out.when).toBe(d);
    expect(out.story.sourceName).toBeNull();
    expect(maskSourceFieldsForPublic(null)).toBeNull();
    expect(maskSourceFieldsForPublic('x')).toBe('x');
  });

  it('works on class instances without losing their prototype', () => {
    class Dto {
      licenseCode = 'PD-US';
      sourceName: string | null = 'gutenberg';
      sourceUrl: string | null = 'https://x';
    }
    const out = maskSourceFieldsForPublic(new Dto());
    expect(out).toBeInstanceOf(Dto);
    expect(out.sourceName).toBeNull();
  });

  describe('extra masking rules', () => {
    it.each([
      'https://www.gutenberg.org/ebooks/1',
      'https://gutenberg.org/x',
      'http://aleph.gutenberg.org/1/2',
      'https://www.gutenberg.ca/x',
      'https://GUTENBERG.NET/x',
    ])('masks any row whose sourceUrl host is a gutenberg site: %s', (url) => {
      const out = maskSourceFieldsForPublic({
        licenseCode: 'CC0',
        sourceName: 'other',
        sourceUrl: url,
        attributionText: 'a',
      });
      expect(out.sourceUrl).toBeNull();
      expect(out.sourceName).toBeNull();
    });

    it.each([' Gutenberg ', 'Project Gutenberg', 'GUTENBERG-mirror'])(
      'masks sourceName matching /gutenberg/i after trim: %s',
      (n) => {
        const out = maskSourceFieldsForPublic({
          sourceName: n,
          sourceUrl: 'https://x.test/1',
        });
        expect(out.sourceName).toBeNull();
        expect(out.sourceUrl).toBeNull();
      },
    );

    it('masks an object that only has sourceUrl on a gutenberg host', () => {
      const out = maskSourceFieldsForPublic({
        sourceUrl: 'https://www.gutenberg.org/ebooks/9',
      });
      expect(out.sourceUrl).toBeNull();
    });

    it('does not mask a look-alike host or an unrelated licence', () => {
      const a = {
        licenseCode: 'CC-BY-4.0',
        sourceName: 'bookdash',
        sourceUrl: 'https://notgutenberg.org.example.com/x',
      };
      // host contains "gutenberg" only as a label of another registrable domain
      expect(maskSourceFieldsForPublic(a).sourceUrl).toBe(a.sourceUrl);
    });

    it('stops at a depth cap instead of overflowing the stack', () => {
      let deep: any = {
        story: {
          licenseCode: 'PD-US',
          sourceName: 'gutenberg',
          sourceUrl: 'https://www.gutenberg.org/1',
        },
      };
      for (let i = 0; i < 20_000; i++) deep = { child: deep };
      expect(() => maskSourceFieldsForPublic(deep)).not.toThrow();
    });

    it('still masks within the cap (depth 60)', () => {
      let deep: any = {
        story: {
          licenseCode: 'PD-US',
          sourceName: 'gutenberg',
          sourceUrl: 'https://www.gutenberg.org/1',
        },
      };
      for (let i = 0; i < 60; i++) deep = { child: deep };
      let cur = maskSourceFieldsForPublic(deep);
      for (let i = 0; i < 60; i++) cur = cur.child;
      expect(cur.story.sourceName).toBeNull();
    });
  });
});

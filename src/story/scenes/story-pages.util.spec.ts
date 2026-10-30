import {
  STORY_WORDS_PER_PAGE,
  hashSceneText,
  splitStoryIntoPages,
  validateSceneRanges,
} from './story-pages.util';

const words = (n: number, prefix = 'w') =>
  Array.from({ length: n }, (_, i) => `${prefix}${i}`).join(' ');

describe('story-pages.util', () => {
  it('uses the same 30-word page size as TTS', () => {
    expect(STORY_WORDS_PER_PAGE).toBe(30);
  });

  it('splits like the TTS paragraph splitter (sentence-preserving, 30 words)', () => {
    const text = `${words(20, 'a')}. ${words(20, 'b')}. ${words(5, 'c')}.`;
    const pages = splitStoryIntoPages(text);
    expect(pages).toHaveLength(2);
    expect(pages[0].split(' ')).toHaveLength(20);
  });

  it('returns no pages for empty or missing text', () => {
    expect(splitStoryIntoPages(null)).toEqual([]);
    expect(splitStoryIntoPages('   ')).toEqual([]);
  });

  it('hashes the scene text stably and changes when the text changes', () => {
    const pages = ['one', 'two', 'three'];
    expect(hashSceneText(pages, 0, 1)).toBe(hashSceneText(pages, 0, 1));
    expect(hashSceneText(pages, 0, 1)).not.toBe(hashSceneText(pages, 1, 2));
    expect(hashSceneText(['one', 'TWO', 'three'], 0, 1)).not.toBe(
      hashSceneText(pages, 0, 1),
    );
  });

  describe('validateSceneRanges', () => {
    it('accepts contiguous ranges covering every page', () => {
      expect(
        validateSceneRanges(
          [
            { startPage: 0, endPage: 2 },
            { startPage: 3, endPage: 4 },
          ],
          5,
        ),
      ).toBeNull();
    });

    it.each([
      ['empty list', [], 5],
      ['not starting at 0', [{ startPage: 1, endPage: 4 }], 5],
      [
        'gap',
        [
          { startPage: 0, endPage: 1 },
          { startPage: 3, endPage: 4 },
        ],
        5,
      ],
      [
        'overlap',
        [
          { startPage: 0, endPage: 2 },
          { startPage: 2, endPage: 4 },
        ],
        5,
      ],
      ['end before start', [{ startPage: 0, endPage: -1 }], 5],
      ['beyond page count', [{ startPage: 0, endPage: 5 }], 5],
      ['not covering last page', [{ startPage: 0, endPage: 3 }], 5],
      ['story with no pages', [{ startPage: 0, endPage: 0 }], 0],
    ])('rejects %s', (_name, ranges, pageCount) => {
      expect(
        validateSceneRanges(
          ranges as { startPage: number; endPage: number }[],
          pageCount as number,
        ),
      ).toEqual(expect.any(String));
    });
  });
});

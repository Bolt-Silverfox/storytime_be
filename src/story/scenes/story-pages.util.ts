import { createHash } from 'crypto';
import { splitByWordCountPreservingSentences } from '@/voice/utils/paragraph-splitter';

/**
 * Words per page. This is the single source of truth: TTS batching
 * (tts-batch.service.ts) imports it, so a "page" here is exactly a TTS
 * paragraph and scene page indexes line up with paragraph audio indexes.
 */
export const STORY_WORDS_PER_PAGE = 30;

/** Pages (0-based) the backend uses for a story's text. */
export function splitStoryIntoPages(text: string | null | undefined): string[] {
  if (!text || !text.trim()) return [];
  return splitByWordCountPreservingSentences(text, STORY_WORDS_PER_PAGE);
}

/** sha256 of the scene's page text (startPage..endPage inclusive). */
export function hashSceneText(
  pages: string[],
  startPage: number,
  endPage: number,
): string {
  return createHash('sha256')
    .update(pages.slice(startPage, endPage + 1).join('\n'))
    .digest('hex');
}

export interface SceneRange {
  startPage: number;
  endPage: number;
}

/**
 * Scenes must start at page 0, be contiguous and non-overlapping, and cover
 * every page (last endPage === pageCount - 1). Returns an error message, or
 * null when valid.
 */
export function validateSceneRanges(
  ranges: SceneRange[],
  pageCount: number,
): string | null {
  if (pageCount <= 0) return 'Story has no pages to illustrate';
  if (!ranges.length) return 'At least one scene is required';
  let expectedStart = 0;
  for (let i = 0; i < ranges.length; i++) {
    const { startPage, endPage } = ranges[i];
    if (!Number.isInteger(startPage) || !Number.isInteger(endPage)) {
      return `Scene ${i}: pages must be integers`;
    }
    if (startPage !== expectedStart) {
      return `Scene ${i}: startPage must be ${expectedStart} (scenes must be contiguous and non-overlapping, starting at page 0)`;
    }
    if (endPage < startPage) {
      return `Scene ${i}: endPage must be >= startPage`;
    }
    if (endPage > pageCount - 1) {
      return `Scene ${i}: endPage ${endPage} is beyond the last page (${pageCount - 1})`;
    }
    expectedStart = endPage + 1;
  }
  if (expectedStart !== pageCount) {
    return `Scenes must cover every page; last scene must end at page ${pageCount - 1}`;
  }
  return null;
}

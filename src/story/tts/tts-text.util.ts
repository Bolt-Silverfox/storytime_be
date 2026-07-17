/**
 * Normalize text for TTS providers by stripping literal quote characters
 * and collapsing whitespace. Without this, engines may read "quote" aloud.
 * Preserves contractions (don't, it's) and prosody-affecting punctuation (.,!?…—).
 */
export function preprocessTextForTTS(text: string): string {
  return (
    text
      // Remove double-quote variants (never used as apostrophes)
      .replace(/[\u201C\u201D\u201E\u201F"]/g, '')
      // Remove single-quote variants only at word boundaries (preserves contractions: don't, it's, I'm)
      .replace(
        /(?<!\w)[\u2018\u2019\u201A\u201B']|[\u2018\u2019\u201A\u201B'](?!\w)/g,
        '',
      )
      .replace(/\s+/g, ' ')
      .trim()
  );
}

export function splitByWordCountPreservingSentences(
  text: string,
  wordsPerChunk: number,
): string[] {
  const cleanedText = text.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
  const sentences = cleanedText.split(/(?<=[.!?])\s+/).filter((s) => s.trim());
  const chunks: string[] = [];
  let currentChunk: string[] = [];
  let currentWordCount = 0;

  for (const sentence of sentences) {
    const words = sentence.split(' ').filter((w) => w.length > 0);
    const sentenceWordCount = words.length;

    // If a single sentence exceeds the limit, split it into sub-chunks
    if (sentenceWordCount > wordsPerChunk) {
      if (currentChunk.length > 0) {
        chunks.push(currentChunk.join(' '));
        currentChunk = [];
        currentWordCount = 0;
      }
      for (let i = 0; i < words.length; i += wordsPerChunk) {
        chunks.push(words.slice(i, i + wordsPerChunk).join(' '));
      }
      continue;
    }

    if (
      currentWordCount + sentenceWordCount > wordsPerChunk &&
      currentChunk.length > 0
    ) {
      chunks.push(currentChunk.join(' '));
      currentChunk = [];
      currentWordCount = 0;
    }

    currentChunk.push(sentence);
    currentWordCount += sentenceWordCount;
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk.join(' '));
  }

  return chunks;
}

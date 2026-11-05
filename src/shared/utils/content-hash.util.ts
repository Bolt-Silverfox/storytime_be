import { createHash } from 'crypto';

/**
 * Normalise story text before hashing so cosmetic differences (line endings,
 * runs of whitespace, unicode composition) don't defeat dedupe.
 * Case and punctuation are preserved on purpose.
 */
export const normalizeTextForHash = (text: string): string =>
  text.normalize('NFC').replace(/\s+/g, ' ').trim();

/** sha256 (hex) of the normalised text. Stored in stories.contentHash. */
export const contentHashOf = (text: string): string =>
  createHash('sha256').update(normalizeTextForHash(text), 'utf8').digest('hex');

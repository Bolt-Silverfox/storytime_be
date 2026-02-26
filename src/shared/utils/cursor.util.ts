export class CursorUtil {
  /**
   * Encode a record ID into an opaque cursor string (base64url).
   */
  static encode(id: string): string {
    return Buffer.from(JSON.stringify({ id })).toString('base64url');
  }

  /**
   * Decode an opaque cursor string back to a record ID.
   * Returns null on invalid input (never throws).
   */
  static decode(cursor: string): string | null {
    try {
      const json = Buffer.from(cursor, 'base64url').toString('utf-8');
      const parsed = JSON.parse(json);
      if (typeof parsed?.id === 'string' && parsed.id.length > 0) {
        return parsed.id;
      }
      return null;
    } catch {
      return null;
    }
  }
}

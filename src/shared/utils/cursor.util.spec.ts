import { CursorUtil } from './cursor.util';

describe('CursorUtil', () => {
  describe('encode/decode round-trip', () => {
    it('should round-trip a UUID', () => {
      const id = 'd290f1ee-6c54-4b01-90e6-d701748f0851';
      const cursor = CursorUtil.encode(id);
      expect(CursorUtil.decode(cursor)).toBe(id);
    });

    it('should round-trip a simple string id', () => {
      const id = 'abc123';
      const cursor = CursorUtil.encode(id);
      expect(CursorUtil.decode(cursor)).toBe(id);
    });

    it('should produce a base64url string (no padding, no +/)', () => {
      const cursor = CursorUtil.encode('test-id');
      expect(cursor).not.toMatch(/[+/=]/);
    });
  });

  describe('decode edge cases', () => {
    it('should return null for empty string', () => {
      expect(CursorUtil.decode('')).toBeNull();
    });

    it('should return null for invalid base64', () => {
      expect(CursorUtil.decode('not-valid-base64!!!')).toBeNull();
    });

    it('should return null for valid base64 but invalid JSON', () => {
      const notJson = Buffer.from('not json').toString('base64url');
      expect(CursorUtil.decode(notJson)).toBeNull();
    });

    it('should return null for JSON without id field', () => {
      const noId = Buffer.from(JSON.stringify({ foo: 'bar' })).toString(
        'base64url',
      );
      expect(CursorUtil.decode(noId)).toBeNull();
    });

    it('should return null for JSON with empty id', () => {
      const emptyId = Buffer.from(JSON.stringify({ id: '' })).toString(
        'base64url',
      );
      expect(CursorUtil.decode(emptyId)).toBeNull();
    });

    it('should return null for JSON with numeric id', () => {
      const numericId = Buffer.from(JSON.stringify({ id: 123 })).toString(
        'base64url',
      );
      expect(CursorUtil.decode(numericId)).toBeNull();
    });
  });
});

import { normalizeTextForHash, contentHashOf } from './content-hash.util';

describe('content-hash.util', () => {
  it('normalises line endings, whitespace runs and unicode form', () => {
    expect(normalizeTextForHash('  Hello\r\n\r\nWorld \t again  ')).toBe(
      'Hello World again',
    );
    // NFC: "e" + combining acute equals precomposed "é"
    expect(normalizeTextForHash('café')).toBe('café');
  });

  it('is stable across formatting-only differences', () => {
    expect(contentHashOf('A  b\r\nc')).toBe(contentHashOf('A b c'));
  });

  it('differs when the words differ and is a 64-char sha256 hex', () => {
    const a = contentHashOf('once upon a time');
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(contentHashOf('once upon a dime'));
  });

  it('matches a known sha256 of the normalised text', () => {
    // sha256("abc")
    expect(contentHashOf('  abc ')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

import { stripCredentials } from './strip-credentials';

describe('stripCredentials', () => {
  it('removes hashes at every depth, through arrays, keeping dates and other values', () => {
    const when = new Date('2026-01-01T00:00:00.000Z');
    const result = stripCredentials({
      id: 'u1',
      passwordHash: 'x',
      pinHash: 'y',
      createdAt: when,
      kids: [{ id: 'k', parent: { pinHash: 'z', email: 'e' } }],
      profile: null,
    });
    expect(result).toEqual({
      id: 'u1',
      createdAt: when,
      kids: [{ id: 'k', parent: { email: 'e' } }],
      profile: null,
    });
    expect(result.createdAt).toBe(when);
  });

  it('passes primitives and null through', () => {
    expect(stripCredentials(null)).toBeNull();
    expect(stripCredentials('a')).toBe('a');
  });
});

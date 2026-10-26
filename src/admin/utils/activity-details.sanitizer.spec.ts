import {
  REDACTED,
  extractStoryId,
  sanitizeActivityDetails,
} from './activity-details.sanitizer';

describe('sanitizeActivityDetails', () => {
  it('returns null for empty input', () => {
    expect(sanitizeActivityDetails(null)).toBeNull();
    expect(sanitizeActivityDetails(undefined)).toBeNull();
    expect(sanitizeActivityDetails('')).toBeNull();
    expect(sanitizeActivityDetails('   ')).toBeNull();
  });

  it('keeps harmless JSON fields untouched', () => {
    expect(
      sanitizeActivityDetails(
        JSON.stringify({ provider: 'eleven', type: 'tts', credits: 3 }),
      ),
    ).toEqual({ provider: 'eleven', type: 'tts', credits: 3 });
  });

  it.each([
    'password',
    'newPassword',
    'passwordHash',
    'pin',
    'pinHash',
    'oldPin',
    'accessToken',
    'refresh_token',
    'token',
    'secret',
    'clientSecret',
    'otp',
    'apiKey',
    'api_key',
    'authorization',
    'cookie',
    'cvv',
    'signature',
    'email',
    'parentEmail',
  ])('redacts the value of secret-like key %s', (key) => {
    const out = sanitizeActivityDetails(
      JSON.stringify({ [key]: 'super-sensitive-value', keep: 'ok' }),
    );
    expect(out).toEqual({ [key]: REDACTED, keep: 'ok' });
  });

  it('does not redact look-alike keys that merely contain "pin"', () => {
    expect(
      sanitizeActivityDetails(JSON.stringify({ shipping: 'a', mapping: 'b' })),
    ).toEqual({ shipping: 'a', mapping: 'b' });
  });

  it('redacts nested secrets and secrets inside arrays', () => {
    const out = sanitizeActivityDetails(
      JSON.stringify({
        a: { b: { password: 'x', ok: 1 } },
        list: [{ token: 't' }, { fine: true }],
      }),
    );
    expect(out).toEqual({
      a: { b: { password: REDACTED, ok: 1 } },
      list: [{ token: REDACTED }, { fine: true }],
    });
  });

  it('redacts email addresses and bearer/JWT-like values inside string values', () => {
    const jwt =
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnopqrstuvwxyz';
    const out = sanitizeActivityDetails(
      JSON.stringify({
        note: 'sent to someone@example.com today',
        header: `Bearer ${jwt}`,
        raw: jwt,
        blob: 'a'.repeat(48),
      }),
    ) as Record<string, string>;
    expect(out.note).toBe(`sent to ${REDACTED} today`);
    expect(out.header).not.toContain('eyJ');
    expect(out.raw).toBe(REDACTED);
    expect(out.blob).toBe(REDACTED);
  });

  it('wraps free-text (non-JSON) details as { message } with emails redacted', () => {
    expect(
      sanitizeActivityDetails('User registered: someone@example.com'),
    ).toEqual({ message: `User registered: ${REDACTED}` });
  });

  it('wraps non-object JSON (array / scalar) as { message }', () => {
    expect(sanitizeActivityDetails('[1,2]')).toEqual({ message: '[1,2]' });
    expect(sanitizeActivityDetails('"hi"')).toEqual({ message: '"hi"' });
  });

  it('truncates very long strings and caps array length and depth', () => {
    const out = sanitizeActivityDetails(
      JSON.stringify({
        long: 'x y '.repeat(500),
        arr: Array.from({ length: 200 }, (_, i) => i),
        deep: { a: { b: { c: { d: { e: { f: 1 } } } } } },
      }),
    ) as Record<string, any>;
    expect(out.long.length).toBeLessThanOrEqual(501);
    expect(out.arr).toHaveLength(50);
    expect(JSON.stringify(out.deep)).toContain('[truncated]');
    expect(JSON.stringify(out.deep)).not.toContain('"f"');
  });

  it('is not fooled by prototype-pollution style keys', () => {
    const out = sanitizeActivityDetails('{"__proto__":{"x":1},"ok":1}');
    expect(out).toEqual({ ok: 1 });
    expect(({} as any).x).toBeUndefined();
  });
});

describe('extractStoryId', () => {
  it('reads storyId / story_id string from a sanitized details object', () => {
    expect(extractStoryId({ storyId: 's1' })).toBe('s1');
    expect(extractStoryId({ story_id: 's2' })).toBe('s2');
  });
  it('returns null otherwise', () => {
    expect(extractStoryId(null)).toBeNull();
    expect(extractStoryId({ storyId: 5 })).toBeNull();
    expect(extractStoryId({ message: 'x' })).toBeNull();
  });
});

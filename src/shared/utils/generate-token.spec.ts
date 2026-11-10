import * as crypto from 'crypto';
import { generateResetCode, generateToken } from './generate-token';

jest.mock('crypto', () => {
  const actual = jest.requireActual<typeof import('crypto')>('crypto');
  return { ...actual, randomInt: jest.fn(actual.randomInt) };
});

describe('generateResetCode', () => {
  const randomInt = crypto.randomInt as unknown as jest.Mock;

  afterEach(() => {
    randomInt.mockClear();
  });

  it('draws uniformly from all 8-digit values via the CSPRNG', () => {
    generateResetCode();

    expect(randomInt).toHaveBeenCalledWith(0, 100_000_000);
  });

  it.each([
    [0, '00000000'],
    [42, '00000042'],
    [99_999_999, '99999999'],
  ])('renders %i as the zero-padded string %s', (value, expected) => {
    randomInt.mockReturnValueOnce(value);

    expect(generateResetCode().token).toBe(expected);
  });

  it('always yields exactly 8 digits', () => {
    for (let i = 0; i < 200; i++) {
      expect(generateResetCode().token).toMatch(/^\d{8}$/);
    }
  });

  it('expires after the requested number of hours', () => {
    const before = Date.now();

    const { expiresAt } = generateResetCode(24);

    const hours = (expiresAt.getTime() - before) / 3_600_000;
    expect(hours).toBeGreaterThan(23.99);
    expect(hours).toBeLessThan(24.01);
  });

  it('leaves the 6-digit verification token unchanged', () => {
    expect(generateToken(24).token).toMatch(/^\d{6}$/);
  });
});

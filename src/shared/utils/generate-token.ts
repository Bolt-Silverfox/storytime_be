import * as crypto from 'crypto';

/**
 * Generates a token with a specified expiration time
 * @param expiresInHours Number of hours until the token expires
 * @returns An object containing the token and its expiration date
 */
export function generateToken(expiresInHours = 24): {
  token: string;
  expiresAt: Date;
} {
  const token = generateSecureNumberToken();
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + expiresInHours);

  return { token, expiresAt };
}

/**
 * Generates a cryptographically secure number token of 6 digits.
 * @returns {string} The generated token as a string.
 */
function generateSecureNumberToken(): string {
  const token = crypto.randomInt(100000, 999999);
  return token.toString();
}

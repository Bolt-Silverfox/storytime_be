/**
 * Generates a random 6-digit token for verification purposes
 * @returns A string containing a 6-digit token
 */
export function generateSixDigitToken(): string {
  // Generate a random number between 100000 and 999999
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * Generates a token with a specified expiration time
 * @param expiresInHours Number of hours until the token expires
 * @returns An object containing the token and its expiration date
 */
export function generateToken(expiresInHours = 24): {
  token: string;
  expiresAt: Date;
} {
  const token = generateSixDigitToken();
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + expiresInHours);

  return { token, expiresAt };
}

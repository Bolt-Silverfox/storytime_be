export const isTokenExpired = (
  token: { expiresAt: Date },
  now: Date = new Date(),
): boolean => token.expiresAt <= now;

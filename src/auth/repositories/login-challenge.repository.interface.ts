export const LOGIN_CHALLENGE_REPOSITORY = Symbol('LOGIN_CHALLENGE_REPOSITORY');

export interface NewLoginChallenge {
  id: string;
  emailNormalized: string;
  codeHash: string;
  linkTokenHash: string;
  expiresAt: Date;
  requestIpHash: string | null;
  now: Date;
}

export interface ILoginChallengeRepository {
  replaceOpenChallenge(data: NewLoginChallenge): Promise<void>;
  findOpenIdByEmail(emailNormalized: string, now: Date): Promise<string | null>;
  recordAttempt(id: string, now: Date): Promise<{ codeHash: string } | null>;
  consumeById(id: string, now: Date): Promise<string | null>;
  consumeByLinkTokenHash(
    linkTokenHash: string,
    now: Date,
  ): Promise<string | null>;
  deleteExpiredBefore(cutoff: Date, limit: number): Promise<number>;
}

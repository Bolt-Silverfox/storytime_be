import { ConfigService } from '@nestjs/config';
import { Profile } from 'passport-google-oauth20';
import { GoogleOAuthStrategy } from './google-oauth.strategy';

describe('GoogleOAuthStrategy', () => {
  const strategy = new GoogleOAuthStrategy({
    get: (key: string) => `test-${key}`,
  } as unknown as ConfigService);

  const verifiedFlagFor = (emails: Profile['emails']) => {
    const done = jest.fn();
    strategy.validate(
      'access',
      'refresh',
      { id: 'g-1', emails } as Profile,
      done,
    );
    return (done.mock.calls[0][1] as { emailVerified: unknown }).emailVerified;
  };

  it.each([
    {
      label: 'verified',
      emails: [{ value: 'a@example.com', verified: true }],
      expected: true,
    },
    {
      label: 'unverified',
      emails: [{ value: 'a@example.com', verified: false }],
      expected: false,
    },
    {
      label: 'without a verified flag',
      emails: [{ value: 'a@example.com' }] as Profile['emails'],
      expected: false,
    },
    { label: 'without an email', emails: undefined, expected: false },
  ])(
    'passes the email as verified only when Google says so ($label)',
    ({ emails, expected }) => {
      expect(verifiedFlagFor(emails)).toBe(expected);
    },
  );
});

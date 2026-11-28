import { JwtService } from '@nestjs/jwt';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { OnboardingService } from './onboarding.service';
import { TokenService } from './token.service';
import { findOrCreateParentByVerifiedEmail } from './verified-email-user';
import { ResourceAlreadyExistsException } from '@/shared/exceptions';
import { InMemoryAuthRepository } from '@/shared/testing/passwordless-fakes';

const EMAIL = 'victim@example.com';

const build = (onSend: (repo: InMemoryAuthRepository) => Promise<void>) => {
  const repo = new InMemoryAuthRepository();
  const tokenService = new TokenService(
    new JwtService({ secret: 'jwt-secret' }),
    repo as never,
  );
  const service = new OnboardingService(
    repo as never,
    { hashPassword: jest.fn().mockResolvedValue('hashed') } as never,
    tokenService,
    new EventEmitter2(),
    { get: jest.fn() } as never,
    { sendEmailVerification: () => onSend(repo) } as never,
  );
  return { repo, service };
};

const register = (service: OnboardingService) =>
  service.register({
    fullName: 'Registrant',
    email: EMAIL,
    password: 'password123',
  });

const takeOver = (repo: InMemoryAuthRepository) =>
  findOrCreateParentByVerifiedEmail(
    {
      authRepository: repo as never,
      passwordService: { hashPassword: () => Promise.resolve('rotated') },
    },
    { email: EMAIL, emailVerified: true, matchEmailCaseInsensitively: true },
  ).then(() => undefined);

describe('OnboardingService.register racing a verified-email takeover', () => {
  it('gives the registrant a session when nothing verified the account in between', async () => {
    const { repo, service } = build(() => Promise.resolve());

    const result = await register(service);

    expect(result?.jwt).toBeDefined();
    expect(repo.sessions).toHaveLength(1);
  });

  it('refuses the registrant a session when the takeover commits before the session exists', async () => {
    const { repo, service } = build(takeOver);

    await expect(register(service)).rejects.toBeInstanceOf(
      ResourceAlreadyExistsException,
    );

    expect(repo.users[0].isEmailVerified).toBe(true);
    expect(repo.sessions).toHaveLength(0);
  });
});

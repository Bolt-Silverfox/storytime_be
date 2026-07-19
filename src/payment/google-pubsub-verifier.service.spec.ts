import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GooglePubSubVerifierService } from './google-pubsub-verifier.service';

// Mock google-auth-library so no network/JWKS fetch happens. The single
// `mockVerifyIdToken` is shared by every OAuth2Client instance the service
// constructs, so each test can control the verification outcome.
const mockVerifyIdToken = jest.fn();
jest.mock('google-auth-library', () => ({
  OAuth2Client: jest.fn().mockImplementation(() => ({
    verifyIdToken: mockVerifyIdToken,
  })),
}));

const AUDIENCE = 'https://api.storytime.test/payment/webhooks/google';
const SA_EMAIL = 'pubsub-push@storytime.iam.gserviceaccount.com';

const ticketWith = (payload: Record<string, unknown> | undefined) => ({
  getPayload: () => payload,
});

/** Build the service with a given env config. */
const buildService = async (
  config: Record<string, string | undefined>,
): Promise<GooglePubSubVerifierService> => {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      GooglePubSubVerifierService,
      {
        provide: ConfigService,
        useValue: { get: (key: string) => config[key] },
      },
    ],
  }).compile();
  return module.get(GooglePubSubVerifierService);
};

describe('GooglePubSubVerifierService', () => {
  beforeEach(() => {
    mockVerifyIdToken.mockReset();
  });

  // ----------------------------------------------------- enforced posture ----
  describe('when GOOGLE_PUBSUB_AUDIENCE is configured (enforced)', () => {
    let service: GooglePubSubVerifierService;

    beforeEach(async () => {
      service = await buildService({
        GOOGLE_PUBSUB_AUDIENCE: AUDIENCE,
        GOOGLE_PUBSUB_SA_EMAIL: SA_EMAIL,
      });
    });

    it('accepts a valid token from the configured service account', async () => {
      mockVerifyIdToken.mockResolvedValue(
        ticketWith({ email: SA_EMAIL, email_verified: true }),
      );

      await expect(
        service.verifyPushRequest(`Bearer good-token`),
      ).resolves.toBeUndefined();

      expect(mockVerifyIdToken).toHaveBeenCalledWith({
        idToken: 'good-token',
        audience: AUDIENCE,
      });
    });

    it('rejects a missing Authorization header', async () => {
      await expect(service.verifyPushRequest(undefined)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(mockVerifyIdToken).not.toHaveBeenCalled();
    });

    it('rejects a header without a Bearer token', async () => {
      await expect(
        service.verifyPushRequest('Basic abc'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(mockVerifyIdToken).not.toHaveBeenCalled();
    });

    it('rejects a bad signature / invalid token (verifyIdToken throws)', async () => {
      mockVerifyIdToken.mockRejectedValue(new Error('Invalid token signature'));

      await expect(
        service.verifyPushRequest('Bearer forged'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects a wrong audience (verifyIdToken throws on aud mismatch)', async () => {
      mockVerifyIdToken.mockRejectedValue(
        new Error(`Wrong recipient, payload audience != requiredAudience`),
      );

      await expect(
        service.verifyPushRequest('Bearer wrong-aud'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects a token whose email is not the configured service account', async () => {
      mockVerifyIdToken.mockResolvedValue(
        ticketWith({ email: 'attacker@evil.com', email_verified: true }),
      );

      await expect(
        service.verifyPushRequest('Bearer wrong-email'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects a token with email_verified !== true', async () => {
      mockVerifyIdToken.mockResolvedValue(
        ticketWith({ email: SA_EMAIL, email_verified: false }),
      );

      await expect(
        service.verifyPushRequest('Bearer unverified'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects a token with no payload', async () => {
      mockVerifyIdToken.mockResolvedValue(ticketWith(undefined));

      await expect(
        service.verifyPushRequest('Bearer no-payload'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  // --------------------------------------------------- unconfigured posture --
  describe('when GOOGLE_PUBSUB_AUDIENCE is NOT configured (skip + warn)', () => {
    it('skips verification and resolves, even with no token', async () => {
      const service = await buildService({});
      const warn = jest
        .spyOn(service['logger'], 'warn')
        .mockImplementation(() => undefined);

      await expect(
        service.verifyPushRequest(undefined),
      ).resolves.toBeUndefined();

      expect(mockVerifyIdToken).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledTimes(1); // production-config warning
    });
  });

  // --------------------------------- audience set but SA email unconfigured --
  describe('when audience is set but GOOGLE_PUBSUB_SA_EMAIL is not', () => {
    it('accepts any Google-verified account for the audience (with a warning)', async () => {
      const service = await buildService({ GOOGLE_PUBSUB_AUDIENCE: AUDIENCE });
      mockVerifyIdToken.mockResolvedValue(
        ticketWith({
          email: 'anything@x.gserviceaccount.com',
          email_verified: true,
        }),
      );

      await expect(
        service.verifyPushRequest('Bearer ok'),
      ).resolves.toBeUndefined();
    });
  });
});

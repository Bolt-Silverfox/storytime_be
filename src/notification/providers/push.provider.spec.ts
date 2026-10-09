import { ConfigService } from '@nestjs/config';
import { NotificationCategory } from '@prisma/client';
import {
  FirebaseMessagingError,
  MessagingErrorCode,
} from 'firebase-admin/messaging';
import { PushProvider } from './push.provider';

/**
 * Guards the one failure mode of the firebase-admin v14 migration that nothing
 * else would catch.
 *
 * `handleFailedTokens` retires a device token by comparing `response.error.code`
 * against the string literals 'messaging/registration-token-not-registered' and
 * 'messaging/invalid-registration-token'. If a future SDK bump changed that code
 * format — dropping the `messaging/` prefix, say — nothing would throw and no
 * check would fail. Push sends would simply keep targeting dead tokens forever,
 * with successCount quietly decaying.
 *
 * So these tests build the error from the SDK's OWN enum via its public
 * constructor, rather than a hand-written `{ code: 'messaging/...' }` literal.
 * The `messaging/` prefix is applied by the SDK, not by us — a literal would
 * only test the test.
 */

const mockSendEachForMulticast = jest.fn();

jest.mock('firebase-admin/app', () => ({
  getApps: jest.fn().mockReturnValue([]),
  initializeApp: jest.fn(),
  cert: jest.fn().mockReturnValue({}),
}));

jest.mock('firebase-admin/messaging', () => {
  // Keep the REAL error class — it is the thing under test.
  const actual = jest.requireActual<typeof import('firebase-admin/messaging')>(
    'firebase-admin/messaging',
  );
  return {
    ...actual,
    getMessaging: jest.fn(() => ({
      sendEachForMulticast: mockSendEachForMulticast,
    })),
  };
});

const buildProvider = () => {
  const configService = {
    get: jest.fn(
      (key: string) =>
        ({
          FIREBASE_PROJECT_ID: 'test-project',
          FIREBASE_CLIENT_EMAIL: 'svc@test-project.iam.gserviceaccount.com',
          FIREBASE_PRIVATE_KEY: 'key',
        })[key],
    ),
  } as unknown as ConfigService;

  const deviceTokenRepository = {
    findActiveNotDeletedWithIds: jest.fn(),
    updateManyTokens: jest.fn().mockResolvedValue({ count: 1 }),
  };

  const provider = new PushProvider(
    configService as never,
    deviceTokenRepository as never,
  );
  provider.onModuleInit();
  return { provider, deviceTokenRepository };
};

const payload = {
  userId: 'user-1',
  category: NotificationCategory.NEW_LOGIN,
  title: 'Title',
  body: 'Body',
};

describe('PushProvider — failed-token handling', () => {
  beforeEach(() => jest.clearAllMocks());

  it('retires a token FCM reports as UNREGISTERED, and leaves the healthy one alone', async () => {
    const { provider, deviceTokenRepository } = buildProvider();
    deviceTokenRepository.findActiveNotDeletedWithIds.mockResolvedValue([
      { id: 'dt-live', token: 'tok-live' },
      { id: 'dt-dead', token: 'tok-dead' },
    ]);

    // Built from the SDK's enum, so this fails if the code format ever changes.
    const unregistered = new FirebaseMessagingError({
      code: MessagingErrorCode.REGISTRATION_TOKEN_NOT_REGISTERED,
      message: 'Requested entity was not found.',
    });
    expect(unregistered.code).toBe(
      'messaging/registration-token-not-registered',
    );

    mockSendEachForMulticast.mockResolvedValue({
      successCount: 1,
      failureCount: 1,
      responses: [
        { success: true, messageId: 'm1' },
        { success: false, error: unregistered },
      ],
    });

    const result = await provider.send(payload);

    expect(deviceTokenRepository.updateManyTokens).toHaveBeenCalledTimes(1);
    expect(deviceTokenRepository.updateManyTokens).toHaveBeenCalledWith(
      { id: { in: ['dt-dead'] } },
      { isActive: false },
    );
    // One device still got it, so the send is not a failure.
    expect(result.success).toBe(true);
  });

  it('does NOT retire a token for a transient server error', async () => {
    const { provider, deviceTokenRepository } = buildProvider();
    deviceTokenRepository.findActiveNotDeletedWithIds.mockResolvedValue([
      { id: 'dt-1', token: 'tok-1' },
    ]);

    // A real transient error — retiring on this would silently deactivate a
    // healthy device for what is only an FCM hiccup.
    const transient = new FirebaseMessagingError({
      code: MessagingErrorCode.SERVER_UNAVAILABLE,
      message: 'The service is currently unavailable.',
    });

    mockSendEachForMulticast.mockResolvedValue({
      successCount: 0,
      failureCount: 1,
      responses: [{ success: false, error: transient }],
    });

    const result = await provider.send(payload);

    expect(deviceTokenRepository.updateManyTokens).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
  });
});

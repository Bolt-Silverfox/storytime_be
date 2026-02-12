import { Test, TestingModule } from '@nestjs/testing';
import { NotificationPreferenceEventListener } from './notification-preference-event.listener';
import { NotificationPreferenceService } from '../services/notification-preference.service';
import { AppEvents, UserRegisteredEvent } from '@/shared/events';

describe('NotificationPreferenceEventListener', () => {
  let listener: NotificationPreferenceEventListener;
  let service: NotificationPreferenceService;

  const mockNotificationPreferenceService = {
    seedDefaultPreferences: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationPreferenceEventListener,
        {
          provide: NotificationPreferenceService,
          useValue: mockNotificationPreferenceService,
        },
      ],
    }).compile();

    listener = module.get<NotificationPreferenceEventListener>(
      NotificationPreferenceEventListener,
    );
    service = module.get<NotificationPreferenceService>(
      NotificationPreferenceService,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(listener).toBeDefined();
  });

  describe('handleUserRegistered', () => {
    it('should call seedDefaultPreferences with the userId from the payload', async () => {
      const payload: UserRegisteredEvent = {
        userId: 'user-123',
        email: 'test@example.com',
        name: 'Test User',
        role: 'parent',
        registeredAt: new Date(),
      };

      await listener.handleUserRegistered(payload);

      expect(service.seedDefaultPreferences).toHaveBeenCalledWith('user-123');
      expect(service.seedDefaultPreferences).toHaveBeenCalledTimes(1);
    });

    it('should log an error if seedDefaultPreferences fails', async () => {
      const payload: UserRegisteredEvent = {
        userId: 'user-123',
        email: 'test@example.com',
        name: 'Test User',
        role: 'parent',
        registeredAt: new Date(),
      };

      const error = new Error('Seeding failed');
      mockNotificationPreferenceService.seedDefaultPreferences.mockRejectedValueOnce(
        error,
      );

      const loggerSpy = jest.spyOn((listener as any).logger, 'error');

      await listener.handleUserRegistered(payload);

      expect(service.seedDefaultPreferences).toHaveBeenCalledWith('user-123');
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          'Failed to seed notification preferences for user user-123: Seeding failed',
        ),
      );
    });
  });
});

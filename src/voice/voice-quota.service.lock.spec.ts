import { VoiceQuotaService } from './voice-quota.service';
import type {
  IParagraphAudioCacheRepository,
  IUserUsageRepository,
  IVoiceRepository,
  IVoiceUserRepository,
} from './repositories';
import type { SubscriptionService } from '../subscription/subscription.service';
import type { VoiceUsageService } from './services/voice-usage.service';
import type { VoiceIdResolverService } from './services/voice-id-resolver.service';

describe('VoiceQuotaService when the voice is deleted before the free-tier lock is written', () => {
  const USER_ID = 'user-1';
  const VOICE_UUID = 'voice-uuid';
  const ELEVEN_LABS_ID = 'eleven-labs-id';
  const unlockedUsage = {
    selectedSecondVoiceId: null,
    elevenLabsTrialStoryId: null,
  };
  const usageRepository = {
    upsertEnsureExists: jest.fn().mockResolvedValue(unlockedUsage),
    lockSecondVoiceIfNull: jest.fn().mockResolvedValue({ count: 0 }),
    lockTrialStoryIfNull: jest.fn(),
    findByUserId: jest.fn().mockResolvedValue(unlockedUsage),
    findSelectedSecondVoiceId: jest
      .fn()
      .mockResolvedValue({ selectedSecondVoiceId: null }),
  };
  const resolver = {
    resolveCanonicalVoiceId: jest.fn().mockResolvedValue(ELEVEN_LABS_ID),
    resolveVoiceUuid: jest.fn().mockResolvedValue(VOICE_UUID),
  };
  const service = new VoiceQuotaService(
    {} as IVoiceRepository,
    usageRepository as unknown as IUserUsageRepository,
    {} as IVoiceUserRepository,
    {} as IParagraphAudioCacheRepository,
    {} as SubscriptionService,
    { getCurrentMonth: () => '2026-11' } as unknown as VoiceUsageService,
    resolver as unknown as VoiceIdResolverService,
  );

  it('denies ElevenLabs for the voice and claims no trial story', async () => {
    expect(
      await service.canFreeUserUseElevenLabs(
        USER_ID,
        ELEVEN_LABS_ID,
        'story-1',
      ),
    ).toBe(false);
    expect(usageRepository.lockSecondVoiceIfNull).toHaveBeenCalledWith(
      USER_ID,
      VOICE_UUID,
    );
    expect(usageRepository.lockTrialStoryIfNull).not.toHaveBeenCalled();
  });

  it('reports the voice as not locked when a preferred voice is being set', async () => {
    expect(await service.lockFreeUserVoice(USER_ID, VOICE_UUID)).toBe(false);
    expect(usageRepository.lockSecondVoiceIfNull).toHaveBeenCalledWith(
      USER_ID,
      VOICE_UUID,
    );
  });
});

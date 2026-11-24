import { NotFoundException } from '@nestjs/common';
import { VoicePreferenceService } from './voice-preference.service';
import { VoiceResponseMapper } from './voice-response.mapper';
import type { IVoiceRepository, IVoiceUserRepository } from '../repositories';

describe('VoicePreferenceService.setPreferredVoice', () => {
  const voice = {
    id: 'voice-1',
    userId: 'user-1',
    name: 'Dad',
    type: 'uploaded',
    url: 'https://cdn/v.mp3',
    elevenLabsVoiceId: 'clone-1',
    voiceAvatar: null,
    isDeleted: false,
  };
  const voiceRepository = { findFirstByIdNotDeleted: jest.fn() };
  const userRepository = { updatePreferredVoiceWithInclude: jest.fn() };
  const service = new VoicePreferenceService(
    voiceRepository as unknown as IVoiceRepository,
    userRepository as unknown as IVoiceUserRepository,
    new VoiceResponseMapper(),
  );

  beforeEach(() => {
    voiceRepository.findFirstByIdNotDeleted.mockResolvedValue(voice);
  });

  it('returns the voice it stored as the preference', async () => {
    userRepository.updatePreferredVoiceWithInclude.mockResolvedValue({
      id: 'user-1',
      preferredVoice: voice,
    });

    const result = await service.setPreferredVoice('user-1', {
      voiceId: 'voice-1',
    });

    expect(result.id).toBe('voice-1');
    expect(userRepository.updatePreferredVoiceWithInclude).toHaveBeenCalledWith(
      'user-1',
      'voice-1',
    );
  });

  it('answers not found when the voice was deleted before the preference was written', async () => {
    userRepository.updatePreferredVoiceWithInclude.mockResolvedValue(null);

    await expect(
      service.setPreferredVoice('user-1', { voiceId: 'voice-1' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

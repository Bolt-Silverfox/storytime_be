import { VoiceType } from './dto/voice.dto';
import { VOICE_AVATARS, VOICE_CONFIG, VOICE_PREVIEWS } from './voice.constants';

describe('Voice constants', () => {
  const allVoiceTypes = Object.values(VoiceType);

  it('should have a VOICE_CONFIG entry for every VoiceType', () => {
    for (const voice of allVoiceTypes) {
      expect(VOICE_CONFIG[voice]).toBeDefined();
    }
  });

  it('should have a VOICE_AVATARS entry for every VoiceType', () => {
    for (const voice of allVoiceTypes) {
      expect(VOICE_AVATARS[voice]).toBeDefined();
    }
  });

  it('should have a VOICE_PREVIEWS entry for every VoiceType', () => {
    for (const voice of allVoiceTypes) {
      expect(VOICE_PREVIEWS[voice]).toBeDefined();
    }
  });

  it('should use unique Edge TTS voices across all entries', () => {
    const edgeVoices = Object.values(VOICE_CONFIG).map(
      (config) => config.edgeTtsVoice,
    );
    expect(new Set(edgeVoices).size).toBe(edgeVoices.length);
  });

  it('should use unique ElevenLabs IDs across all entries', () => {
    const elevenLabsIds = Object.values(VOICE_CONFIG).map(
      (config) => config.elevenLabsId,
    );
    expect(new Set(elevenLabsIds).size).toBe(elevenLabsIds.length);
  });
});

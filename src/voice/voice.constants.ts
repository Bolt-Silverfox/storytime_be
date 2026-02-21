import { VoiceType } from './dto/voice.dto';

export const DEFAULT_VOICE = VoiceType.CHARLIE;

export const VOICE_AVATARS = {
  [VoiceType.CHARLIE]:
    'https://res.cloudinary.com/billmal/image/upload/v1768772687/storytime/voice_avatars/milo.png',
  [VoiceType.JESSICA]:
    'https://res.cloudinary.com/billmal/image/upload/v1768772688/storytime/voice_avatars/bella.png',
  [VoiceType.WILL]:
    'https://res.cloudinary.com/billmal/image/upload/v1768772689/storytime/voice_avatars/cosmo.png',
  [VoiceType.LILY]:
    'https://res.cloudinary.com/billmal/image/upload/v1768772690/storytime/voice_avatars/nimbus.png',
  [VoiceType.BILL]:
    'https://res.cloudinary.com/billmal/image/upload/v1768772691/storytime/voice_avatars/grandpa_jo.png',
  [VoiceType.LAURA]:
    'https://res.cloudinary.com/billmal/image/upload/v1768772693/storytime/voice_avatars/chip.png',
};

export const VOICE_PREVIEWS = {
  [VoiceType.CHARLIE]:
    'https://storage.googleapis.com/eleven-public-prod/premade/voices/IKne3meq5aSn9XLyUdCD/102de6f2-22ed-43e0-a1f1-111fa75c5481.mp3',
  [VoiceType.JESSICA]:
    'https://storage.googleapis.com/eleven-public-prod/premade/voices/cgSgspJ2msm6clMCkdW9/56a97bf8-b69b-448f-846c-c3a11683d45a.mp3',
  [VoiceType.WILL]:
    'https://storage.googleapis.com/eleven-public-prod/premade/voices/bIHbv24MWmeRgasZH58o/8caf8f3d-ad29-4980-af41-53f20c72d7a4.mp3',
  [VoiceType.LILY]:
    'https://storage.googleapis.com/eleven-public-prod/premade/voices/pFZP5JQG7iQjIQuC4Bku/89b68b35-b3dd-4348-a84a-a3c13a3c2b30.mp3',
  [VoiceType.BILL]:
    'https://storage.googleapis.com/eleven-public-prod/premade/voices/pqHfZKP75CvOlQylNhV4/d782b3ff-84ba-4029-848c-acf01285524d.mp3',
  [VoiceType.LAURA]:
    'https://storage.googleapis.com/eleven-public-prod/premade/voices/FGY2WhTYpPnrIDTdsKH5/67341759-ad08-41a5-be6e-de12fe448618.mp3',
};

/** Per-voice ElevenLabs settings tuned for natural storytelling */
export interface VoiceSettings {
  stability: number;
  similarity_boost: number;
  style: number;
  use_speaker_boost: boolean;
}

export const VOICE_CONFIG = {
  [VoiceType.CHARLIE]: {
    id: VoiceType.CHARLIE,
    name: 'Charlie',
    googleCloudVoice: 'en-US-Neural2-D',
    gender: 'Male',
    elevenLabsId: 'IKne3meq5aSn9XLyUdCD',
    previewUrl: VOICE_PREVIEWS[VoiceType.CHARLIE],
    voiceAvatar: VOICE_AVATARS[VoiceType.CHARLIE],
    // Charlie: warm, friendly male - needs more expressiveness for storytelling
    voiceSettings: {
      stability: 0.3,
      similarity_boost: 0.85,
      style: 0.65,
      use_speaker_boost: true,
    } as VoiceSettings,
  },
  [VoiceType.JESSICA]: {
    id: VoiceType.JESSICA,
    name: 'Jessica',
    googleCloudVoice: 'en-US-Neural2-F',
    gender: 'Female',
    elevenLabsId: 'cgSgspJ2msm6clMCkdW9',
    previewUrl: VOICE_PREVIEWS[VoiceType.JESSICA],
    voiceAvatar: VOICE_AVATARS[VoiceType.JESSICA],
    // Jessica: young, energetic female - balance expressiveness with clarity
    voiceSettings: {
      stability: 0.35,
      similarity_boost: 0.8,
      style: 0.6,
      use_speaker_boost: true,
    } as VoiceSettings,
  },
  [VoiceType.WILL]: {
    id: VoiceType.WILL,
    name: 'Will',
    googleCloudVoice: 'en-US-Neural2-J',
    gender: 'Male',
    elevenLabsId: 'bIHbv24MWmeRgasZH58o',
    previewUrl: VOICE_PREVIEWS[VoiceType.WILL],
    voiceAvatar: VOICE_AVATARS[VoiceType.WILL],
    // Will: young male - more dynamic for engaging storytelling
    voiceSettings: {
      stability: 0.3,
      similarity_boost: 0.85,
      style: 0.7,
      use_speaker_boost: true,
    } as VoiceSettings,
  },
  [VoiceType.LILY]: {
    id: VoiceType.LILY,
    name: 'Lily',
    googleCloudVoice: 'en-US-Neural2-C',
    gender: 'Female',
    elevenLabsId: 'pFZP5JQG7iQjIQuC4Bku',
    previewUrl: VOICE_PREVIEWS[VoiceType.LILY],
    voiceAvatar: VOICE_AVATARS[VoiceType.LILY],
    // Lily: narrative female - already reads naturally, optimized for storytelling
    voiceSettings: {
      stability: 0.35,
      similarity_boost: 0.8,
      style: 0.55,
      use_speaker_boost: true,
    } as VoiceSettings,
  },
  [VoiceType.BILL]: {
    id: VoiceType.BILL,
    name: 'Bill',
    googleCloudVoice: 'en-US-Neural2-A',
    gender: 'Male',
    elevenLabsId: 'pqHfZKP75CvOlQylNhV4',
    previewUrl: VOICE_PREVIEWS[VoiceType.BILL],
    voiceAvatar: VOICE_AVATARS[VoiceType.BILL],
    // Bill: older, grandfatherly male - warm and expressive for bedtime stories
    voiceSettings: {
      stability: 0.4,
      similarity_boost: 0.75,
      style: 0.5,
      use_speaker_boost: true,
    } as VoiceSettings,
  },
  [VoiceType.LAURA]: {
    id: VoiceType.LAURA,
    name: 'Laura',
    googleCloudVoice: 'en-US-Neural2-E',
    gender: 'Female',
    elevenLabsId: 'FGY2WhTYpPnrIDTdsKH5',
    previewUrl: VOICE_PREVIEWS[VoiceType.LAURA],
    voiceAvatar: VOICE_AVATARS[VoiceType.LAURA],
    // Laura: mature female - expressive with good pacing for narration
    voiceSettings: {
      stability: 0.35,
      similarity_boost: 0.8,
      style: 0.6,
      use_speaker_boost: true,
    } as VoiceSettings,
  },
};

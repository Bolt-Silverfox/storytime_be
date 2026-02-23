import { VoiceType } from './dto/voice.dto';

export const DEFAULT_VOICE = VoiceType.LILY;

export const VOICE_AVATARS: Record<VoiceType, string> = {
  [VoiceType.CHARLIE]:
    'https://res.cloudinary.com/billmal/image/upload/v1768772687/storytime/voice_avatars/milo.png',
  [VoiceType.JESSICA]:
    'https://res.cloudinary.com/billmal/image/upload/v1768772688/storytime/voice_avatars/bella.png',
  [VoiceType.WILL]:
    'https://res.cloudinary.com/billmal/image/upload/v1768772689/storytime/voice_avatars/cosmo.png',
  [VoiceType.LILY]:
    'https://res.cloudinary.com/billmal/image/upload/v1768772690/storytime/voice_avatars/nimbus.png',
  [VoiceType.BILL]:
    'https://res.cloudinary.com/billmal/image/upload/v1771776487/storytime/voice_avatars/fanice.png',
  [VoiceType.LAURA]:
    'https://res.cloudinary.com/billmal/image/upload/v1768772693/storytime/voice_avatars/chip.png',
  [VoiceType.ROSIE]:
    'https://res.cloudinary.com/billmal/image/upload/v1771776416/storytime/voice_avatars/rosie.png',
  [VoiceType.PIXIE]:
    'https://res.cloudinary.com/billmal/image/upload/v1771776416/storytime/voice_avatars/pixie.png',
};

export const VOICE_PREVIEWS: Record<VoiceType, string> = {
  [VoiceType.CHARLIE]:
    'https://storage.googleapis.com/eleven-public-prod/premade/voices/NFG5qt843uXKj4pFvR7C/preview.mp3',
  [VoiceType.JESSICA]:
    'https://storage.googleapis.com/eleven-public-prod/premade/voices/wJqPPQ618aTW29mptyoc/preview.mp3',
  [VoiceType.WILL]:
    'https://storage.googleapis.com/eleven-public-prod/premade/voices/EiNlNiXeDU1pqqOPrYMO/preview.mp3',
  [VoiceType.LILY]:
    'https://storage.googleapis.com/eleven-public-prod/premade/voices/XrExE9yKIg1WjnnlVkGX/preview.mp3',
  [VoiceType.BILL]:
    'https://storage.googleapis.com/eleven-public-prod/premade/voices/iCrDUkL56s3C8sCRl7wb/preview.mp3',
  [VoiceType.LAURA]:
    'https://storage.googleapis.com/eleven-public-prod/premade/voices/N2lVS1w4EtoT3dr4eOWO/preview.mp3',
  [VoiceType.ROSIE]:
    'https://storage.googleapis.com/eleven-public-prod/premade/voices/ThT5KcBeYPX3keUQqHPh/981f0855-6598-48d2-9f8f-b6d92fbbe3fc.mp3',
  [VoiceType.PIXIE]:
    'https://storage.googleapis.com/eleven-public-prod/premade/voices/jBpfuIE2acCO8z3wKNLl/3a7e4339-78fa-404e-8d10-c3ef5587935b.mp3',
};

/** Per-voice ElevenLabs settings tuned for natural storytelling */
export interface VoiceSettings {
  stability: number;
  similarity_boost: number;
  style: number;
  use_speaker_boost: boolean;
}

export interface VoiceConfigEntry {
  id: VoiceType;
  name: string;
  edgeTtsVoice: string;
  styleTts2Voice: string;
  gender: string;
  elevenLabsId: string;
  previewUrl: string;
  voiceAvatar: string;
  voiceSettings: VoiceSettings;
}

/**
 * VoiceType enum keys (CHARLIE, JESSICA, etc.) are stable internal identifiers
 * used in the database and API. The `name` field is the user-facing display name
 * shown in the mobile app (Milo, Bella, etc.). Keep these decoupled — update
 * `name` for UI changes without touching enum keys or stored references.
 * When adding new voices, add the enum in dto/voice.dto.ts, then add entries
 * here in VOICE_AVATARS, VOICE_PREVIEWS, and VOICE_CONFIG.
 */
export const VOICE_CONFIG: Record<VoiceType, VoiceConfigEntry> = {
  [VoiceType.CHARLIE]: {
    id: VoiceType.CHARLIE,
    name: 'Milo',
    edgeTtsVoice: 'en-GB-RyanNeural',
    styleTts2Voice: 'Richard_Male_EN_US',
    gender: 'Male',
    elevenLabsId: 'NFG5qt843uXKj4pFvR7C',
    previewUrl: VOICE_PREVIEWS[VoiceType.CHARLIE],
    voiceAvatar: VOICE_AVATARS[VoiceType.CHARLIE],
    // Milo (Adam Stone voice): laid-back British male - expressive storytelling
    voiceSettings: {
      stability: 0.35,
      similarity_boost: 0.8,
      style: 0.55,
      use_speaker_boost: true,
    },
  },
  [VoiceType.JESSICA]: {
    id: VoiceType.JESSICA,
    name: 'Bella',
    edgeTtsVoice: 'en-US-JennyMultilingualNeural',
    styleTts2Voice: 'Sol_Female_EN_US',
    gender: 'Female',
    elevenLabsId: 'wJqPPQ618aTW29mptyoc',
    previewUrl: VOICE_PREVIEWS[VoiceType.JESSICA],
    voiceAvatar: VOICE_AVATARS[VoiceType.JESSICA],
    // Bella (Ana Rita voice): smooth, expressive female - engaging storytelling
    voiceSettings: {
      stability: 0.3,
      similarity_boost: 0.85,
      style: 0.65,
      use_speaker_boost: true,
    },
  },
  [VoiceType.WILL]: {
    id: VoiceType.WILL,
    name: 'Cosmo',
    edgeTtsVoice: 'en-US-GuyNeural',
    styleTts2Voice: 'Jack_Male_EN_US',
    gender: 'Male',
    elevenLabsId: 'EiNlNiXeDU1pqqOPrYMO',
    previewUrl: VOICE_PREVIEWS[VoiceType.WILL],
    voiceAvatar: VOICE_AVATARS[VoiceType.WILL],
    // Cosmo (John Doe voice): deep, intimate male - immersive storytelling
    voiceSettings: {
      stability: 0.4,
      similarity_boost: 0.8,
      style: 0.5,
      use_speaker_boost: true,
    },
  },
  [VoiceType.LILY]: {
    id: VoiceType.LILY,
    name: 'Nimbus',
    edgeTtsVoice: 'en-US-AvaMultilingualNeural',
    styleTts2Voice: 'Nelly_Female_EN_US',
    gender: 'Female',
    elevenLabsId: 'XrExE9yKIg1WjnnlVkGX',
    previewUrl: VOICE_PREVIEWS[VoiceType.LILY],
    voiceAvatar: VOICE_AVATARS[VoiceType.LILY],
    // Nimbus (Matilda voice): warm audiobook narrator - best default for storytelling
    voiceSettings: {
      stability: 0.35,
      similarity_boost: 0.8,
      style: 0.6,
      use_speaker_boost: true,
    },
  },
  [VoiceType.BILL]: {
    id: VoiceType.BILL,
    name: 'Fanice',
    edgeTtsVoice: 'en-US-SaraNeural',
    styleTts2Voice: 'Lisa_Female_EN_US',
    gender: 'Female',
    elevenLabsId: 'iCrDUkL56s3C8sCRl7wb',
    previewUrl: VOICE_PREVIEWS[VoiceType.BILL],
    voiceAvatar: VOICE_AVATARS[VoiceType.BILL],
    // Fanice (Hope voice): soothing female narrator - calming bedtime stories
    voiceSettings: {
      stability: 0.45,
      similarity_boost: 0.75,
      style: 0.45,
      use_speaker_boost: true,
    },
  },
  [VoiceType.LAURA]: {
    id: VoiceType.LAURA,
    name: 'Chip',
    edgeTtsVoice: 'en-US-AndrewMultilingualNeural',
    styleTts2Voice: 'Samuel_Male_EN_US',
    gender: 'Male',
    elevenLabsId: 'N2lVS1w4EtoT3dr4eOWO',
    previewUrl: VOICE_PREVIEWS[VoiceType.LAURA],
    voiceAvatar: VOICE_AVATARS[VoiceType.LAURA],
    // Chip (Callum voice): gentle male storyteller - warm and engaging
    voiceSettings: {
      stability: 0.4,
      similarity_boost: 0.8,
      style: 0.5,
      use_speaker_boost: true,
    },
  },
  [VoiceType.ROSIE]: {
    id: VoiceType.ROSIE,
    name: 'Rosie',
    edgeTtsVoice: 'en-US-AnaNeural',
    styleTts2Voice: 'Georgia_Female_EN_US',
    gender: 'Female',
    elevenLabsId: 'ThT5KcBeYPX3keUQqHPh',
    previewUrl: VOICE_PREVIEWS[VoiceType.ROSIE],
    voiceAvatar: VOICE_AVATARS[VoiceType.ROSIE],
    // Rosie: young child voice - calmer for storytelling
    voiceSettings: {
      stability: 0.45,
      similarity_boost: 0.75,
      style: 0.4,
      use_speaker_boost: true,
    },
  },
  [VoiceType.PIXIE]: {
    id: VoiceType.PIXIE,
    name: 'Pixie',
    edgeTtsVoice: 'en-US-JennyNeural',
    styleTts2Voice: 'Marry_Female_EN_US',
    gender: 'Female',
    elevenLabsId: 'jBpfuIE2acCO8z3wKNLl',
    previewUrl: VOICE_PREVIEWS[VoiceType.PIXIE],
    voiceAvatar: VOICE_AVATARS[VoiceType.PIXIE],
    // Pixie: animated childish voice - more expressive
    voiceSettings: {
      stability: 0.3,
      similarity_boost: 0.85,
      style: 0.7,
      use_speaker_boost: true,
    },
  },
};

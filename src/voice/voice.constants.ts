import { VoiceType } from './dto/voice.dto';

export const DEFAULT_VOICE = VoiceType.NIMBUS;

/**
 * The current Nimbus voice is the one that used to be called LILY (the
 * 896ac37 rename of LILY -> NIMBUS changed no voice settings). Cached audio
 * stored under the legacy 'LILY' alias or the 'default' placeholder is only
 * that voice from when each PROVIDER started producing it (commit author
 * instants, UTC):
 *  - elevenlabs: 360506b swapped LILY's ElevenLabs id to XrExE9yKIg1WjnnlVkGX
 *    (before that it was pFZP5JQG7iQjIQuC4Bku). 'unknown' (pre-provider-
 *    tracking) rows take the same, strictest, instant.
 *  - edgetts: en-US-AvaMultilingualNeural has been LILY's since 0ea184a.
 *  - deepgram: aura-2-hera-en since 3080ad5 (Deepgram was reintroduced there).
 * The 'default' placeholder additionally meant CHARLIE until 7fc2139 made LILY
 * the default.
 */
export const NIMBUS_VOICE_CURRENT_SINCE: Record<string, Date> = {
  elevenlabs: new Date('2026-02-23T22:35:22Z'),
  edgetts: new Date('2026-02-21T18:52:17Z'),
  deepgram: new Date('2026-02-24T22:27:04Z'),
  unknown: new Date('2026-02-23T22:35:22Z'),
};
/** 7fc2139: DEFAULT_VOICE changed from CHARLIE to LILY (today's NIMBUS). */
export const DEFAULT_PLACEHOLDER_IS_NIMBUS_SINCE = new Date(
  '2026-02-22T16:13:26Z',
);

/**
 * Earliest instant a row stored under a legacy default alias is really the
 * current Nimbus voice for its provider. `isPlaceholder` is true for the
 * 'default' alias, false for legacy voice names such as 'LILY'.
 */
export const legacyDefaultAliasCutoff = (
  provider: string,
  isPlaceholder: boolean,
): Date => {
  const providerSince =
    NIMBUS_VOICE_CURRENT_SINCE[provider] ?? NIMBUS_VOICE_CURRENT_SINCE.unknown;
  return isPlaceholder &&
    DEFAULT_PLACEHOLDER_IS_NIMBUS_SINCE.getTime() > providerSince.getTime()
    ? DEFAULT_PLACEHOLDER_IS_NIMBUS_SINCE
    : providerSince;
};

export const VOICE_AVATARS: Record<VoiceType, string> = {
  [VoiceType.MILO]:
    'https://res.cloudinary.com/billmal/image/upload/v1768772687/storytime/voice_avatars/milo.png',
  [VoiceType.BELLA]:
    'https://res.cloudinary.com/billmal/image/upload/v1768772688/storytime/voice_avatars/bella.png',
  [VoiceType.COSMO]:
    'https://res.cloudinary.com/billmal/image/upload/v1768772689/storytime/voice_avatars/cosmo.png',
  [VoiceType.NIMBUS]:
    'https://res.cloudinary.com/billmal/image/upload/v1768772690/storytime/voice_avatars/nimbus.png',
  [VoiceType.FANICE]:
    'https://res.cloudinary.com/billmal/image/upload/v1768772693/storytime/voice_avatars/chip.png',
  [VoiceType.CHIP]:
    'https://res.cloudinary.com/billmal/image/upload/v1771776487/storytime/voice_avatars/fanice.png',
  [VoiceType.ROSIE]:
    'https://res.cloudinary.com/billmal/image/upload/v1771776416/storytime/voice_avatars/rosie.png',
  [VoiceType.PIXIE]:
    'https://res.cloudinary.com/billmal/image/upload/v1771776416/storytime/voice_avatars/pixie.png',
};

export const VOICE_PREVIEWS: Record<VoiceType, string> = {
  [VoiceType.MILO]:
    'https://storage.googleapis.com/eleven-public-prod/custom/voices/NFG5qt843uXKj4pFvR7C/BgPFcmyMBm88O9O05Myn.mp3',
  [VoiceType.BELLA]:
    'https://storage.googleapis.com/eleven-public-prod/JSdwiNguB8ejxX5k1f64Z6aLdP73/voices/wJqPPQ618aTW29mptyoc/7f5d3985-6999-49c4-8c53-e0f43ef5a334.mp3',
  [VoiceType.COSMO]:
    'https://storage.googleapis.com/eleven-public-prod/database/user/8RYUsFHsalUXjwVG0LjhNwH1j022/voices/EiNlNiXeDU1pqqOPrYMO/DyICRR04KQnCeB7Y9B7K.mp3',
  [VoiceType.NIMBUS]:
    'https://res.cloudinary.com/billmal/video/upload/v1771892834/storytime/voice_previews/matilda_preview.mp3',
  [VoiceType.FANICE]:
    'https://storage.googleapis.com/eleven-public-prod/database/user/sD92HnMHS9WZLXKNTKxmnC8XmJ32/voices/iCrDUkL56s3C8sCRl7wb/CYu7JBN3ynOLysW29clt.mp3',
  [VoiceType.CHIP]:
    'https://res.cloudinary.com/billmal/video/upload/v1771892837/storytime/voice_previews/callum_preview.mp3',
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
  deepgramVoice: string;
  gender: string;
  elevenLabsId: string;
  previewUrl: string;
  voiceAvatar: string;
  voiceSettings: VoiceSettings;
}

/**
 * VoiceType enum keys (MILO, BELLA, etc.) are stable internal identifiers
 * used in the database and API. The `name` field is the user-facing display name
 * shown in the mobile app (Milo, Bella, etc.). Keep these decoupled — update
 * `name` for UI changes without touching enum keys or stored references.
 * When adding new voices, add the enum in dto/voice.dto.ts, then add entries
 * here in VOICE_AVATARS, VOICE_PREVIEWS, and VOICE_CONFIG.
 */

/** Build a VoiceConfigEntry, auto-wiring id/previewUrl/voiceAvatar from the type. */
function buildVoiceConfig(
  type: VoiceType,
  overrides: Omit<VoiceConfigEntry, 'id' | 'previewUrl' | 'voiceAvatar'>,
): VoiceConfigEntry {
  return {
    id: type,
    previewUrl: VOICE_PREVIEWS[type],
    voiceAvatar: VOICE_AVATARS[type],
    ...overrides,
  };
}

export const VOICE_CONFIG: Record<VoiceType, VoiceConfigEntry> = {
  // Milo (Adam Stone voice): laid-back British male - expressive storytelling
  [VoiceType.MILO]: buildVoiceConfig(VoiceType.MILO, {
    name: 'Milo',
    edgeTtsVoice: 'en-GB-RyanNeural',
    deepgramVoice: 'aura-2-draco-en',
    gender: 'Male',
    elevenLabsId: 'NFG5qt843uXKj4pFvR7C',
    voiceSettings: {
      stability: 0.35,
      similarity_boost: 0.8,
      style: 0.55,
      use_speaker_boost: true,
    },
  }),
  // Bella (Ana Rita voice): smooth, expressive female - engaging storytelling
  [VoiceType.BELLA]: buildVoiceConfig(VoiceType.BELLA, {
    name: 'Bella',
    edgeTtsVoice: 'en-US-JennyMultilingualNeural',
    deepgramVoice: 'aura-2-andromeda-en',
    gender: 'Female',
    elevenLabsId: 'wJqPPQ618aTW29mptyoc',
    voiceSettings: {
      stability: 0.3,
      similarity_boost: 0.85,
      style: 0.65,
      use_speaker_boost: true,
    },
  }),
  // Cosmo (John Doe voice): deep, intimate male - immersive storytelling
  [VoiceType.COSMO]: buildVoiceConfig(VoiceType.COSMO, {
    name: 'Cosmo',
    edgeTtsVoice: 'en-US-GuyNeural',
    deepgramVoice: 'aura-2-zeus-en',
    gender: 'Male',
    elevenLabsId: 'EiNlNiXeDU1pqqOPrYMO',
    voiceSettings: {
      stability: 0.4,
      similarity_boost: 0.8,
      style: 0.5,
      use_speaker_boost: true,
    },
  }),
  // Nimbus (Matilda voice): warm audiobook narrator - best default for storytelling
  [VoiceType.NIMBUS]: buildVoiceConfig(VoiceType.NIMBUS, {
    name: 'Nimbus',
    edgeTtsVoice: 'en-US-AvaMultilingualNeural',
    deepgramVoice: 'aura-2-hera-en',
    gender: 'Female',
    elevenLabsId: 'XrExE9yKIg1WjnnlVkGX',
    voiceSettings: {
      stability: 0.35,
      similarity_boost: 0.8,
      style: 0.6,
      use_speaker_boost: true,
    },
  }),
  // Fanice (Hope voice): soothing female narrator - calming bedtime stories
  [VoiceType.FANICE]: buildVoiceConfig(VoiceType.FANICE, {
    name: 'Fanice',
    edgeTtsVoice: 'en-US-SaraNeural',
    deepgramVoice: 'aura-2-harmonia-en',
    gender: 'Female',
    elevenLabsId: 'iCrDUkL56s3C8sCRl7wb',
    voiceSettings: {
      stability: 0.45,
      similarity_boost: 0.75,
      style: 0.45,
      use_speaker_boost: true,
    },
  }),
  // Chip (Callum voice): gentle male storyteller - warm and engaging
  [VoiceType.CHIP]: buildVoiceConfig(VoiceType.CHIP, {
    name: 'Chip',
    edgeTtsVoice: 'en-US-AndrewMultilingualNeural',
    deepgramVoice: 'aura-2-orion-en',
    gender: 'Male',
    elevenLabsId: 'N2lVS1w4EtoT3dr4eOWO',
    voiceSettings: {
      stability: 0.4,
      similarity_boost: 0.8,
      style: 0.5,
      use_speaker_boost: true,
    },
  }),
  // Rosie: young child voice - calmer for storytelling
  [VoiceType.ROSIE]: buildVoiceConfig(VoiceType.ROSIE, {
    name: 'Rosie',
    edgeTtsVoice: 'en-US-AnaNeural',
    deepgramVoice: 'aura-2-iris-en',
    gender: 'Female',
    elevenLabsId: 'ThT5KcBeYPX3keUQqHPh',
    voiceSettings: {
      stability: 0.45,
      similarity_boost: 0.75,
      style: 0.4,
      use_speaker_boost: true,
    },
  }),
  // Pixie: animated childish voice - more expressive
  [VoiceType.PIXIE]: buildVoiceConfig(VoiceType.PIXIE, {
    name: 'Pixie',
    edgeTtsVoice: 'en-US-JennyNeural',
    deepgramVoice: 'aura-2-aurora-en',
    gender: 'Female',
    elevenLabsId: 'jBpfuIE2acCO8z3wKNLl',
    voiceSettings: {
      stability: 0.3,
      similarity_boost: 0.85,
      style: 0.7,
      use_speaker_boost: true,
    },
  }),
};

/** Reverse lookup: elevenLabsId → VoiceType key (built once at module load). */
export const ELEVEN_LABS_TO_VOICE_TYPE = new Map<string, VoiceType>(
  (Object.entries(VOICE_CONFIG) as [VoiceType, VoiceConfigEntry][]).map(
    ([key, config]) => [config.elevenLabsId, key],
  ),
);

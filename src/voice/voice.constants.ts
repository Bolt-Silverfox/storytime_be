import { VoiceType } from './dto/voice.dto';

export const DEFAULT_VOICE = VoiceType.CHARLIE;

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
    'https://res.cloudinary.com/billmal/image/upload/v1768772691/storytime/voice_avatars/grandpa_jo.png',
  [VoiceType.LAURA]:
    'https://res.cloudinary.com/billmal/image/upload/v1768772693/storytime/voice_avatars/chip.png',
  // TODO: Replace placeholder avatar URLs with actual assets from design
  [VoiceType.ROSIE]:
    'https://res.cloudinary.com/billmal/image/upload/v1768772694/storytime/voice_avatars/rosie.png',
  [VoiceType.PIXIE]:
    'https://res.cloudinary.com/billmal/image/upload/v1768772695/storytime/voice_avatars/pixie.png',
};

export const VOICE_PREVIEWS: Record<VoiceType, string> = {
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

export const VOICE_CONFIG: Record<VoiceType, VoiceConfigEntry> = {
  [VoiceType.CHARLIE]: {
    id: VoiceType.CHARLIE,
    name: 'Charlie',
    edgeTtsVoice: 'en-US-AndrewMultilingualNeural',
    styleTts2Voice: 'Richard_Male_EN_US',
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
    },
  },
  [VoiceType.JESSICA]: {
    id: VoiceType.JESSICA,
    name: 'Jessica',
    edgeTtsVoice: 'en-US-EmmaMultilingualNeural',
    styleTts2Voice: 'Sol_Female_EN_US',
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
    },
  },
  [VoiceType.WILL]: {
    id: VoiceType.WILL,
    name: 'Will',
    edgeTtsVoice: 'en-US-BrianMultilingualNeural',
    styleTts2Voice: 'Jack_Male_EN_US',
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
    },
  },
  [VoiceType.LILY]: {
    id: VoiceType.LILY,
    name: 'Lily',
    edgeTtsVoice: 'en-US-AvaMultilingualNeural',
    styleTts2Voice: 'Nelly_Female_EN_US',
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
    },
  },
  [VoiceType.BILL]: {
    id: VoiceType.BILL,
    name: 'Bill',
    edgeTtsVoice: 'en-US-RogerNeural',
    styleTts2Voice: 'Samuel_Male_EN_US',
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
    },
  },
  [VoiceType.LAURA]: {
    id: VoiceType.LAURA,
    name: 'Laura',
    edgeTtsVoice: 'en-US-AriaNeural',
    styleTts2Voice: 'Lisa_Female_EN_US',
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
    // Rosie (Dorothy): young British child voice - calmer for storytelling
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
    // Pixie (Gigi): animated childish American voice - more expressive
    voiceSettings: {
      stability: 0.3,
      similarity_boost: 0.85,
      style: 0.7,
      use_speaker_boost: true,
    },
  },
};

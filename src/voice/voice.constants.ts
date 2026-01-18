import { VoiceType } from './voice.dto';

export const VOICE_AVATARS = {
    [VoiceType.MILO]: 'https://res.cloudinary.com/billmal/image/upload/v1768772687/storytime/voice_avatars/milo.png',
    [VoiceType.BELLA]: 'https://res.cloudinary.com/billmal/image/upload/v1768772688/storytime/voice_avatars/bella.png',
    [VoiceType.COSMO]: 'https://res.cloudinary.com/billmal/image/upload/v1768772689/storytime/voice_avatars/cosmo.png',
    [VoiceType.NIMBUS]: 'https://res.cloudinary.com/billmal/image/upload/v1768772690/storytime/voice_avatars/nimbus.png',
    [VoiceType.GRANDPA_JO]: 'https://res.cloudinary.com/billmal/image/upload/v1768772691/storytime/voice_avatars/grandpa_jo.png',
    [VoiceType.CHIP]: 'https://res.cloudinary.com/billmal/image/upload/v1768772693/storytime/voice_avatars/chip.png',
};

export const VOICE_PREVIEWS = {
    [VoiceType.MILO]: 'https://storage.googleapis.com/eleven-public-prod/premade/voices/IKne3meq5aSn9XLyUdCD/102de6f2-22ed-43e0-a1f1-111fa75c5481.mp3',
    [VoiceType.BELLA]: 'https://storage.googleapis.com/eleven-public-prod/premade/voices/cgSgspJ2msm6clMCkdW9/56a97bf8-b69b-448f-846c-c3a11683d45a.mp3',
    [VoiceType.COSMO]: 'https://storage.googleapis.com/eleven-public-prod/premade/voices/bIHbv24MWmeRgasZH58o/8caf8f3d-ad29-4980-af41-53f20c72d7a4.mp3',
    [VoiceType.NIMBUS]: 'https://storage.googleapis.com/eleven-public-prod/premade/voices/pFZP5JQG7iQjIQuC4Bku/89b68b35-b3dd-4348-a84a-a3c13a3c2b30.mp3',
    [VoiceType.GRANDPA_JO]: 'https://storage.googleapis.com/eleven-public-prod/premade/voices/pqHfZKP75CvOlQylNhV4/d782b3ff-84ba-4029-848c-acf01285524d.mp3',
    [VoiceType.CHIP]: 'https://storage.googleapis.com/eleven-public-prod/premade/voices/FGY2WhTYpPnrIDTdsKH5/67341759-ad08-41a5-be6e-de12fe448618.mp3',
};

export const VOICE_CONFIG = {
    [VoiceType.MILO]: {
        id: VoiceType.MILO,
        name: 'Milo',
        model: 'aura-orion-en', // Kept model as placeholder, but ID is real
        gender: 'Male',
        elevenLabsId: 'IKne3meq5aSn9XLyUdCD', // Charlie
        previewUrl: VOICE_PREVIEWS[VoiceType.MILO],
        voiceAvatar: VOICE_AVATARS[VoiceType.MILO],
    },
    [VoiceType.BELLA]: {
        id: VoiceType.BELLA,
        name: 'Bella',
        model: 'aura-asteria-en',
        gender: 'Female',
        elevenLabsId: 'cgSgspJ2msm6clMCkdW9', // Jessica
        previewUrl: VOICE_PREVIEWS[VoiceType.BELLA],
        voiceAvatar: VOICE_AVATARS[VoiceType.BELLA],
    },
    [VoiceType.COSMO]: {
        id: VoiceType.COSMO,
        name: 'Cosmo',
        model: 'aura-arcas-en',
        gender: 'Male',
        elevenLabsId: 'bIHbv24MWmeRgasZH58o', // Will
        previewUrl: VOICE_PREVIEWS[VoiceType.COSMO],
        voiceAvatar: VOICE_AVATARS[VoiceType.COSMO],
    },
    [VoiceType.NIMBUS]: {
        id: VoiceType.NIMBUS,
        name: 'Nimbus',
        model: 'aura-luna-en',
        gender: 'Female',
        elevenLabsId: 'pFZP5JQG7iQjIQuC4Bku', // Lily
        previewUrl: VOICE_PREVIEWS[VoiceType.NIMBUS],
        voiceAvatar: VOICE_AVATARS[VoiceType.NIMBUS],
    },
    [VoiceType.GRANDPA_JO]: {
        id: VoiceType.GRANDPA_JO,
        name: 'Grandpa Jo',
        model: 'aura-angus-en',
        gender: 'Male',
        elevenLabsId: 'pqHfZKP75CvOlQylNhV4', // Bill
        previewUrl: VOICE_PREVIEWS[VoiceType.GRANDPA_JO],
        voiceAvatar: VOICE_AVATARS[VoiceType.GRANDPA_JO],
    },
    [VoiceType.CHIP]: {
        id: VoiceType.CHIP,
        name: 'Chip',
        model: 'aura-perseus-en',
        gender: 'Male', // Keeping as Male for type safety/db if enum, but Voice is Female
        elevenLabsId: 'FGY2WhTYpPnrIDTdsKH5', // Laura
        previewUrl: VOICE_PREVIEWS[VoiceType.CHIP],
        voiceAvatar: VOICE_AVATARS[VoiceType.CHIP],
    },
};

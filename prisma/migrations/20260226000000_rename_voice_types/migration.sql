-- Rename Voice.name (match by elevenLabsVoiceId for safety)
UPDATE "voices" SET "name" = 'MILO' WHERE "name" = 'CHARLIE' AND "elevenLabsVoiceId" = 'NFG5qt843uXKj4pFvR7C';
UPDATE "voices" SET "name" = 'BELLA' WHERE "name" = 'JESSICA' AND "elevenLabsVoiceId" = 'wJqPPQ618aTW29mptyoc';
UPDATE "voices" SET "name" = 'COSMO' WHERE "name" = 'WILL' AND "elevenLabsVoiceId" = 'EiNlNiXeDU1pqqOPrYMO';
UPDATE "voices" SET "name" = 'NIMBUS' WHERE "name" = 'LILY' AND "elevenLabsVoiceId" = 'XrExE9yKIg1WjnnlVkGX';
UPDATE "voices" SET "name" = 'FANICE' WHERE "name" = 'BILL' AND "elevenLabsVoiceId" = 'iCrDUkL56s3C8sCRl7wb';
UPDATE "voices" SET "name" = 'CHIP' WHERE "name" = 'LAURA' AND "elevenLabsVoiceId" = 'N2lVS1w4EtoT3dr4eOWO';

-- Rename ParagraphAudioCache.voiceId
UPDATE "paragraph_audio_cache" SET "voiceId" = 'MILO' WHERE "voiceId" = 'CHARLIE';
UPDATE "paragraph_audio_cache" SET "voiceId" = 'BELLA' WHERE "voiceId" = 'JESSICA';
UPDATE "paragraph_audio_cache" SET "voiceId" = 'COSMO' WHERE "voiceId" = 'WILL';
UPDATE "paragraph_audio_cache" SET "voiceId" = 'NIMBUS' WHERE "voiceId" = 'LILY';
UPDATE "paragraph_audio_cache" SET "voiceId" = 'FANICE' WHERE "voiceId" = 'BILL';
UPDATE "paragraph_audio_cache" SET "voiceId" = 'CHIP' WHERE "voiceId" = 'LAURA';

-- Rename StoryAudioCache.voiceType
UPDATE "story_audio_cache" SET "voiceType" = 'MILO' WHERE "voiceType" = 'CHARLIE';
UPDATE "story_audio_cache" SET "voiceType" = 'BELLA' WHERE "voiceType" = 'JESSICA';
UPDATE "story_audio_cache" SET "voiceType" = 'COSMO' WHERE "voiceType" = 'WILL';
UPDATE "story_audio_cache" SET "voiceType" = 'NIMBUS' WHERE "voiceType" = 'LILY';
UPDATE "story_audio_cache" SET "voiceType" = 'FANICE' WHERE "voiceType" = 'BILL';
UPDATE "story_audio_cache" SET "voiceType" = 'CHIP' WHERE "voiceType" = 'LAURA';

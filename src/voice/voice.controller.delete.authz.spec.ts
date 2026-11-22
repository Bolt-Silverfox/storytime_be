import {
  ConflictException,
  INestApplication,
  NotFoundException,
} from '@nestjs/common';
import request from 'supertest';
import { VoiceController } from './voice.controller';
import { VoiceService } from './voice.service';
import { StoryService } from '../story/story.service';
import { StoryQuotaService } from '../story/story-quota.service';
import { UploadService } from '../upload/upload.service';
import { TextToSpeechService } from '../story/text-to-speech.service';
import { SpeechToTextService } from './speech-to-text.service';
import { VoiceQuotaService } from './voice-quota.service';
import { TtsBatchQueueService } from './queue/tts-batch-queue.service';
import { GuestSessionService } from '@/guest/guest-session.service';
import { GuestStoryAudioService } from './guest-story-audio.service';
import { ALICE, bearer, createAuthzApp } from '@/shared/testing/authz-harness';

const VOICE_ID = '7b0f0a52-3c1d-4a8e-9f65-2d1c0b9a8e77';

describe('DELETE /voice/:id authorization', () => {
  let app: INestApplication;
  const voices = { deleteVoice: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    voices.deleteVoice.mockResolvedValue(undefined);
    app = await createAuthzApp(
      [VoiceController],
      [
        { provide: VoiceService, useValue: voices },
        ...[
          StoryService,
          StoryQuotaService,
          UploadService,
          TextToSpeechService,
          SpeechToTextService,
          VoiceQuotaService,
          TtsBatchQueueService,
          GuestSessionService,
          GuestStoryAudioService,
        ].map((provide) => ({ provide, useValue: {} })),
      ],
    );
  });

  afterEach(() => app.close());

  const del = (id = VOICE_ID) =>
    request(app.getHttpServer() as Parameters<typeof request>[0]).delete(
      `/voice/${id}`,
    );

  it('rejects anonymous callers with 401', async () => {
    await del().expect(401);
    expect(voices.deleteVoice).not.toHaveBeenCalled();
  });

  it('deletes the voice on behalf of the caller', async () => {
    await del()
      .set('Authorization', bearer('alice'))
      .expect(200, { success: true });
    expect(voices.deleteVoice).toHaveBeenCalledWith(ALICE, VOICE_ID);
  });

  it('rejects an id that is not a UUID with 400', async () => {
    await del('preferred').set('Authorization', bearer('alice')).expect(400);
    expect(voices.deleteVoice).not.toHaveBeenCalled();
  });

  it("answers 404 when the voice is not the caller's", async () => {
    voices.deleteVoice.mockRejectedValueOnce(new NotFoundException());
    await del().set('Authorization', bearer('alice')).expect(404);
  });

  it('answers 409 when the voice is still selected', async () => {
    voices.deleteVoice.mockRejectedValueOnce(new ConflictException());
    await del().set('Authorization', bearer('alice')).expect(409);
  });
});

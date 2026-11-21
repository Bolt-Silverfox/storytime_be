import { ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { PrismaClient } from '@prisma/client';
import { of } from 'rxjs';
import { PrismaService } from '@/prisma/prisma.service';
import { CircuitBreakerService } from '@/shared/services/circuit-breaker.service';
import { UploadService } from '@/upload/upload.service';
import { ElevenLabsTTSProvider } from '../providers/eleven-labs-tts.provider';
import { PrismaVoiceRepository } from '../repositories/prisma-voice.repository';
import { VOICE_CONFIG } from '../voice.constants';
import { VoiceType } from '../dto/voice.dto';
import { VoiceLibraryService } from './voice-library.service';
import { VoiceResponseMapper } from './voice-response.mapper';

const describeDb = process.env.DATABASE_URL ? describe : describe.skip;

describeDb('registering an ElevenLabs id (real Postgres)', () => {
  const prisma = new PrismaService();
  const raw = new PrismaClient();
  const repo = new PrismaVoiceRepository(prisma);
  const tag = `vreg_${Date.now()}`;
  const CLONE = `${tag}_clone`;
  const FRESH = `${tag}_fresh`;
  const SYSTEM_ID = VOICE_CONFIG[VoiceType.MILO].elevenLabsId;
  const httpGet = jest.fn();
  const breaker = {
    name: 'voice-library',
    canExecute: () => true,
    recordSuccess: () => undefined,
    recordFailure: () => undefined,
  };
  const service = new VoiceLibraryService(
    repo,
    { get: () => 'fake-key' } as unknown as ConfigService,
    { get: httpGet } as unknown as HttpService,
    {} as ElevenLabsTTSProvider,
    new VoiceResponseMapper(),
    { getBreaker: () => breaker } as unknown as CircuitBreakerService,
    {} as UploadService,
  );
  let counter = 0;
  let uploaderId: string;
  let otherUserId: string;
  let uploadedVoiceId: string;

  const newUser = async () =>
    (
      await raw.user.create({
        data: { email: `${tag}_${counter++}@example.com`, passwordHash: 'x' },
      })
    ).id;

  const rowsCarrying = (elevenLabsVoiceId: string) =>
    raw.voice.findMany({
      where: { elevenLabsVoiceId, user: { email: { startsWith: tag } } },
      orderBy: { createdAt: 'asc' },
    });

  beforeEach(async () => {
    httpGet.mockReset();
    httpGet.mockReturnValue(
      of({ status: 200, data: { name: 'Harry', preview_url: null } }),
    );
    uploaderId = await newUser();
    otherUserId = await newUser();
    const uploaded = await repo.createVoice({
      userId: uploaderId,
      name: 'Dad',
      type: 'uploaded',
      url: 'https://cdn/v.mp3',
      elevenLabsVoiceId: CLONE,
    });
    uploadedVoiceId = uploaded.id;
  });

  afterEach(async () => {
    await raw.user.deleteMany({ where: { email: { startsWith: tag } } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await raw.$disconnect();
  });

  const softDeleteUploaded = () =>
    repo.softDeleteOwnedIfUnreferenced(uploadedVoiceId, uploaderId);

  describe.each([
    ['live', () => Promise.resolve()],
    ['soft-deleted', softDeleteUploaded],
  ])('while a %s uploaded voice carries the id', (_state, arrange) => {
    beforeEach(async () => {
      await arrange();
    });

    it.each([
      ['another user', () => otherUserId],
      ['its owner', () => uploaderId],
    ])('refuses %s registering it by hand', async (_who, userId) => {
      await expect(
        service.createElevenLabsVoice(userId(), {
          name: 'Mine now',
          elevenLabsVoiceId: CLONE,
        }),
      ).rejects.toThrow(ConflictException);
      expect(await rowsCarrying(CLONE)).toHaveLength(1);
    });

    it('refuses another user registering it through a kid update', async () => {
      await expect(
        service.findOrCreateElevenLabsVoice(CLONE, otherUserId),
      ).rejects.toThrow(ConflictException);
      expect(await rowsCarrying(CLONE)).toHaveLength(1);
      expect(httpGet).not.toHaveBeenCalled();
    });
  });

  it('gives the owner their live uploaded voice through a kid update', async () => {
    expect(
      await service.findOrCreateElevenLabsVoice(CLONE, uploaderId),
    ).toEqual({ id: uploadedVoiceId });
    expect(await rowsCarrying(CLONE)).toHaveLength(1);
  });

  it('refuses the owner re-registering their soft-deleted clone through a kid update', async () => {
    await softDeleteUploaded();

    await expect(
      service.findOrCreateElevenLabsVoice(CLONE, uploaderId),
    ).rejects.toThrow(ConflictException);
    expect(await rowsCarrying(CLONE)).toHaveLength(1);
  });

  it('registers the id once the uploaded voice has forgotten it', async () => {
    await repo.clearElevenLabsVoiceId(uploadedVoiceId, uploaderId);

    const voice = await service.createElevenLabsVoice(otherUserId, {
      name: 'Robot',
      elevenLabsVoiceId: CLONE,
    });

    expect(await rowsCarrying(CLONE)).toMatchObject([
      { id: voice.id, userId: otherUserId, type: 'elevenlabs' },
    ]);
  });

  it.each([
    ['a fresh id', FRESH],
    ['a built-in voice id', SYSTEM_ID],
  ])('registers %s by hand', async (_label, elevenLabsVoiceId) => {
    const voice = await service.createElevenLabsVoice(otherUserId, {
      name: 'Robot',
      elevenLabsVoiceId,
    });

    expect(await rowsCarrying(elevenLabsVoiceId)).toMatchObject([
      { id: voice.id, userId: otherUserId, type: 'elevenlabs', name: 'Robot' },
    ]);
  });

  it.each([
    ['a fresh id', FRESH],
    ['a built-in voice id', SYSTEM_ID],
  ])(
    'registers %s through a kid update, once',
    async (_label, elevenLabsVoiceId) => {
      const first = await service.findOrCreateElevenLabsVoice(
        elevenLabsVoiceId,
        otherUserId,
      );
      const second = await service.findOrCreateElevenLabsVoice(
        elevenLabsVoiceId,
        otherUserId,
      );

      expect(second).toEqual(first);
      expect(await rowsCarrying(elevenLabsVoiceId)).toMatchObject([
        { id: first.id, userId: otherUserId, type: 'elevenlabs' },
      ]);
    },
  );
});

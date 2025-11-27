import { Test, TestingModule } from '@nestjs/testing';
import { VoiceService } from './voice.service';
import { PrismaService } from '../prisma/prisma.service';
import { VOICEID } from '../story/story.dto';

const mockPrismaService = {
    voice: {
        findMany: jest.fn(),
    },
};

describe('VoiceService', () => {
    let service: VoiceService;
    let prisma: typeof mockPrismaService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                VoiceService,
                { provide: PrismaService, useValue: mockPrismaService },
            ],
        }).compile();

        service = module.get<VoiceService>(VoiceService);
        prisma = module.get(PrismaService);
        jest.clearAllMocks();
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    describe('getAllAvailableVoices', () => {
        it('should return system voices and user voices', async () => {
            const userId = 'user-1';
            const userVoices = [
                { id: 'voice-1', name: 'Custom Voice', type: 'uploaded', url: 'http://url', elevenLabsVoiceId: null, userId },
            ];
            prisma.voice.findMany.mockResolvedValue(userVoices);

            const result = await service.getAllAvailableVoices(userId);

            // Check system voices presence (at least one)
            expect(result).toEqual(expect.arrayContaining([
                expect.objectContaining({ id: VOICEID.MILO, type: 'system' }),
            ]));

            // Check user voice presence
            expect(result).toEqual(expect.arrayContaining([
                expect.objectContaining({ id: 'voice-1', name: 'Custom Voice', type: 'uploaded' }),
            ]));

            expect(prisma.voice.findMany).toHaveBeenCalledWith({
                where: { userId },
                orderBy: { createdAt: 'desc' },
            });
        });
    });
});

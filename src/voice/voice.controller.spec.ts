import { Test, TestingModule } from '@nestjs/testing';
import { VoiceController } from './voice.controller';
import { VoiceService } from './voice.service';
import { AuthenticatedRequest, AuthSessionGuard } from '../auth/auth.guard';

const mockVoiceService = {
    getAllAvailableVoices: jest.fn(),
};

describe('VoiceController', () => {
    let controller: VoiceController;
    let service: typeof mockVoiceService;

    const mockRequest = {
        authUserData: { userId: 'user-1' },
    } as AuthenticatedRequest;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [VoiceController],
            providers: [
                { provide: VoiceService, useValue: mockVoiceService },
            ],
        })
            .overrideGuard(AuthSessionGuard)
            .useValue({ canActivate: () => true })
            .compile();

        controller = module.get<VoiceController>(VoiceController);
        service = module.get(VoiceService);
        jest.clearAllMocks();
    });

    it('should be defined', () => {
        expect(controller).toBeDefined();
    });

    describe('getVoices', () => {
        it('should return all voices', async () => {
            const expectedResult = [{ id: 'voice-1' }];
            service.getAllAvailableVoices.mockResolvedValue(expectedResult);

            const result = await controller.getVoices(mockRequest);
            expect(result).toEqual(expectedResult);
            expect(service.getAllAvailableVoices).toHaveBeenCalledWith('user-1');
        });
    });
});

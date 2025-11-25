import { Test, TestingModule } from '@nestjs/testing';
import { KidController } from './kid.controller';
import { KidService } from './kid.service';
import { AuthenticatedRequest, AuthSessionGuard } from '../auth/auth.guard';
import { CreateKidDto, UpdateKidDto, SetKidPreferredVoiceDto } from './dto/kid.dto';
import { VoiceType } from '@/story/story.dto';
import { BadRequestException, ForbiddenException } from '@nestjs/common';

const mockKidService = {
    findAllByUser: jest.fn(),
    createKids: jest.fn(),
    findOne: jest.fn(),
    updateKid: jest.fn(),
    deleteKid: jest.fn(),
    setKidPreferredVoice: jest.fn(),
    getKidPreferredVoice: jest.fn(),
};

describe('KidController', () => {
    let controller: KidController;
    let service: typeof mockKidService;

    const mockRequest = {
        authUserData: { userId: 'user-1' },
    } as AuthenticatedRequest;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [KidController],
            providers: [
                { provide: KidService, useValue: mockKidService },
            ],
        })
            .overrideGuard(AuthSessionGuard)
            .useValue({ canActivate: () => true })
            .compile();

        controller = module.get<KidController>(KidController);
        service = module.get(KidService);
        jest.clearAllMocks();
    });

    it('should be defined', () => {
        expect(controller).toBeDefined();
    });

    describe('getMyKids', () => {
        it('should return kids', async () => {
            const expectedResult = [{ id: 'kid-1' }];
            service.findAllByUser.mockResolvedValue(expectedResult);

            const result = await controller.getMyKids(mockRequest);
            expect(result).toEqual(expectedResult);
            expect(service.findAllByUser).toHaveBeenCalledWith('user-1');
        });
    });

    describe('createKids', () => {
        it('should create kids', async () => {
            const dtos: CreateKidDto[] = [{ name: 'Alex', ageRange: '5-8' }];
            const expectedResult = [{ id: 'kid-1', ...dtos[0] }];
            service.createKids.mockResolvedValue(expectedResult);

            const result = await controller.createKids(mockRequest, dtos);
            expect(result).toEqual(expectedResult);
            expect(service.createKids).toHaveBeenCalledWith('user-1', dtos);
        });
    });

    describe('getKid', () => {
        it('should return a kid', async () => {
            const kidId = 'kid-1';
            const expectedResult = { id: kidId };
            service.findOne.mockResolvedValue(expectedResult);

            const result = await controller.getKid(mockRequest, kidId);
            expect(result).toEqual(expectedResult);
            expect(service.findOne).toHaveBeenCalledWith(kidId, 'user-1');
        });
    });

    describe('updateKid', () => {
        it('should update a kid', async () => {
            const kidId = 'kid-1';
            const dto: UpdateKidDto = { name: 'Alex Updated' };
            const expectedResult = { id: kidId, ...dto };
            service.updateKid.mockResolvedValue(expectedResult);

            const result = await controller.updateKid(mockRequest, kidId, dto);
            expect(result).toEqual(expectedResult);
            expect(service.updateKid).toHaveBeenCalledWith(kidId, 'user-1', dto);
        });
    });

    describe('deleteKid', () => {
        it('should delete a kid', async () => {
            const kidId = 'kid-1';
            const expectedResult = { id: kidId };
            service.deleteKid.mockResolvedValue(expectedResult);

            const result = await controller.deleteKid(mockRequest, kidId);
            expect(result).toEqual(expectedResult);
            expect(service.deleteKid).toHaveBeenCalledWith(kidId, 'user-1');
        });
    });

    describe('setKidPreferredVoice', () => {
        it('should set preferred voice', async () => {
            const kidId = 'kid-1';
            const dto: SetKidPreferredVoiceDto = { voiceType: 'MILO' };
            const expectedResult = { kidId, voiceType: VoiceType.MILO };
            service.setKidPreferredVoice.mockResolvedValue(expectedResult);

            const result = await controller.setKidPreferredVoice(kidId, dto);
            expect(result).toEqual(expectedResult);
            expect(service.setKidPreferredVoice).toHaveBeenCalledWith(kidId, VoiceType.MILO);
        });

        it('should throw BadRequestException if voiceType is missing', async () => {
            const dto = {} as SetKidPreferredVoiceDto;
            await expect(controller.setKidPreferredVoice('kid-1', dto)).rejects.toThrow(BadRequestException);
        });

        it('should throw ForbiddenException if voiceType is invalid', async () => {
            const dto = { voiceType: 'INVALID' } as SetKidPreferredVoiceDto;
            await expect(controller.setKidPreferredVoice('kid-1', dto)).rejects.toThrow(ForbiddenException);
        });
    });

    describe('getKidPreferredVoice', () => {
        it('should return preferred voice', async () => {
            const kidId = 'kid-1';
            const expectedResult = { kidId, voiceType: VoiceType.MILO };
            service.getKidPreferredVoice.mockResolvedValue(expectedResult);

            const result = await controller.getKidPreferredVoice(kidId);
            expect(result).toEqual(expectedResult);
            expect(service.getKidPreferredVoice).toHaveBeenCalledWith(kidId);
        });
    });
});

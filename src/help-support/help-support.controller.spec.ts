import { Test, TestingModule } from '@nestjs/testing';
import { HelpSupportController } from './help-support.controller';
import { HelpSupportService } from './help-support.service';
import { AuthSessionGuard } from '@/shared/guards/auth.guard';

describe('HelpSupportController', () => {
  let controller: HelpSupportController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HelpSupportController],
      providers: [
        {
          provide: HelpSupportService,
          useValue: {
            getFaqs: jest.fn().mockReturnValue([]),
            submitFeedback: jest.fn(),
            getContactInfo: jest.fn(),
            getTerms: jest.fn(),
            getPrivacy: jest.fn(),
            createTicket: jest.fn(),
            listMyTickets: jest.fn(),
            getTicket: jest.fn(),
          },
        },
      ],
    })
      .overrideGuard(AuthSessionGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<HelpSupportController>(HelpSupportController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import { HelpSupportService } from './help-support.service';
import {
  SUPPORT_TICKET_REPOSITORY,
  ISupportTicketRepository,
} from './repositories';
import { NotificationService } from '@/notification/notification.service';
import { ConfigService } from '@nestjs/config';

describe('HelpSupportService', () => {
  let service: HelpSupportService;

  beforeEach(async () => {
    const mockSupportTicketRepository: Record<
      keyof ISupportTicketRepository,
      jest.Mock
    > = {
      create: jest.fn(),
      findManyByUser: jest.fn(),
      findUniqueById: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HelpSupportService,
        {
          provide: SUPPORT_TICKET_REPOSITORY,
          useValue: mockSupportTicketRepository,
        },
        {
          provide: NotificationService,
          useValue: {
            queueEmail: jest.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockImplementation((key: string) => {
              switch (key) {
                case 'DEFAULT_SENDER_EMAIL':
                  return 'team@storytime.app';
                default:
                  return undefined;
              }
            }),
          },
        },
      ],
    }).compile();

    service = module.get<HelpSupportService>(HelpSupportService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});

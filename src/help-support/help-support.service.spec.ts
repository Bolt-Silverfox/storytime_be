import { Test, TestingModule } from '@nestjs/testing';
import { HelpSupportService } from './help-support.service';
import { PrismaService } from '@/prisma/prisma.service';
import { NotificationService } from '@/notification/notification.service';
import { ConfigService } from '@nestjs/config';

describe('HelpSupportService', () => {
  let service: HelpSupportService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HelpSupportService,
        {
          provide: PrismaService,
          useValue: {
            supportTicket: {
              create: jest.fn(),
              findMany: jest.fn(),
              findUnique: jest.fn(),
            },
          },
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

import { Test, TestingModule } from '@nestjs/testing';
import { HelpSupportService } from './help-support.service';

describe('HelpSupportService', () => {
  let service: HelpSupportService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [HelpSupportService],
    }).compile();

    service = module.get<HelpSupportService>(HelpSupportService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});

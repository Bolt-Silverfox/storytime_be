import { Test, TestingModule } from '@nestjs/testing';
import { HelpSupportController } from './help-support.controller';

describe('HelpSupportController', () => {
  let controller: HelpSupportController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HelpSupportController],
    }).compile();

    controller = module.get<HelpSupportController>(HelpSupportController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});

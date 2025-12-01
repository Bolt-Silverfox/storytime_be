import { Module } from '@nestjs/common';
import { HelpSupportController } from './help-support.controller';
import { HelpSupportService } from './help-support.service';

@Module({
  controllers: [HelpSupportController],
  providers: [HelpSupportService]
})
export class HelpSupportModule {}

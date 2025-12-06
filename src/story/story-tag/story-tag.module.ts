import { Module } from '@nestjs/common';
import { StoryTagService } from './story-tag.service';
import { StoryTagController } from './story-tag.controller';
import { PrismaModule } from 'src/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [StoryTagController],
  providers: [StoryTagService],
  exports: [StoryTagService],
})
export class StoryTagModule {}

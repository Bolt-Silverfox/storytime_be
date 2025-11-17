import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UploadService } from '../upload/upload.service';
import { ElevenLabsService } from './elevenlabs.service';
import { StoryController } from './story.controller';
import { StoryService } from './story.service';

@Module({
  imports: [HttpModule],
  controllers: [StoryController],
  providers: [StoryService, PrismaService, ElevenLabsService, UploadService],
})
export class StoryModule {}

import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { StoryController } from './story.controller';
import { StoryService } from './story.service';
import { PrismaService } from '@/prisma/prisma.service';
import { ElevenLabsService } from './elevenlabs.service';
import { UploadService } from '../upload/upload.service';

@Module({
  imports: [HttpModule],
  controllers: [StoryController],
  providers: [StoryService, PrismaService, ElevenLabsService, UploadService],
})
export class StoryModule {}

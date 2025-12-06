import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Delete,
} from '@nestjs/common';
import { StoryTagService } from './story-tag.service';
import { CreateStoryTagDto } from './dto/create-story-tag.dto';
import { UpdateStoryTagDto } from './dto/update-story-tag.dto';

@Controller('story-tags')
export class StoryTagController {
  constructor(private readonly storyTagService: StoryTagService) {}

  @Post()
  create(@Body() dto: CreateStoryTagDto) {
    return this.storyTagService.create(dto);
  }

  @Get()
  findAll() {
    return this.storyTagService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.storyTagService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateStoryTagDto) {
    return this.storyTagService.update(id, dto);
  }

  @Delete(':id')
  softDelete(@Param('id') id: string) {
    return this.storyTagService.softDelete(id);
  }
}

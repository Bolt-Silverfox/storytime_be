import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { AgeService } from './age.service';
import { CreateAgeDto } from './dto/create-age.dto';
import { UpdateAgeDto } from './dto/update-age.dto';

@Controller('age')
export class AgeController {
  constructor(private readonly ageService: AgeService) {}

  @Post()
  create(@Body() createAgeDto: CreateAgeDto) {
    return this.ageService.create(createAgeDto);
  }

  @Get()
  findAll() {
    return this.ageService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.ageService.findOne(+id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateAgeDto: UpdateAgeDto) {
    return this.ageService.update(+id, updateAgeDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.ageService.remove(+id);
  }
}

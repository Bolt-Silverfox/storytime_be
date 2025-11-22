import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import { AgeService } from './age.service';
import { CreateAgeDto, UpdateAgeDto } from './age.dto';
import { AdminGuard } from '../auth/admin.guard';

@Controller('age-group')
export class AgeController {
  constructor(private readonly ageService: AgeService) {}

  // Public route
  @Get()
  findAll() {
    return this.ageService.findAll();
  }

  //  Admin protected
  @UseGuards(AdminGuard)
  @Post()
  create(@Body() dto: CreateAgeDto) {
    return this.ageService.create(dto);
  }

  //  Admin protected
  @UseGuards(AdminGuard)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateAgeDto) {
    return this.ageService.update(id, dto);
  }

  //  Admin protected
  @UseGuards(AdminGuard)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.ageService.delete(id);
  }
}

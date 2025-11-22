import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { AgeService } from './age.service';
import { CreateAgeDto, UpdateAgeDto } from './age.dto';
import { AdminGuard } from '../auth/admin.guard';

@ApiTags('Age Groups')
@Controller('age-group')
export class AgeController {
  constructor(private readonly ageService: AgeService) {}

  @Get()
  @ApiOperation({ summary: 'Get all age groups' })
  findAll() {
    return this.ageService.findAll();
  }

  @ApiQuery({
    name: 'age',
    required: false,
    description: 'Find which age group this age belongs to',
    example: 7,
  })
  @Get('lookup/by-age')
  @ApiOperation({ summary: 'Find age group by child age' })
  findGroupForAge(@Query('age') age: string) {
    return this.ageService.findGroupForAge(Number(age));
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get age group by ID' })
  findOne(@Param('id') id: string) {
    return this.ageService.findOne(id);
  }

  @UseGuards(AdminGuard)
  @Post()
  @ApiOperation({ summary: 'Create a new age group (Admin only)' })
  create(@Body() dto: CreateAgeDto) {
    return this.ageService.create(dto);
  }

  @UseGuards(AdminGuard)
  @Patch(':id')
  @ApiOperation({ summary: 'Update an age group (Admin only)' })
  update(@Param('id') id: string, @Body() dto: UpdateAgeDto) {
    return this.ageService.update(id, dto);
  }

  @UseGuards(AdminGuard)
  @Delete(':id')
  @ApiOperation({ summary: 'Delete an age group (Admin only)' })
  remove(@Param('id') id: string) {
    return this.ageService.delete(id);
  }
}

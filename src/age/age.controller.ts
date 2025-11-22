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
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AgeService } from './age.service';
import { CreateAgeDto, UpdateAgeDto } from './age.dto';
import { AdminGuard } from '../auth/admin.guard';

@ApiTags('Age Groups')
@Controller('age-group')
export class AgeController {
  constructor(private readonly ageService: AgeService) {}

  // Public route: Get all age groups
  @Get()
  @ApiOperation({ summary: 'Get all age groups' })
  findAll() {
    return this.ageService.findAll();
  }

  // Public route: Get single age group by ID
  @Get(':id')
  @ApiOperation({ summary: 'Get age group by ID' })
  findOne(@Param('id') id: string) {
    return this.ageService.findOne(id);
  }

  // Admin protected: Create new age group
  @UseGuards(AdminGuard)
  @Post()
  @ApiOperation({ summary: 'Create a new age group' })
  create(@Body() dto: CreateAgeDto) {
    return this.ageService.create(dto);
  }

  // Admin protected: Update an age group
  @UseGuards(AdminGuard)
  @Patch(':id')
  @ApiOperation({ summary: 'Update an age group' })
  update(@Param('id') id: string, @Body() dto: UpdateAgeDto) {
    return this.ageService.update(id, dto);
  }

  // Admin protected: Delete an age group
  @UseGuards(AdminGuard)
  @Delete(':id')
  @ApiOperation({ summary: 'Delete an age group' })
  remove(@Param('id') id: string) {
    return this.ageService.delete(id);
  }
}

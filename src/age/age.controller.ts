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
import {
  ApiTags,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { AgeService } from './age.service';
import { CreateAgeDto, UpdateAgeDto } from './age.dto';
import { AdminGuard } from '../auth/admin.guard';

@ApiTags('Age Groups')
@Controller('age-group')
export class AgeController {
  constructor(private readonly ageService: AgeService) {}

  /* ----------------------------------------
   * PUBLIC ENDPOINTS
   ---------------------------------------- */

  @Get()
  @ApiOperation({ summary: 'Get all age groups' })
  @ApiResponse({
    status: 200,
    description: 'List of age groups retrieved successfully.',
  })
  findAll() {
    return this.ageService.findAll();
  }

  @ApiQuery({
    name: 'age',
    required: true,
    description: 'Find which age group this age belongs to',
    example: 7,
  })
  @Get('lookup/by-age')
  @ApiOperation({ summary: 'Find age group by child age' })
  @ApiResponse({ status: 200, description: 'Age group found successfully.' })
  @ApiNotFoundResponse({ description: 'No age group found for the given age.' })
  @ApiBadRequestResponse({ description: 'Invalid age parameter provided.' })
  findGroupForAge(@Query('age') age: string) {
    return this.ageService.findGroupForAge(Number(age));
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get age group by ID' })
  @ApiResponse({ status: 200, description: 'Age group found successfully.' })
  @ApiNotFoundResponse({ description: 'Age group not found.' })
  findOne(@Param('id') id: string) {
    return this.ageService.findOne(id);
  }

  /* ----------------------------------------
   * ADMIN PROTECTED ENDPOINTS
   ---------------------------------------- */

  @UseGuards(AdminGuard)
  @ApiBearerAuth()
  @Post()
  @ApiOperation({ summary: 'Create a new age group (Admin only)' })
  @ApiResponse({ status: 201, description: 'Age group created successfully.' })
  @ApiBadRequestResponse({
    description: 'Invalid data or overlapping age range.',
  })
  create(@Body() dto: CreateAgeDto) {
    return this.ageService.create(dto);
  }

  @UseGuards(AdminGuard)
  @ApiBearerAuth()
  @Patch(':id')
  @ApiOperation({ summary: 'Update an age group (Admin only)' })
  @ApiResponse({ status: 200, description: 'Age group updated successfully.' })
  @ApiNotFoundResponse({ description: 'Age group not found.' })
  @ApiBadRequestResponse({
    description: 'Invalid data or overlapping age range.',
  })
  update(@Param('id') id: string, @Body() dto: UpdateAgeDto) {
    return this.ageService.update(id, dto);
  }

  @UseGuards(AdminGuard)
  @ApiBearerAuth()
  @Delete(':id')
  @ApiOperation({ summary: 'Delete an age group (Admin only)' })
  @ApiResponse({ status: 200, description: 'Age group deleted successfully.' })
  @ApiNotFoundResponse({ description: 'Age group not found.' })
  remove(@Param('id') id: string) {
    return this.ageService.delete(id);
  }
}

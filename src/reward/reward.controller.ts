import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Patch,
  Delete,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiBody,
} from '@nestjs/swagger';
import { RewardService } from './reward.service';
import {
  CreateRewardDto,
  UpdateRewardDto,
  RewardDto,
  RedeemRewardDto,
  UpdateRewardRedemptionStatusDto,
  RewardRedemptionDto,
} from './reward.dto';

@ApiTags('rewards')
@Controller('rewards')
export class RewardController {
  constructor(private readonly rewardService: RewardService) {}

  @Post()
  @ApiOperation({ summary: 'Create reward' })
  @ApiBody({ type: CreateRewardDto })
  @ApiResponse({ status: 201, type: RewardDto })
  async create(@Body() dto: CreateRewardDto) {
    return this.rewardService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List all rewards' })
  @ApiResponse({ status: 200, type: [RewardDto] })
  async findAll() {
    return this.rewardService.findAll();
  }

  @Get('kid/:kidId')
  @ApiOperation({ summary: 'List rewards for a kid' })
  @ApiParam({ name: 'kidId', type: String })
  @ApiResponse({ status: 200, type: [RewardDto] })
  async findByKid(@Param('kidId') kidId: string) {
    return this.rewardService.findByKid(kidId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get reward by id' })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({ status: 200, type: RewardDto })
  async findOne(@Param('id') id: string) {
    return this.rewardService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update reward' })
  @ApiParam({ name: 'id', type: String })
  @ApiBody({ type: UpdateRewardDto })
  @ApiResponse({ status: 200, type: RewardDto })
  async update(@Param('id') id: string, @Body() dto: UpdateRewardDto) {
    return this.rewardService.update(id, dto);
  }

  // SOFT DELETE REWARD
  @Delete(':id')
  @ApiOperation({ summary: 'Soft delete reward' })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({ status: 200 })
  async delete(@Param('id') id: string) {
    return this.rewardService.softDeleteReward(id);
  }

  // UNDO DELETE REWARD
  @Post(':id/undo-delete')
  @ApiOperation({ summary: 'Undo reward deletion (within 30 seconds)' })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({ status: 200 })
  async undoDeleteReward(@Param('id') id: string) {
    const result = await this.rewardService.undoDeleteReward(id);
    if (!result) {
      throw new BadRequestException('Cannot undo deletion. Either reward not found or undo window (30s) has expired.');
    }
    return { message: 'Reward deletion undone successfully' };
  }

  // PERMANENT DELETE REWARD
  @Delete(':id/permanent')
  @ApiOperation({ summary: 'Permanently delete reward' })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({ status: 200 })
  async permanentDeleteReward(@Param('id') id: string) {
    return this.rewardService.permanentDeleteReward(id);
  }

  // --- Reward Redemption ---
  @Post('redeem')
  @ApiOperation({ summary: 'Redeem a reward for a kid' })
  @ApiBody({ type: RedeemRewardDto })
  @ApiResponse({ status: 201, type: RewardRedemptionDto })
  async redeemReward(@Body() dto: RedeemRewardDto) {
    return this.rewardService.redeemReward(dto);
  }

  @Patch('redemption/status')
  @ApiOperation({ summary: 'Update reward redemption status' })
  @ApiBody({ type: UpdateRewardRedemptionStatusDto })
  @ApiResponse({ status: 200, type: RewardRedemptionDto })
  async updateRedemptionStatus(@Body() dto: UpdateRewardRedemptionStatusDto) {
    return this.rewardService.updateRedemptionStatus(dto);
  }

  @Get('redemption/kid/:kidId')
  @ApiOperation({ summary: 'List reward redemptions for a kid' })
  @ApiParam({ name: 'kidId', type: String })
  @ApiResponse({ status: 200, type: [RewardRedemptionDto] })
  async getRedemptionsForKid(@Param('kidId') kidId: string) {
    return this.rewardService.getRedemptionsForKid(kidId);
  }

  @Get('redemption/:id')
  @ApiOperation({ summary: 'Get reward redemption by id' })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({ status: 200, type: RewardRedemptionDto })
  async getRedemptionById(@Param('id') id: string) {
    return this.rewardService.getRedemptionById(id);
  }
}
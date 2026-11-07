import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Patch,
  Delete,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiBody,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { RewardService } from './reward.service';
import {
  AuthSessionGuard,
  AuthenticatedRequest,
} from '@/shared/guards/auth.guard';
import { AccessControlService } from '@/shared/access/access-control.service';
import {
  CreateRewardDto,
  UpdateRewardDto,
  RewardDto,
  RedeemRewardDto,
  UpdateRewardRedemptionStatusDto,
  RewardRedemptionDto,
} from './dto/reward.dto';

@ApiTags('rewards')
@Controller('rewards')
@UseGuards(AuthSessionGuard)
@ApiBearerAuth()
export class RewardController {
  constructor(
    private readonly rewardService: RewardService,
    private readonly accessControl: AccessControlService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create reward' })
  @ApiBody({ type: CreateRewardDto })
  @ApiResponse({ status: 201, type: RewardDto })
  async create(@Body() dto: CreateRewardDto, @Req() req: AuthenticatedRequest) {
    await this.accessControl.assertKidAccess(req.authUserData, dto.kidId);
    return this.rewardService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List all rewards' })
  @ApiResponse({ status: 200, type: [RewardDto] })
  async findAll(@Req() req: AuthenticatedRequest) {
    this.accessControl.assertAdmin(req.authUserData);
    return this.rewardService.findAll();
  }

  @Get('kid/:kidId')
  @ApiOperation({ summary: 'List rewards for a kid' })
  @ApiParam({ name: 'kidId', type: String })
  @ApiResponse({ status: 200, type: [RewardDto] })
  async findByKid(
    @Param('kidId') kidId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    await this.accessControl.assertKidAccess(req.authUserData, kidId);
    return this.rewardService.findByKid(kidId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get reward by id' })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({ status: 200, type: RewardDto })
  async findOne(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const reward = await this.rewardService.findOne(id);
    await this.accessControl.assertOwner(req.authUserData, reward);
    return reward;
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update reward' })
  @ApiParam({ name: 'id', type: String })
  @ApiBody({ type: UpdateRewardDto })
  @ApiResponse({ status: 200, type: RewardDto })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateRewardDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const reward = await this.rewardService.findOne(id);
    await this.accessControl.assertOwner(req.authUserData, reward);
    return this.rewardService.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete reward' })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({ status: 200 })
  async delete(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const reward = await this.rewardService.findOne(id);
    await this.accessControl.assertOwner(req.authUserData, reward);
    return this.rewardService.delete(id);
  }

  // --- Reward Redemption ---
  @Post('redeem')
  @ApiOperation({ summary: 'Redeem a reward for a kid' })
  @ApiBody({ type: RedeemRewardDto })
  @ApiResponse({ status: 201, type: RewardRedemptionDto })
  async redeemReward(
    @Body() dto: RedeemRewardDto,
    @Req() req: AuthenticatedRequest,
  ) {
    await this.accessControl.assertKidAccess(req.authUserData, dto.kidId);
    return this.rewardService.redeemReward(dto);
  }

  @Patch('redemption/status')
  @ApiOperation({ summary: 'Update reward redemption status' })
  @ApiBody({ type: UpdateRewardRedemptionStatusDto })
  @ApiResponse({ status: 200, type: RewardRedemptionDto })
  async updateRedemptionStatus(
    @Body() dto: UpdateRewardRedemptionStatusDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const redemption = await this.rewardService.getRedemptionById(
      dto.redemptionId,
    );
    if (redemption) {
      await this.accessControl.assertKidAccess(
        req.authUserData,
        redemption.kidId,
      );
    }
    return this.rewardService.updateRedemptionStatus(dto);
  }

  @Get('redemption/kid/:kidId')
  @ApiOperation({ summary: 'List reward redemptions for a kid' })
  @ApiParam({ name: 'kidId', type: String })
  @ApiResponse({ status: 200, type: [RewardRedemptionDto] })
  async getRedemptionsForKid(
    @Param('kidId') kidId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    await this.accessControl.assertKidAccess(req.authUserData, kidId);
    return this.rewardService.getRedemptionsForKid(kidId);
  }

  @Get('redemption/:id')
  @ApiOperation({ summary: 'Get reward redemption by id' })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({ status: 200, type: RewardRedemptionDto })
  async getRedemptionById(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const redemption = await this.rewardService.getRedemptionById(id);
    if (redemption) {
      await this.accessControl.assertKidAccess(
        req.authUserData,
        redemption.kidId,
      );
    }
    return redemption;
  }
}

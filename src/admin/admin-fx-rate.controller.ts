import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { Admin } from './decorators/admin.decorator';
import { AdminFxRateService } from './admin-fx-rate.service';
import { AdminAuditLogService } from './admin-audit-log.service';
import { CreateFxRateDto, FxRateDto } from './dto/fx-rate.dto';
import { AuthenticatedRequest } from '@/shared/guards/auth.guard';

@ApiBearerAuth()
@Controller('admin/fx-rates')
@Admin()
@ApiTags('admin')
export class AdminFxRateController {
  constructor(
    private readonly fxRates: AdminFxRateService,
    private readonly auditLog: AdminAuditLogService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'List FX rates (USD per 1 unit of currency)',
    description:
      'Rates used to convert revenue into USD. Ordered by currency, newest effectiveFrom first. A transaction converts at the latest rate with effectiveFrom <= its date; before the earliest rate the earliest is used (flagged usedEarliestRate); a currency with no rate is reported under unconvertedCurrencies.',
  })
  @ApiQuery({ name: 'currency', required: false, example: 'NGN' })
  @ApiOkResponse({ type: [FxRateDto] })
  async list(@Query('currency') currency?: string) {
    const data = await this.fxRates.list(currency);
    return { statusCode: 200, message: 'FX rates retrieved', data };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Add an FX rate',
    description:
      'Adds a rate (USD per 1 unit of currency) effective from `effectiveFrom` (default now). Rates are append-only history: add a new row to change a rate going forward. USD is rejected; effectiveFrom more than 1 day ahead is rejected. Clears the cached dashboard stats.',
  })
  @ApiBody({ type: CreateFxRateDto })
  @ApiCreatedResponse({ type: FxRateDto })
  @ApiConflictResponse({
    description: 'A rate already exists for this currency and effectiveFrom',
  })
  async create(
    @Req() req: AuthenticatedRequest,
    @Body() body: CreateFxRateDto,
  ) {
    const data = await this.fxRates.create(body, req.authUserData.userId);
    await this.auditLog.record({
      adminId: req.authUserData.userId,
      adminEmail: req.authUserData.email,
      action: 'fx_rate.create',
      targetType: 'FxRate',
      targetId: data.id,
      details: {
        currency: data.currency,
        rateToUsd: data.rateToUsd,
        effectiveFrom: data.effectiveFrom,
      },
    });
    return { statusCode: 201, message: 'FX rate created', data };
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Delete an FX rate',
    description:
      'Removes a rate; affected transactions re-convert at the remaining rates (or become unconverted if none remain). Clears the cached dashboard stats.',
  })
  @ApiOkResponse({ type: FxRateDto })
  async remove(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    const data = await this.fxRates.remove(id);
    await this.auditLog.record({
      adminId: req.authUserData.userId,
      adminEmail: req.authUserData.email,
      action: 'fx_rate.delete',
      targetType: 'FxRate',
      targetId: data.id,
      details: {
        currency: data.currency,
        rateToUsd: data.rateToUsd,
        effectiveFrom: data.effectiveFrom,
      },
    });
    return { statusCode: 200, message: 'FX rate deleted', data };
  }
}

import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Admin } from './decorators/admin.decorator';
import { AdminAuditLogService } from './admin-audit-log.service';
import { AdminAuditLogFilterDto } from './dto/admin-audit-log.dto';
import { PaginationUtil } from '../shared/utils/pagination.util';

@ApiBearerAuth()
@Controller('admin/audit-log')
@Admin()
@ApiTags('admin')
export class AdminAuditLogController {
  constructor(private readonly adminAuditLogService: AdminAuditLogService) {}

  @Get()
  @ApiOperation({
    summary: 'List admin audit log entries (who did what, paginated)',
  })
  async list(@Query() filters: AdminAuditLogFilterDto) {
    const { page, limit } = PaginationUtil.sanitize(
      filters.page,
      filters.limit,
      100,
    );
    const result = await this.adminAuditLogService.list({
      page,
      limit,
      adminId: filters.adminId,
      action: filters.action,
      targetType: filters.targetType,
      from: filters.from,
      to: filters.to,
    });
    return {
      statusCode: 200,
      message: 'Admin audit log retrieved successfully',
      data: result.data,
      meta: result.meta,
    };
  }
}

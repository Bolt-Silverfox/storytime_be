import { applyDecorators } from '@nestjs/common';
import {
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
  ApiBearerAuth,
  ApiBody,
} from '@nestjs/swagger';

export function AdminDashboardStats() {
  return applyDecorators(
    ApiOperation({
      summary: 'Get dashboard metrics',
      description: 'Returns platform-wide KPIs',
    }),
    ApiResponse({ status: 200, description: 'Dashboard metrics' }),
    ApiBearerAuth(),
  );
}

export function AdminUserList() {
  return applyDecorators(
    ApiOperation({
      summary: 'List users',
      description: 'Paginated users with filters',
    }),
    ApiQuery({ name: 'page', required: false, type: Number }),
    ApiQuery({ name: 'limit', required: false, type: Number }),
    ApiQuery({ name: 'search', required: false, type: String }),
    ApiQuery({ name: 'role', required: false, enum: ['admin', 'parent', 'kid'] }),
    ApiResponse({ status: 200, description: 'Paginated users' }),
    ApiBearerAuth(),
  );
}

export function AdminCreateUser() {
  return applyDecorators(
    ApiOperation({
      summary: 'Create admin user',
      description: 'Creates a new admin user',
    }),
    ApiBody({ description: 'Admin user data' }),
    ApiResponse({ status: 201, description: 'Admin created' }),
    ApiBearerAuth(),
  );
}
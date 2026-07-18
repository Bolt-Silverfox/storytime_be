import { Injectable, BadRequestException } from '@nestjs/common';
import { UserFilterDto } from './dto/admin-filters.dto';
import { AdminUserService } from './admin-user.service';
import { AdminAnalyticsService } from './admin-analytics.service';

@Injectable()
export class AdminExportService {
  constructor(
    private readonly adminUserService: AdminUserService,
    private readonly adminAnalyticsService: AdminAnalyticsService,
  ) {}

  private sanitizeCsv(value: string | null | undefined): string {
    const escaped = (value || '').replace(/"/g, '""');
    if (/^[=+\-@\t\r]/.test(escaped)) {
      return `\t${escaped}`;
    }
    return escaped;
  }

  async exportUsersAsCsv(filters: UserFilterDto): Promise<string> {
    // Paginate through all matching users
    const pageSize = 1000;
    let page = 1;
    const allUsers: Record<string, unknown>[] = [];
    while (true) {
      const result = await this.adminUserService.getAllUsers({
        ...filters,
        page,
        limit: pageSize,
      });
      allUsers.push(...(result.data as Record<string, unknown>[]));
      if (result.data.length < pageSize) break;
      page++;
    }

    const headers = [
      'ID',
      'Email',
      'Name',
      'Role',
      'Email Verified',
      'Is Paid',
      'Subscription Plan',
      'Registration Date',
      'Is Deleted',
      'Is Suspended',
    ];

    const rows = allUsers.map((user) => [
      user.id,
      `"${this.sanitizeCsv(user.email as string | null | undefined)}"`,
      `"${this.sanitizeCsv(user.name as string | null | undefined)}"`,
      user.role,
      user.isEmailVerified,
      user.isPaidUser,
      (user.activeSubscription as Record<string, unknown> | null)?.plan || '',
      user.registrationDate
        ? new Date(
            user.registrationDate as string | number | Date,
          ).toISOString()
        : '',
      user.isDeleted,
      user.isSuspended || false,
    ]);

    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    return csv;
  }

  async exportAnalyticsData(
    type: 'users' | 'revenue' | 'subscriptions',
    format: 'csv' | 'json' = 'csv',
    startDate?: string,
    endDate?: string,
  ): Promise<{ data: any; contentType: string; filename: string }> {
    const dateRange = { startDate, endDate };

    let rawData: any;
    let csvContent = '';
    let filename: string;

    switch (type) {
      case 'users': {
        const growth =
          await this.adminAnalyticsService.getUserGrowth(dateRange);
        rawData = growth;
        filename = `users-analytics-${new Date().toISOString().split('T')[0]}`;
        if (format === 'csv') {
          const headers = [
            'Date',
            'New Users',
            'Paid Users',
            'Total Users',
            'Total Paid Users',
          ];
          const rows = growth.map((g) =>
            [
              g.date,
              g.newUsers,
              g.paidUsers,
              g.totalUsers,
              g.totalPaidUsers,
            ].join(','),
          );
          csvContent = [headers.join(','), ...rows].join('\n');
        }
        break;
      }
      case 'revenue': {
        const revenue =
          await this.adminAnalyticsService.getRevenueAnalytics(dateRange);
        rawData = revenue;
        filename = `revenue-analytics-${new Date().toISOString().split('T')[0]}`;
        if (format === 'csv') {
          const headers = ['Date', 'Amount'];
          const rows = revenue.dailyRevenue.map((r) =>
            [r.date, r.amount].join(','),
          );
          csvContent = [headers.join(','), ...rows].join('\n');
        }
        break;
      }
      case 'subscriptions': {
        const subs =
          await this.adminAnalyticsService.getSubscriptionAnalytics(dateRange);
        rawData = subs;
        filename = `subscriptions-analytics-${new Date().toISOString().split('T')[0]}`;
        if (format === 'csv') {
          const headers = ['Date', 'Count'];
          const rows = subs.subscriptionGrowth.map((s) =>
            [s.date, s.count].join(','),
          );
          csvContent = [headers.join(','), ...rows].join('\n');
        }
        break;
      }
      default:
        throw new BadRequestException(`Invalid export type: ${type as string}`);
    }

    if (format === 'json') {
      return {
        data: rawData,
        contentType: 'application/json',
        filename: `${filename}.json`,
      };
    }

    return {
      data: csvContent,
      contentType: 'text/csv',
      filename: `${filename}.csv`,
    };
  }
}

import {
  Injectable,
  BadRequestException,
  Logger,
  Inject,
} from '@nestjs/common';
import { AiProviders } from '@/shared/constants/ai-providers.constants';
import {
  SubscriptionAnalyticsDto,
  RevenueAnalyticsDto,
  AiCreditAnalyticsDto,
} from './dto/admin-responses.dto';
import { DateRangeDto } from './dto/admin-filters.dto';
import {
  IAdminSubscriptionRepository,
  ADMIN_SUBSCRIPTION_REPOSITORY,
  IAdminPaymentRepository,
  ADMIN_PAYMENT_REPOSITORY,
  IAdminActivityRepository,
  ADMIN_ACTIVITY_REPOSITORY,
} from './repositories';

@Injectable()
export class AdminRevenueAnalyticsService {
  private readonly logger = new Logger(AdminRevenueAnalyticsService.name);

  constructor(
    @Inject(ADMIN_SUBSCRIPTION_REPOSITORY)
    private readonly subscriptionRepo: IAdminSubscriptionRepository,
    @Inject(ADMIN_PAYMENT_REPOSITORY)
    private readonly paymentRepo: IAdminPaymentRepository,
    @Inject(ADMIN_ACTIVITY_REPOSITORY)
    private readonly activityRepo: IAdminActivityRepository,
  ) {}

  async getSubscriptionAnalytics(
    dateRange?: DateRangeDto,
  ): Promise<SubscriptionAnalyticsDto> {
    const startDate = dateRange?.startDate
      ? new Date(dateRange.startDate)
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const endDate = dateRange?.endDate
      ? new Date(dateRange.endDate)
      : new Date();

    const [subscriptions, revenue, planBreakdown] = await Promise.all([
      // Get subscription growth
      this.subscriptionRepo.groupByStartedAt(startDate, endDate),
      // Get revenue growth
      this.paymentRepo.groupRevenueByCreatedAt(startDate, endDate),
      // Get subscription plan breakdown
      this.subscriptionRepo.groupByActivePlan(new Date()),
    ]);

    // Calculate churn rate
    const churnRate = await this.calculateChurnRate(startDate, endDate);

    return {
      subscriptionGrowth: subscriptions.map((sub) => ({
        date: sub.startedAt.toISOString().split('T')[0],
        count: sub._count,
      })),
      revenueGrowth: revenue.map((rev) => ({
        date: rev.createdAt.toISOString().split('T')[0],
        amount: rev._sum.amount || 0,
      })),
      planBreakdown: planBreakdown.map((plan) => ({
        plan: plan.plan,
        count: plan._count,
      })),
      churnRate,
    };
  }

  private async calculateChurnRate(
    startDate: Date,
    endDate: Date,
  ): Promise<number> {
    const totalSubscriptionsAtStart = await this.subscriptionRepo.count({
      startedAt: { lt: startDate },
      status: 'active',
    });

    const churnedSubscriptions = await this.subscriptionRepo.count({
      OR: [
        { status: 'cancelled' },
        {
          status: 'active',
          endsAt: {
            gte: startDate,
            lte: endDate,
          },
        },
      ],
    });

    return totalSubscriptionsAtStart > 0
      ? (churnedSubscriptions / totalSubscriptionsAtStart) * 100
      : 0;
  }

  async getRevenueAnalytics(
    dateRange?: DateRangeDto,
  ): Promise<RevenueAnalyticsDto> {
    const startDate = dateRange?.startDate
      ? new Date(dateRange.startDate)
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const endDate = dateRange?.endDate
      ? new Date(dateRange.endDate)
      : new Date();

    try {
      const dailyRevenue =
        await this.paymentRepo.groupRevenueByCreatedAtOrdered(
          startDate,
          endDate,
        );

      // For monthly and yearly revenue
      const allTransactions = await this.paymentRepo.findSuccessfulInRange(
        startDate,
        endDate,
      );

      // Group by month
      const monthlyRevenueMap = new Map<string, number>();
      // Group by year
      const yearlyRevenueMap = new Map<string, number>();

      allTransactions.forEach((transaction) => {
        const date = new Date(transaction.createdAt);
        const monthKey = `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}`;
        const yearKey = date.getFullYear().toString();

        monthlyRevenueMap.set(
          monthKey,
          (monthlyRevenueMap.get(monthKey) || 0) + transaction.amount,
        );
        yearlyRevenueMap.set(
          yearKey,
          (yearlyRevenueMap.get(yearKey) || 0) + transaction.amount,
        );
      });

      const monthlyRevenue = Array.from(monthlyRevenueMap.entries()).map(
        ([month, total]) => ({
          month,
          total_amount: total,
        }),
      );

      const yearlyRevenue = Array.from(yearlyRevenueMap.entries()).map(
        ([year, total]) => ({
          year,
          total_amount: total,
        }),
      );

      // Get top plans
      const subscriptionsWithRevenue =
        await this.subscriptionRepo.findActiveWithUserRevenue();

      const planRevenueMap = new Map<
        string,
        { subscription_count: number; total_revenue: number }
      >();

      subscriptionsWithRevenue.forEach((sub) => {
        const current = planRevenueMap.get(sub.plan) || {
          subscription_count: 0,
          total_revenue: 0,
        };
        const userRevenue = sub.user.paymentTransactions.reduce(
          (sum, t) => sum + t.amount,
          0,
        );

        planRevenueMap.set(sub.plan, {
          subscription_count: current.subscription_count + 1,
          total_revenue: current.total_revenue + userRevenue,
        });
      });

      const topPlans = Array.from(planRevenueMap.entries())
        .map(([plan, stats]) => ({
          plan,
          subscription_count: stats.subscription_count,
          total_revenue: stats.total_revenue,
        }))
        .sort((a, b) => b.total_revenue - a.total_revenue)
        .slice(0, 10);

      return {
        dailyRevenue: dailyRevenue.map((day) => ({
          date: day.createdAt.toISOString().split('T')[0],
          amount: day._sum.amount || 0,
        })),
        monthlyRevenue,
        yearlyRevenue,
        topPlans,
      };
    } catch (error) {
      this.logger.error('Error getting revenue analytics:', error);
      throw new BadRequestException('Failed to get revenue analytics');
    }
  }

  async getAiCreditAnalytics(
    duration:
      | 'yearly'
      | 'quarterly'
      | 'monthly'
      | 'weekly'
      | 'daily' = 'yearly',
  ): Promise<AiCreditAnalyticsDto> {
    const now = new Date();
    let startDate: Date;
    let labels: string[];
    let getKey: (d: Date) => string;

    switch (duration) {
      case 'daily': {
        // Last 24 hours, grouped by hour (aligned to hour boundary)
        const hourAligned = new Date(now);
        hourAligned.setMinutes(0, 0, 0);
        startDate = new Date(hourAligned.getTime() - 24 * 60 * 60 * 1000);
        labels = [];
        for (let i = 0; i < 24; i++) {
          const h = new Date(startDate.getTime() + i * 60 * 60 * 1000);
          labels.push(
            h.toLocaleString('en-US', { hour: '2-digit', hour12: true }),
          );
        }
        getKey = (d: Date) =>
          d.toLocaleString('en-US', { hour: '2-digit', hour12: true });
        break;
      }
      case 'weekly': {
        // Last 7 days, grouped by day (aligned to start of day)
        const weekStart = new Date(now);
        weekStart.setHours(0, 0, 0, 0);
        startDate = new Date(weekStart.getTime() - 7 * 24 * 60 * 60 * 1000);
        labels = [];
        for (let i = 0; i < 7; i++) {
          const day = new Date(startDate.getTime() + i * 24 * 60 * 60 * 1000);
          labels.push(
            day.toLocaleString('en-US', {
              weekday: 'short',
              month: 'short',
              day: 'numeric',
            }),
          );
        }
        getKey = (d: Date) =>
          d.toLocaleString('en-US', {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
          });
        break;
      }
      case 'monthly': {
        // Last 30 days, grouped by day (aligned to start of day)
        const monthStart = new Date(now);
        monthStart.setHours(0, 0, 0, 0);
        startDate = new Date(monthStart.getTime() - 30 * 24 * 60 * 60 * 1000);
        labels = [];
        for (let i = 0; i < 30; i++) {
          const day = new Date(startDate.getTime() + i * 24 * 60 * 60 * 1000);
          labels.push(
            day.toLocaleString('en-US', { month: 'short', day: 'numeric' }),
          );
        }
        getKey = (d: Date) =>
          d.toLocaleString('en-US', { month: 'short', day: 'numeric' });
        break;
      }
      case 'quarterly': {
        // Current year grouped by quarter
        startDate = new Date(now.getFullYear(), 0, 1);
        labels = ['Q1', 'Q2', 'Q3', 'Q4'];
        getKey = (d: Date) => {
          const q = Math.floor(d.getMonth() / 3) + 1;
          return `Q${q}`;
        };
        break;
      }
      case 'yearly':
      default: {
        // 12 months of current year
        startDate = new Date(now.getFullYear(), 0, 1);
        labels = [
          'Jan',
          'Feb',
          'Mar',
          'Apr',
          'May',
          'Jun',
          'Jul',
          'Aug',
          'Sep',
          'Oct',
          'Nov',
          'Dec',
        ];
        getKey = (d: Date) => d.toLocaleString('en-US', { month: 'short' });
        break;
      }
    }

    const logs = await this.activityRepo.findAiGenerationLogs(startDate);

    // Initialize map
    const dataMap = new Map<
      string,
      { elevenLabs: number; gemini: number; total: number }
    >();
    labels.forEach((label) => {
      dataMap.set(label, { elevenLabs: 0, gemini: 0, total: 0 });
    });

    logs.forEach((log) => {
      const key = getKey(log.createdAt);
      if (!dataMap.has(key)) return;

      let credits = 1;
      let provider = '';
      try {
        const details = JSON.parse(log.details || '{}');
        credits = details.credits || 1;
        provider = details.provider || '';
      } catch {
        // Fallback
      }

      const entry = dataMap.get(key)!;
      if (provider === String(AiProviders.ElevenLabs))
        entry.elevenLabs += credits;
      if (provider === String(AiProviders.Gemini)) entry.gemini += credits;
      entry.total += credits;
    });

    const yearly = labels.map((label) => ({
      label,
      month: label,
      ...dataMap.get(label)!,
    }));

    return { yearly };
  }
}

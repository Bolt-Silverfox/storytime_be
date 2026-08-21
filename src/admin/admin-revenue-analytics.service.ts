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

  // A date-only endDate ('2026-07-31') parses to midnight UTC, which would
  // silently exclude everything that happened later that day from `lte`
  // filters. Treat day-level input as inclusive through the end of that day
  // (.999 is the max millisecond Prisma DateTime can store); explicit
  // timestamps pass through unchanged.
  private static parseInclusiveEndDate(value: string): Date {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return new Date(`${value}T23:59:59.999Z`);
    }
    return new Date(value);
  }

  async getSubscriptionAnalytics(
    dateRange?: DateRangeDto,
  ): Promise<SubscriptionAnalyticsDto> {
    const startDate = dateRange?.startDate
      ? new Date(dateRange.startDate)
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const endDate = dateRange?.endDate
      ? AdminRevenueAnalyticsService.parseInclusiveEndDate(dateRange.endDate)
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

  // Period-scoped churn: of the subscribers who had access at the START of the
  // window, what fraction lost it DURING the window.
  //
  // The previous version counted EVERY cancelled subscription ever (unscoped) in
  // the numerator while the denominator only counted currently-active subs, so
  // the ratio routinely exceeded 100%. Both terms are now scoped to the window
  // via `endsAt`, and the numerator is a strict subset of the denominator (both
  // require startedAt < startDate; the numerator additionally requires endsAt in
  // [start, end], which satisfies the denominator's endsAt >= start), so the
  // result is always in [0, 100].
  private async calculateChurnRate(
    startDate: Date,
    endDate: Date,
  ): Promise<number> {
    // Base: had access at the start of the window (started before it and either
    // never ended or ended on/after the window start).
    const totalSubscriptionsAtStart = await this.subscriptionRepo.count({
      startedAt: { lt: startDate },
      OR: [{ endsAt: null }, { endsAt: { gte: startDate } }],
    });

    // Churned within the window: from that base, cancelled subs whose access
    // actually ended inside [startDate, endDate]. Requiring status 'cancelled'
    // avoids miscounting active auto-renewing subs whose endsAt (current period
    // boundary) happens to fall in the window.
    const churnedSubscriptions = await this.subscriptionRepo.count({
      startedAt: { lt: startDate },
      status: 'cancelled',
      endsAt: {
        gte: startDate,
        lte: endDate,
      },
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
      ? AdminRevenueAnalyticsService.parseInclusiveEndDate(dateRange.endDate)
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

      // Top plans: attribute each payment to the plan it was actually for
      // (summed DB-side), and pair it with the number of currently-active
      // subscriptions on that plan. The old version summed every active
      // subscriber's entire lifetime spend and charged it all to their current
      // plan — so an upgrader's past-plan revenue was misattributed, and the
      // whole payment history was loaded into memory.
      const [revenueByPlan, activePlanCounts] = await Promise.all([
        this.paymentRepo.groupRevenueByPlan(),
        this.subscriptionRepo.groupByActivePlan(new Date()),
      ]);

      const planRevenueMap = new Map<
        string,
        { subscription_count: number; total_revenue: number }
      >();
      const bumpPlan = (
        plan: string,
        revenue: number,
        subscriptions: number,
      ) => {
        const current = planRevenueMap.get(plan) || {
          subscription_count: 0,
          total_revenue: 0,
        };
        planRevenueMap.set(plan, {
          subscription_count: current.subscription_count + subscriptions,
          total_revenue: current.total_revenue + revenue,
        });
      };

      // Revenue per plan; historical rows we couldn't attribute land in 'unknown'.
      for (const row of revenueByPlan) {
        bumpPlan(row.plan ?? 'unknown', row._sum.amount ?? 0, 0);
      }
      // Active-subscription counts per plan (plans may have revenue but no
      // active subs left, or vice versa, so this is a union).
      for (const row of activePlanCounts) {
        bumpPlan(row.plan, 0, row._count);
      }

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

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
import {
  bucketConvertedRevenue,
  summarizeConvertedRevenue,
  ConvertibleEntry,
} from './utils/fx-conversion.util';
import { AdminFxRateService } from './admin-fx-rate.service';
import {
  COMPLIMENTARY_SUBSCRIPTION_WHERE,
  PAYING_SUBSCRIPTION_WHERE,
  SUBSCRIPTION_SOURCE,
} from '../subscription/subscription.constants';

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
    private readonly fxRates: AdminFxRateService,
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

    const now = new Date();
    const [
      subscriptions,
      payingGrowth,
      revenueRows,
      planBreakdown,
      payingPlans,
      complimentaryPlans,
      activeBySource,
    ] = await Promise.all([
      // Get subscription growth (all new access, paying + complimentary)
      this.subscriptionRepo.groupByStartedAt(startDate, endDate),
      // New real (store) subscriptions only
      this.subscriptionRepo.groupByStartedAt(
        startDate,
        endDate,
        PAYING_SUBSCRIPTION_WHERE,
      ),
      // Revenue growth source rows (real succeeded transactions only)
      this.paymentRepo.findSuccessfulInRange(startDate, endDate),
      // Plan breakdown of ALL active access (paying + complimentary)
      this.subscriptionRepo.groupByActivePlan(now),
      this.subscriptionRepo.groupByActivePlan(now, PAYING_SUBSCRIPTION_WHERE),
      this.subscriptionRepo.groupByActivePlan(
        now,
        COMPLIMENTARY_SUBSCRIPTION_WHERE,
      ),
      this.subscriptionRepo.groupByActiveSource(now),
    ]);
    const fxTable = await this.fxRates.getRateTable();
    const revenueByDay = bucketConvertedRevenue(
      revenueRows,
      (row) => row.createdAt.toISOString().slice(0, 10),
      fxTable,
    );

    const toPlanCounts = (rows: { plan: string; _count: number }[]) =>
      rows.map((p) => ({ plan: p.plan, count: p._count }));
    const sumCounts = (rows: { _count: number }[]) =>
      rows.reduce((total, r) => total + r._count, 0);

    // Calculate churn rate (paying subscriptions only)
    const churnRate = await this.calculateChurnRate(startDate, endDate);

    return {
      subscriptionGrowth: subscriptions.map((sub) => ({
        date: sub.startedAt.toISOString().split('T')[0],
        count: sub._count,
      })),
      // Per-day revenue: `amount` is the USD-converted total (each transaction
      // at the rate effective on its own date); `byCurrency` keeps the original
      // per-currency figures.
      revenueGrowth: [...revenueByDay.entries()]
        .sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0))
        .map(([date, day]) => ({
          date,
          amount: day.amount,
          byCurrency: day.byCurrency,
          unconvertedByCurrency: day.unconvertedByCurrency,
        })),
      planBreakdown: toPlanCounts(planBreakdown),
      churnRate,
      paying: {
        activeSubscriptions: sumCounts(payingPlans),
        planBreakdown: toPlanCounts(payingPlans),
        subscriptionGrowth: payingGrowth.map((sub) => ({
          date: sub.startedAt.toISOString().split('T')[0],
          count: sub._count,
        })),
      },
      complimentary: {
        activeSubscriptions: sumCounts(complimentaryPlans),
        planBreakdown: toPlanCounts(complimentaryPlans),
        bySource: activeBySource
          .filter((row) => row.source !== SUBSCRIPTION_SOURCE.STORE)
          .map((row) => ({ source: row.source, count: row._count })),
      },
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
      ...PAYING_SUBSCRIPTION_WHERE,
      startedAt: { lt: startDate },
      OR: [{ endsAt: null }, { endsAt: { gte: startDate } }],
    });

    // Churned within the window: from that base, cancelled subs whose access
    // actually ended inside [startDate, endDate]. Requiring status 'cancelled'
    // avoids miscounting active auto-renewing subs whose endsAt (current period
    // boundary) happens to fall in the window.
    const churnedSubscriptions = await this.subscriptionRepo.count({
      ...PAYING_SUBSCRIPTION_WHERE,
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
      // One query for the range; daily / monthly / yearly / total are all
      // derived from the same rows with the same rates, so they cannot disagree.
      const [allTransactions, fxTable] = await Promise.all([
        this.paymentRepo.findSuccessfulInRange(startDate, endDate),
        this.fxRates.getRateTable(),
      ]);

      const dayKey = (t: { createdAt: Date }) =>
        t.createdAt.toISOString().slice(0, 10);
      const monthKey = (t: { createdAt: Date }) => {
        const date = new Date(t.createdAt);
        return `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}`;
      };
      const yearKey = (t: { createdAt: Date }) =>
        new Date(t.createdAt).getFullYear().toString();

      const series = (key: (t: { createdAt: Date }) => string) =>
        [...bucketConvertedRevenue(allTransactions, key, fxTable).entries()]
          .sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0))
          .map(([k, b]) => ({
            key: k,
            amount: b.amount,
            byCurrency: b.byCurrency,
            unconvertedByCurrency: b.unconvertedByCurrency,
          }));
      const dailyRevenue = series(dayKey).map(({ key, ...rest }) => ({
        date: key,
        ...rest,
      }));
      const monthlyRevenue = series(monthKey).map(
        ({ key, amount, ...rest }) => ({
          month: key,
          total_amount: amount,
          ...rest,
        }),
      );
      const yearlyRevenue = series(yearKey).map(({ key, amount, ...rest }) => ({
        year: key,
        total_amount: amount,
        ...rest,
      }));

      // Scope totals (the requested date range), converted to USD.
      const summary = summarizeConvertedRevenue(
        allTransactions.map((t) => ({
          currency: t.currency,
          amount: t.amount,
          count: 1,
          rate: fxTable.resolve(t.currency, t.createdAt),
        })),
      );

      // Top plans: attribute each payment to the plan it was actually for
      // (summed DB-side), and pair it with the number of currently-active
      // subscriptions on that plan. The old version summed every active
      // subscriber's entire lifetime spend and charged it all to their current
      // plan — so an upgrader's past-plan revenue was misattributed, and the
      // whole payment history was loaded into memory.
      const [revenueByPlan, activePlanCounts] = await Promise.all([
        this.paymentRepo.groupRevenueByPlan(),
        // Paying subscriptions only: comped access earns no revenue and must not
        // inflate a plan's subscriber count next to its revenue.
        this.subscriptionRepo.groupByActivePlan(
          new Date(),
          PAYING_SUBSCRIPTION_WHERE,
        ),
      ]);

      const planRevenueMap = new Map<
        string,
        { subscription_count: number; entries: ConvertibleEntry[] }
      >();
      const planEntry = (plan: string) => {
        const current = planRevenueMap.get(plan) ?? {
          subscription_count: 0,
          entries: [],
        };
        planRevenueMap.set(plan, current);
        return current;
      };

      // Revenue per (plan, currency, applied rate); historical rows we couldn't
      // attribute land in 'unknown'.
      for (const row of revenueByPlan) {
        planEntry(row.plan ?? 'unknown').entries.push({
          currency: row.currency,
          amount: row.amount,
          count: row.count,
          rate: row.rate,
        });
      }
      // Active-subscription counts per plan (plans may have revenue but no
      // active subs left, or vice versa, so this is a union).
      for (const row of activePlanCounts) {
        planEntry(row.plan).subscription_count += row._count;
      }

      const toTotals = (items: { currency: string; total: number }[]) =>
        Object.fromEntries(items.map((i) => [i.currency, i.total]));

      const topPlans = Array.from(planRevenueMap.entries())
        .map(([plan, stats]) => {
          const converted = summarizeConvertedRevenue(stats.entries);
          return {
            plan,
            subscription_count: stats.subscription_count,
            total_revenue: converted.totalRevenue,
            byCurrency: toTotals(converted.revenueByCurrency),
            unconvertedByCurrency: toTotals(converted.unconvertedCurrencies),
            transactions: stats.entries.reduce((n, e) => n + e.count, 0),
          };
        })
        // Converted revenue is comparable across plans; ties by transactions.
        .sort(
          (a, b) =>
            b.total_revenue - a.total_revenue ||
            b.transactions - a.transactions,
        )
        .slice(0, 10);

      return {
        baseCurrency: summary.baseCurrency,
        totalRevenue: summary.totalRevenue,
        mixedCurrencies: summary.mixedCurrencies,
        revenueByCurrency: summary.revenueByCurrency,
        convertedRevenueByCurrency: summary.convertedRevenueByCurrency,
        unconvertedCurrencies: summary.unconvertedCurrencies,
        hasUnconvertedRevenue: summary.hasUnconvertedRevenue,
        usedEarliestRate: summary.usedEarliestRate,
        dailyRevenue,
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
      'yearly' | 'quarterly' | 'monthly' | 'weekly' | 'daily' = 'yearly',
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

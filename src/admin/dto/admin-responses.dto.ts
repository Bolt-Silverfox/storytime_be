import { ApiProperty } from '@nestjs/swagger';

// Nested type definitions for DTOs
export class ProfileInfo {
  @ApiProperty({ example: 'profile-123' })
  id: string;

  @ApiProperty({ example: false, required: false })
  explicitContent?: boolean;

  @ApiProperty({ example: 120, required: false, nullable: true })
  maxScreenTimeMins?: number | null;

  @ApiProperty({ example: 'english', required: false, nullable: true })
  language?: string | null;

  @ApiProperty({ example: 'US', required: false })
  country?: string;

  @ApiProperty({ example: '2023-10-01T12:00:00Z' })
  createdAt: Date;

  @ApiProperty({ example: '2023-10-15T10:30:00Z' })
  updatedAt: Date;
}

export class AvatarInfo {
  @ApiProperty({ example: 'avatar-123' })
  id: string;

  @ApiProperty({ example: 'Default Avatar', required: false, nullable: true })
  name?: string | null;

  @ApiProperty({ example: 'https://example.com/avatar.png' })
  url: string;

  @ApiProperty({ example: true, required: false })
  isSystemAvatar?: boolean;

  @ApiProperty({ example: 'cloudinary-id', required: false, nullable: true })
  publicId?: string | null;

  @ApiProperty({ example: '2023-10-01T12:00:00Z', required: false })
  createdAt?: Date;
}

export class KidInfo {
  @ApiProperty({ example: 'kid-123' })
  id: string;

  @ApiProperty({ example: 'Emma Doe', nullable: true })
  name: string | null;

  @ApiProperty({ example: '6-8', required: false, nullable: true })
  ageRange?: string | null;

  @ApiProperty({ example: '2023-10-05T12:00:00Z' })
  createdAt: Date;

  @ApiProperty({ type: () => AvatarInfo, required: false, nullable: true })
  avatar?: AvatarInfo | null;
}

export class SubscriptionInfo {
  @ApiProperty({ example: 'sub-123' })
  id: string;

  @ApiProperty({ example: 'monthly' })
  plan: string;

  @ApiProperty({ example: 'active' })
  status: string;

  @ApiProperty({ example: '2023-10-01T12:00:00Z' })
  startedAt: Date;

  @ApiProperty({
    example: '2023-11-01T12:00:00Z',
    required: false,
    nullable: true,
  })
  endsAt?: Date | null;
}

export class PaymentTransactionInfo {
  @ApiProperty({ example: 'txn-123' })
  id: string;

  @ApiProperty({ example: 10.0 })
  amount: number;

  @ApiProperty({ example: 'USD' })
  currency: string;

  @ApiProperty({ example: 'success' })
  status: string;

  @ApiProperty({ example: '2023-10-01T12:00:00Z' })
  createdAt: Date;
}

export class StoryImageInfo {
  @ApiProperty({ example: 'img-123' })
  id: string;

  @ApiProperty({ example: 'https://example.com/story.png' })
  url: string;

  @ApiProperty({
    example: 'Story cover image',
    required: false,
    nullable: true,
  })
  caption?: string | null;
}

export class CategoryInfo {
  @ApiProperty({ example: 'cat-123' })
  id: string;

  @ApiProperty({ example: 'Adventure' })
  name: string;
}

export class ThemeInfo {
  @ApiProperty({ example: 'theme-123' })
  id: string;

  @ApiProperty({ example: 'Courage' })
  name: string;
}

export class StoryBranchInfo {
  @ApiProperty({ example: 'branch-123' })
  id: string;

  @ApiProperty({
    example: 'What happens next?',
    required: false,
    nullable: true,
  })
  prompt?: string | null;

  @ApiProperty({ example: 'Go left', required: false, nullable: true })
  optionA?: string | null;

  @ApiProperty({ example: 'Go right', required: false, nullable: true })
  optionB?: string | null;

  @ApiProperty({ example: 'next-branch-a', required: false, nullable: true })
  nextA?: string | null;

  @ApiProperty({ example: 'next-branch-b', required: false, nullable: true })
  nextB?: string | null;
}

export class StoryQuestionInfo {
  @ApiProperty({ example: 'q-123' })
  id: string;

  @ApiProperty({ example: 'What color was the dragon?' })
  question: string;

  @ApiProperty({ example: ['Red', 'Green', 'Blue'] })
  options: string[];

  @ApiProperty({ example: 0 })
  correctOption: number;
}

export class UserBasicInfo {
  @ApiProperty({ example: 'user-123' })
  id: string;

  @ApiProperty({ example: 'parent@example.com' })
  email: string;

  @ApiProperty({ example: 'John Doe', required: false, nullable: true })
  name?: string | null;
}

// Base response interface
export class ApiResponseDto<T> {
  @ApiProperty({ description: 'HTTP status code', example: 200 })
  statusCode: number;

  @ApiProperty({ description: 'Response message', example: 'Success' })
  message: string;

  @ApiProperty({ description: 'Response data' })
  data: T;
}

export class PaginatedApiResponseDto<T> extends ApiResponseDto<T[]> {
  @ApiProperty({ description: 'Pagination metadata' })
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export class AnalyticsMetricDto {
  @ApiProperty({ example: 2420 })
  count: number;

  @ApiProperty({ example: 12.5 })
  trendPercent: number;

  @ApiProperty({ example: 'vs last month' })
  timeframe: string;
}

/**
 * Revenue in ONE currency. Amounts of different currencies are never added
 * together and no FX conversion is ever applied.
 */
export class RevenueByCurrencyDto {
  @ApiProperty({
    description:
      'ISO currency code, upper-cased. Transactions with no currency are grouped under "UNKNOWN".',
    example: 'NGN',
  })
  currency: string;

  @ApiProperty({
    description: 'Sum of succeeded transactions in this currency',
    example: 25000,
  })
  total: number;

  @ApiProperty({
    description: 'Number of succeeded transactions in this currency',
    example: 5,
  })
  transactions: number;
}

export class MetricWithTrendDto {
  @ApiProperty({
    description:
      'Current value. null only for totalRevenue when revenue spans several currencies (see revenueByCurrency).',
    nullable: true,
    type: Number,
  })
  value: number | null;

  @ApiProperty({ description: 'Trend percentage vs previous period' })
  trend: number;

  @ApiProperty({
    description: 'Trend direction',
    enum: ['up', 'down', 'neutral'],
  })
  direction: 'up' | 'down' | 'neutral';

  @ApiProperty({
    description: 'Timeframe comparison label',
    example: 'vs last month',
  })
  timeframe: string;
}

// Dashboard Statistics DTO
export class DashboardStatsDto {
  @ApiProperty({ description: 'Total number of users', example: 1250 })
  totalUsers: number;

  @ApiProperty({ description: 'Total number of parent users', example: 800 })
  totalParents: number;

  @ApiProperty({ description: 'Total number of kid profiles', example: 450 })
  totalKids: number;

  @ApiProperty({ description: 'Total number of admin users', example: 5 })
  totalAdmins: number;

  @ApiProperty({ description: 'Total number of stories', example: 325 })
  totalStories: number;

  @ApiProperty({ description: 'Total number of categories', example: 20 })
  totalCategories: number;

  @ApiProperty({ description: 'Total number of themes', example: 18 })
  totalThemes: number;

  @ApiProperty({ description: 'Active users in last 24 hours', example: 120 })
  activeUsers24h: number;

  @ApiProperty({ description: 'Active users in last 7 days', example: 350 })
  activeUsers7d: number;

  @ApiProperty({ description: 'New users registered today', example: 15 })
  newUsersToday: number;

  @ApiProperty({ description: 'New users registered this week', example: 85 })
  newUsersThisWeek: number;

  @ApiProperty({ description: 'New users registered this month', example: 220 })
  newUsersThisMonth: number;

  @ApiProperty({ description: 'Total story views/progress', example: 12500 })
  totalStoryViews: number;

  @ApiProperty({ description: 'Total favorites', example: 2300 })
  totalFavorites: number;

  @ApiProperty({
    description: 'Average session time in minutes',
    example: 15,
    required: false,
  })
  averageSessionTime?: number;

  // Subscription metrics
  @ApiProperty({
    description:
      'Number of PAYING users: active subscription with source=store (real store purchase). Complimentary access (admin grants, coupons, trials) is NOT counted here; see complimentaryUsers. Changed from "any active subscription".',
    example: 170,
  })
  paidUsers: number;

  @ApiProperty({
    description:
      'Number of users with active COMPLIMENTARY access (active subscription whose source is not store, e.g. admin_grant). They have full access but are not paying customers.',
    example: 10,
  })
  complimentaryUsers: number;

  @ApiProperty({
    description:
      'Number of users with NO active subscription (total users - paidUsers - complimentaryUsers). Unchanged meaning: users without paid access.',
    example: 1070,
  })
  unpaidUsers: number;

  @ApiProperty({
    description: 'Total number of subscriptions ever created (all sources)',
    example: 200,
  })
  totalSubscriptions: number;

  @ApiProperty({
    description:
      'Number of active subscriptions = everyone with paid ACCESS (paying + complimentary). Unchanged; equals payingSubscriptions + complimentarySubscriptions.',
    example: 180,
  })
  activeSubscriptions: number;

  @ApiProperty({
    description: 'Active subscriptions with source=store (paying customers)',
    example: 170,
  })
  payingSubscriptions: number;

  @ApiProperty({
    description:
      'Active subscriptions with a non-store source (complimentary access)',
    example: 10,
  })
  complimentarySubscriptions: number;

  @ApiProperty({
    description:
      'Subscription plan breakdown of ALL active access (paying + complimentary). Use dashboard/subscription-analytics for the paying/complimentary split.',
    example: [
      { plan: 'monthly', count: 120 },
      { plan: 'yearly', count: 60 },
      { plan: 'family', count: 20 },
    ],
  })
  subscriptionPlans: Array<{
    plan: string;
    count: number;
  }>;

  @ApiProperty({
    description:
      'Total revenue (all time): sum of succeeded payment transactions (real store purchases only; complimentary grants create no transaction). The plain sum ONLY when every succeeded transaction shares one currency (0 when there are none); null when several currencies are present, because amounts of different currencies are never added together and no FX conversion is applied. Use revenueByCurrency for the real figures.',
    example: 12500.5,
    nullable: true,
    type: Number,
  })
  totalRevenue: number | null;

  @ApiProperty({
    description:
      'True when succeeded transactions span more than one currency (totalRevenue is then null).',
    example: false,
  })
  mixedCurrencies: boolean;

  @ApiProperty({
    description:
      'All-time succeeded revenue per currency, largest total first. Null/missing currency is grouped under "UNKNOWN".',
    type: [RevenueByCurrencyDto],
    example: [{ currency: 'USD', total: 12500.5, transactions: 240 }],
  })
  revenueByCurrency: RevenueByCurrencyDto[];

  @ApiProperty({
    description:
      'Conversion rate: paying users (source=store) / total users, percent. Complimentary access is excluded.',
    example: 14.4,
  })
  conversionRate: number;

  @ApiProperty({ description: 'Key performance indicators with trends' })
  performanceMetrics: {
    // User Metrics
    totalUsers: MetricWithTrendDto;
    totalParents: MetricWithTrendDto;
    totalKids: MetricWithTrendDto;
    totalAdmins: MetricWithTrendDto;

    // Engagement Metrics
    activeUsers24h: MetricWithTrendDto;
    activeUsers7d: MetricWithTrendDto;
    activeUsers30d: MetricWithTrendDto;
    newUsers: MetricWithTrendDto; // This month
    averageSessionTime: MetricWithTrendDto;
    totalStoryViews: MetricWithTrendDto;
    totalFavorites: MetricWithTrendDto;

    // Content Metrics
    totalStories: MetricWithTrendDto;
    totalCategories: MetricWithTrendDto;
    totalThemes: MetricWithTrendDto;

    // Revenue & Subscription Metrics
    totalRevenue: MetricWithTrendDto;
    totalSubscriptions: MetricWithTrendDto;
    activeSubscriptions: MetricWithTrendDto;
    paidUsers: MetricWithTrendDto;
    unpaidUsers: MetricWithTrendDto;
    conversionRate: MetricWithTrendDto;
  };
}

export class UserGrowthDto {
  @ApiProperty({ description: 'Date', example: '2023-10-01' })
  date: string;

  @ApiProperty({
    description: 'New users registered on this date',
    example: 10,
  })
  newUsers: number;

  @ApiProperty({
    description:
      'New PAYING users registered on this date (active subscription, source=store)',
    example: 2,
  })
  paidUsers: number;

  @ApiProperty({
    description:
      'New users registered on this date holding active COMPLIMENTARY access (non-store source)',
    example: 1,
  })
  complimentaryUsers: number;

  @ApiProperty({
    description: 'Cumulative total users up to this date',
    example: 1000,
  })
  totalUsers: number;

  @ApiProperty({
    description:
      'Cumulative total PAYING users up to this date (source=store only)',
    example: 150,
  })
  totalPaidUsers: number;

  @ApiProperty({
    description: 'Cumulative total users with complimentary access',
    example: 8,
  })
  totalComplimentaryUsers: number;
}

export class StoryStatsDto {
  @ApiProperty({ description: 'Total number of stories', example: 325 })
  totalStories: number;

  @ApiProperty({ description: 'Number of published stories', example: 325 })
  publishedStories: number;

  @ApiProperty({ description: 'Number of draft stories', example: 0 })
  draftStories: number;

  @ApiProperty({ description: 'Number of AI-generated stories', example: 150 })
  aiGeneratedStories: number;

  @ApiProperty({ description: 'Number of recommended stories', example: 75 })
  recommendedStories: number;

  @ApiProperty({ description: 'Number of deleted stories', example: 15 })
  deletedStories: number;

  @ApiProperty({ description: 'Total story views', example: 12500 })
  totalViews: number;

  @ApiProperty({ description: 'Total favorites', example: 2300 })
  totalFavorites: number;

  @ApiProperty({ description: 'Average rating', example: 4.5, required: false })
  averageRating?: number;
}

export class ContentBreakdownDto {
  @ApiProperty({
    description: 'Breakdown by language',
    example: [
      { language: 'English', count: 250 },
      { language: 'Spanish', count: 50 },
      { language: 'French', count: 25 },
    ],
  })
  byLanguage: { language: string; count: number }[];

  @ApiProperty({
    description: 'Breakdown by age group',
    example: [
      { ageRange: '3-5', count: 100 },
      { ageRange: '6-8', count: 150 },
      { ageRange: '9-12', count: 75 },
    ],
  })
  byAgeGroup: { ageRange: string; count: number }[];

  @ApiProperty({
    description: 'Breakdown by category',
    example: [
      { categoryName: 'Animal Stories', count: 80 },
      { categoryName: 'Adventure & Action', count: 70 },
      { categoryName: 'Bedtime Stories', count: 60 },
    ],
  })
  byCategory: { categoryName: string; count: number }[];

  @ApiProperty({
    description: 'Breakdown by theme',
    example: [
      { themeName: 'Adventure', count: 120 },
      { themeName: 'Friendship', count: 90 },
      { themeName: 'Courage', count: 70 },
    ],
  })
  byTheme: { themeName: string; count: number }[];
}

export class SystemHealthDto {
  @ApiProperty({
    enum: ['healthy', 'degraded', 'down'],
    example: 'healthy',
  })
  status: 'healthy' | 'degraded' | 'down';

  @ApiProperty({
    description: 'Database connection status',
    example: {
      connected: true,
      responseTime: 45,
    },
  })
  database: {
    connected: boolean;
    responseTime?: number;
  };

  @ApiProperty({ description: 'System uptime in seconds', example: 86400 })
  uptime: number;

  @ApiProperty({
    description: 'Memory usage statistics',
    example: {
      used: 512,
      total: 1024,
      percentage: 50,
    },
  })
  memoryUsage: {
    used: number;
    total: number;
    percentage: number;
  };

  @ApiProperty({
    description: 'Timestamp of health check',
    example: '2023-10-15T10:30:00Z',
  })
  timestamp: Date;
}

export class PaginatedResponseDto<T> {
  @ApiProperty({ description: 'Array of data items' })
  data: T[];

  @ApiProperty({
    description: 'Pagination metadata',
    example: {
      total: 1250,
      page: 1,
      limit: 10,
      totalPages: 125,
    },
  })
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export class SubscriptionAnalyticsDto {
  @ApiProperty({
    description:
      'New subscriptions per day, ALL sources (paying + complimentary). See paying.subscriptionGrowth for real purchases only.',
    example: [
      { date: '2023-10-01', count: 5 },
      { date: '2023-10-02', count: 3 },
    ],
  })
  subscriptionGrowth: Array<{
    date: string;
    count: number;
  }>;

  @ApiProperty({
    description:
      'Revenue per day from succeeded payment transactions (real purchases only; comped access creates none). `amount` is the day total only when that day is single-currency, otherwise null; `byCurrency` always carries the per-currency figures. Currencies are never summed together.',
    example: [
      { date: '2023-10-01', amount: 500, byCurrency: { USD: 500 } },
      {
        date: '2023-10-02',
        amount: null,
        byCurrency: { NGN: 25000, USD: 5 },
      },
    ],
  })
  revenueGrowth: Array<{
    date: string;
    amount: number | null;
    byCurrency: Record<string, number>;
  }>;

  @ApiProperty({
    description:
      'Plan breakdown of ALL active access (paying + complimentary). Unchanged; see paying / complimentary for the split.',
    example: [
      { plan: 'monthly', count: 120 },
      { plan: 'yearly', count: 60 },
      { plan: 'family', count: 20 },
    ],
  })
  planBreakdown: Array<{
    plan: string;
    count: number;
  }>;

  @ApiProperty({
    description:
      'Churn rate percentage over PAYING subscriptions only (source=store); expiring complimentary access is not churn',
    example: 2.5,
  })
  churnRate: number;

  @ApiProperty({
    description:
      'Paying (source=store) breakdown: active count, plan breakdown and new-subscription growth. Additive.',
    example: {
      activeSubscriptions: 180,
      planBreakdown: [{ plan: 'monthly', count: 120 }],
      subscriptionGrowth: [{ date: '2023-10-01', count: 4 }],
    },
  })
  paying: {
    activeSubscriptions: number;
    planBreakdown: Array<{ plan: string; count: number }>;
    subscriptionGrowth: Array<{ date: string; count: number }>;
  };

  @ApiProperty({
    description:
      'Complimentary (non-store source) breakdown: active count, plan breakdown and count per source. Additive.',
    example: {
      activeSubscriptions: 10,
      planBreakdown: [{ plan: 'yearly', count: 10 }],
      bySource: [{ source: 'admin_grant', count: 10 }],
    },
  })
  complimentary: {
    activeSubscriptions: number;
    planBreakdown: Array<{ plan: string; count: number }>;
    bySource: Array<{ source: string; count: number }>;
  };
}

export class RevenueAnalyticsDto {
  @ApiProperty({
    description:
      'Total revenue of succeeded transactions in the requested date range. The plain sum ONLY when every succeeded transaction in scope shares one currency (0 when there are none); null when several currencies are present. Amounts of different currencies are never added together and no FX conversion is applied: use revenueByCurrency.',
    example: null,
    nullable: true,
    type: Number,
  })
  totalRevenue: number | null;

  @ApiProperty({
    description:
      'True when succeeded transactions in scope span more than one currency (totalRevenue is then null).',
    example: true,
  })
  mixedCurrencies: boolean;

  @ApiProperty({
    description:
      'Succeeded revenue in the requested range per currency, largest total first. Null/missing currency is grouped under "UNKNOWN".',
    type: [RevenueByCurrencyDto],
    example: [
      { currency: 'NGN', total: 25000, transactions: 5 },
      { currency: 'USD', total: 52.98, transactions: 3 },
    ],
  })
  revenueByCurrency: RevenueByCurrencyDto[];

  @ApiProperty({
    description:
      'Daily revenue. `amount` is populated only when that day is single-currency, otherwise null; `byCurrency` always carries the per-currency totals.',
    example: [
      { date: '2023-10-01', amount: 500, byCurrency: { USD: 500 } },
      {
        date: '2023-10-02',
        amount: null,
        byCurrency: { NGN: 25000, USD: 5 },
      },
    ],
  })
  dailyRevenue: Array<{
    date: string;
    amount: number | null;
    byCurrency: Record<string, number>;
  }>;

  @ApiProperty({
    description:
      'Monthly revenue; `total_amount` is null when the month mixes currencies (see `byCurrency`).',
    example: [
      { month: '2023-10', total_amount: 12500, byCurrency: { USD: 12500 } },
    ],
  })
  monthlyRevenue: Array<{
    month: string;
    total_amount: number | null;
    byCurrency: Record<string, number>;
  }>;

  @ApiProperty({
    description:
      'Yearly revenue; `total_amount` is null when the year mixes currencies (see `byCurrency`).',
    example: [
      { year: '2023', total_amount: 85000, byCurrency: { USD: 85000 } },
    ],
  })
  yearlyRevenue: Array<{
    year: string;
    total_amount: number | null;
    byCurrency: Record<string, number>;
  }>;

  @ApiProperty({
    description:
      'Top subscription plans (all-time revenue; subscription_count = currently active PAYING subscribers on the plan, free plan excluded). `total_revenue` is null when the plan has revenue in several currencies. Ranked by revenue when all plans share one currency, otherwise by transaction count.',
    example: [
      {
        plan: 'yearly',
        subscription_count: 60,
        total_revenue: 6000,
        byCurrency: { USD: 6000 },
        transactions: 125,
      },
    ],
  })
  topPlans: Array<{
    plan: string;
    subscription_count: number;
    total_revenue: number | null;
    byCurrency: Record<string, number>;
    transactions: number;
  }>;
}

export class UserDetailDto {
  @ApiProperty({ description: 'User ID', example: 'user-123' })
  id: string;

  @ApiProperty({ description: 'User email', example: 'parent@example.com' })
  email: string;

  @ApiProperty({ description: 'User name', example: 'John Doe' })
  name: string | null;

  @ApiProperty({ description: 'User title', example: 'Mr' })
  title: string | null;

  @ApiProperty({ description: 'User role', example: 'parent' })
  role: string;

  @ApiProperty({ description: 'Email verification status', example: true })
  isEmailVerified: boolean;

  @ApiProperty({ description: 'Deletion status', example: false })
  isDeleted: boolean;

  @ApiProperty({
    description: 'Creation timestamp',
    example: '2023-10-01T12:00:00Z',
  })
  createdAt: Date;

  @ApiProperty({
    description: 'Last update timestamp',
    example: '2023-10-15T10:30:00Z',
  })
  updatedAt: Date;

  @ApiProperty({ description: 'Paid user status', example: true })
  isPaidUser: boolean;

  @ApiProperty({
    description:
      "Total spent across succeeded transactions. A number only when all of the user's transactions share one currency (0 when none); null when they span several currencies (never summed across currencies - see spendingByCurrency).",
    example: 125.5,
    nullable: true,
    type: Number,
  })
  amountSpent: number | null;

  @ApiProperty({
    description: 'Currency of amount spent',
    example: 'USD',
    nullable: true,
  })
  currency: string | null;

  @ApiProperty({
    description: 'User profile',
    example: {
      id: 'profile-123',
      explicitContent: false,
      maxScreenTimeMins: 120,
      language: 'english',
      country: 'US',
      createdAt: '2023-10-01T12:00:00Z',
      updatedAt: '2023-10-15T10:30:00Z',
    },
  })
  profile: ProfileInfo | null;

  @ApiProperty({
    description: 'User kids',
    example: [
      {
        id: 'kid-123',
        name: 'Emma Doe',
        ageRange: '6-8',
        createdAt: '2023-10-05T12:00:00Z',
        avatar: {
          id: 'avatar-456',
          name: 'Kid Avatar',
          url: 'https://example.com/kid-avatar.png',
        },
      },
    ],
  })
  kids: KidInfo[];

  @ApiProperty({
    description: 'User avatar',
    example: {
      id: 'avatar-123',
      name: 'Default Avatar',
      url: 'https://example.com/avatar.png',
      isSystemAvatar: true,
      publicId: 'avatar_123',
      createdAt: '2023-10-01T12:00:00Z',
    },
  })
  avatar: AvatarInfo | null;

  @ApiProperty({
    description: 'User subscription',
    nullable: true,
    example: {
      id: 'sub-123',
      plan: 'monthly',
      status: 'active',
      startedAt: '2023-10-01T12:00:00Z',
      endsAt: '2023-11-01T12:00:00Z',
    },
  })
  subscription: SubscriptionInfo | null;

  @ApiProperty({
    description: 'Payment transactions',
    example: [
      {
        id: 'txn-123',
        amount: 9.99,
        currency: 'USD',
        status: 'success',
        createdAt: '2023-10-01T12:00:00Z',
      },
    ],
  })
  paymentTransactions: PaymentTransactionInfo[];

  @ApiProperty({
    description: 'User statistics',
    example: {
      sessionsCount: 5,
      favoritesCount: 12,
      voicesCount: 1,
      subscriptionsCount: 1,
      ticketsCount: 2,
      transactionsCount: 3,
    },
  })
  stats: {
    sessionsCount: number;
    favoritesCount: number;
    voicesCount: number;
    subscriptionsCount: number;
    ticketsCount: number;
    transactionsCount: number;
  };
}

export class StoryDetailDto {
  @ApiProperty({ description: 'Story ID', example: 'story-123' })
  id: string;

  @ApiProperty({ description: 'Story title', example: 'The Magic Forest' })
  title: string;

  @ApiProperty({
    description: 'Story description',
    example: 'A magical adventure in an enchanted forest',
  })
  description: string;

  @ApiProperty({ description: 'Story language', example: 'english' })
  language: string;

  @ApiProperty({
    description: 'Cover image URL',
    example: 'https://example.com/forest.jpg',
  })
  coverImageUrl: string;

  @ApiProperty({
    description: 'Audio URL',
    example: 'https://example.com/forest.mp3',
    required: false,
  })
  audioUrl?: string | null;

  @ApiProperty({
    description: 'Text content',
    example: 'Once upon a time in a magical forest...',
    required: false,
  })
  textContent?: string | null;

  @ApiProperty({ description: 'Is interactive story', example: true })
  isInteractive: boolean;

  @ApiProperty({ description: 'Minimum age', example: 3 })
  ageMin: number;

  @ApiProperty({ description: 'Maximum age', example: 8 })
  ageMax: number;

  @ApiProperty({ description: 'Background color', example: '#5E3A54' })
  backgroundColor: string;

  @ApiProperty({ description: 'Is recommended story', example: true })
  recommended: boolean;

  @ApiProperty({ description: 'Is AI generated', example: false })
  aiGenerated: boolean;

  @ApiProperty({ example: true })
  isPublished: boolean;

  @ApiProperty({ description: 'Difficulty level', example: 1 })
  difficultyLevel: number;

  @ApiProperty({ description: 'Word count', example: 500 })
  wordCount: number;

  @ApiProperty({ description: 'Deletion status', example: false })
  isDeleted: boolean;

  @ApiProperty({
    description: 'Creation timestamp',
    example: '2023-10-01T12:00:00Z',
  })
  createdAt: Date;

  @ApiProperty({
    description: 'Last update timestamp',
    example: '2023-10-15T10:30:00Z',
  })
  updatedAt: Date;

  @ApiProperty({
    description: 'Story images',
    example: [
      {
        id: 'img-123',
        url: 'https://example.com/forest-1.jpg',
        caption: 'The enchanted forest entrance',
      },
    ],
  })
  images: StoryImageInfo[];

  @ApiProperty({
    description: 'Story categories',
    example: [{ id: 'cat-1', name: 'Fantasy & Magic' }],
  })
  categories: CategoryInfo[];

  @ApiProperty({
    description: 'Story themes',
    example: [{ id: 'theme-1', name: 'Adventure' }],
  })
  themes: ThemeInfo[];

  @ApiProperty({
    description: 'Story branches',
    example: [
      {
        id: 'branch-1',
        prompt: 'Which path will you take?',
        optionA: 'Take the left path',
        optionB: 'Take the right path',
        nextA: 'story-124',
        nextB: 'story-125',
      },
    ],
  })
  branches: StoryBranchInfo[];

  @ApiProperty({
    description: 'Story questions',
    example: [
      {
        id: 'question-1',
        question: "What was the main character's name?",
        options: ['Alice', 'Bob', 'Charlie', 'Diana'],
        correctOption: 0,
      },
    ],
  })
  questions: StoryQuestionInfo[];

  @ApiProperty({
    description: 'Story statistics',
    example: {
      favoritesCount: 45,
      viewsCount: 120,
      parentFavoritesCount: 15,
      downloadsCount: 30,
    },
  })
  stats: {
    favoritesCount: number;
    viewsCount: number;
    parentFavoritesCount: number;
    downloadsCount: number;
  };
}

export class CategoryDto {
  @ApiProperty({ description: 'Category ID', example: 'cat-1' })
  id: string;

  @ApiProperty({ description: 'Category name', example: 'Animal Stories' })
  name: string;

  @ApiProperty({
    description: 'Category image URL',
    example: 'https://example.com/animals.jpg',
    required: false,
  })
  image?: string | null;

  @ApiProperty({
    description: 'Category description',
    example: 'Stories featuring animals as main characters',
    required: false,
  })
  description?: string | null;

  @ApiProperty({ description: 'Deletion status', example: false })
  isDeleted: boolean;

  @ApiProperty({
    description: 'Deletion timestamp',
    example: null,
    required: false,
  })
  deletedAt?: Date | null;

  @ApiProperty({
    description: 'Category statistics',
    example: {
      stories: 80,
      preferredByKids: 45,
    },
  })
  _count: {
    stories: number;
    preferredByKids: number;
  };
}

export class ThemeDto {
  @ApiProperty({ description: 'Theme ID', example: 'theme-1' })
  id: string;

  @ApiProperty({ description: 'Theme name', example: 'Adventure' })
  name: string;

  @ApiProperty({
    description: 'Theme image URL',
    example: 'https://example.com/adventure.jpg',
    required: false,
  })
  image?: string | null;

  @ApiProperty({
    description: 'Theme description',
    example: 'Themes of adventure and exploration',
    required: false,
  })
  description?: string | null;

  @ApiProperty({ description: 'Deletion status', example: false })
  isDeleted: boolean;

  @ApiProperty({
    description: 'Deletion timestamp',
    example: null,
    required: false,
  })
  deletedAt?: Date | null;

  @ApiProperty({
    description: 'Theme statistics',
    example: {
      stories: 120,
    },
  })
  _count: {
    stories: number;
  };
}

export class SubscriptionDto {
  @ApiProperty({ description: 'Subscription ID', example: 'sub-123' })
  id: string;

  @ApiProperty({ description: 'Subscription plan', example: 'monthly' })
  plan: string;

  @ApiProperty({ description: 'Subscription status', example: 'active' })
  status: string;

  @ApiProperty({
    description: 'Subscription start timestamp',
    example: '2023-10-01T12:00:00Z',
  })
  startedAt: Date;

  @ApiProperty({
    description: 'Subscription end timestamp',
    example: '2023-11-01T12:00:00Z',
    required: false,
  })
  endsAt?: Date | null;

  @ApiProperty({ description: 'Deletion status', example: false })
  isDeleted: boolean;

  @ApiProperty({
    description: 'Deletion timestamp',
    example: null,
    required: false,
  })
  deletedAt?: Date | null;

  @ApiProperty({
    description: 'Subscription user',
    example: {
      id: 'user-123',
      email: 'parent@example.com',
      name: 'John Doe',
    },
  })
  user: UserBasicInfo;

  @ApiProperty({
    description:
      'How the access was obtained: store (real purchase), admin_grant, coupon or trial. Only store rows are paying customers.',
    enum: ['store', 'admin_grant', 'coupon', 'trial'],
    example: 'store',
  })
  source: string;

  @ApiProperty({
    description: 'True when source is not store (complimentary access)',
    example: false,
  })
  isComplimentary: boolean;

  @ApiProperty({
    description: 'Admin user id who granted it (admin_grant only)',
    nullable: true,
    example: null,
  })
  grantedByAdminId: string | null;

  @ApiProperty({
    description: 'Name of the granting admin, when still resolvable',
    nullable: true,
    example: null,
  })
  grantedByAdminName: string | null;

  @ApiProperty({
    description: 'Reason given for the grant (admin_grant only)',
    nullable: true,
    example: null,
  })
  grantReason: string | null;
}

export class ActivityLogDto {
  @ApiProperty({ description: 'Activity log ID', example: 'log-123' })
  id: string;

  @ApiProperty({ description: 'User ID', example: 'user-123', required: false })
  userId?: string | null;

  @ApiProperty({ description: 'Kid ID', example: 'kid-123', required: false })
  kidId?: string | null;

  @ApiProperty({ description: 'Action type', example: 'USER_LOGIN' })
  action: string;

  @ApiProperty({ description: 'Action status', example: 'SUCCESS' })
  status: string;

  @ApiProperty({
    description: 'Device name',
    example: 'iPhone 13',
    required: false,
  })
  deviceName?: string | null;

  @ApiProperty({
    description: 'Device model',
    example: 'A2482',
    required: false,
  })
  deviceModel?: string | null;

  @ApiProperty({
    description: 'Operating system',
    example: 'iOS 17',
    required: false,
  })
  os?: string | null;

  @ApiProperty({
    description: 'IP address',
    example: '192.168.1.100',
    required: false,
  })
  ipAddress?: string | null;

  @ApiProperty({
    description: 'Action details',
    example: 'User logged in successfully',
    required: false,
  })
  details?: string | null;

  @ApiProperty({
    description: 'Creation timestamp',
    example: '2023-10-15T10:30:00Z',
  })
  createdAt: Date;

  @ApiProperty({ description: 'Deletion status', example: false })
  isDeleted: boolean;

  @ApiProperty({
    description: 'Deletion timestamp',
    example: null,
    required: false,
  })
  deletedAt?: Date | null;

  @ApiProperty({
    description: 'User information',
    example: {
      id: 'user-123',
      email: 'parent@example.com',
      name: 'John Doe',
    },
    required: false,
  })
  user?: Record<string, unknown> | null;

  @ApiProperty({
    description: 'Kid information',
    example: {
      id: 'kid-123',
      name: 'Emma Doe',
    },
    required: false,
  })
  kid?: Record<string, unknown> | null;
}

export class AiCreditAnalyticsDto {
  yearly: {
    label: string;
    month: string;
    elevenLabs: number;
    gemini: number;
    total: number;
  }[];
}

export class UserGrowthMonthlyDto {
  @ApiProperty({ example: ['Jan', 'Feb', 'Mar'] })
  labels: string[];

  @ApiProperty({
    description: 'Users per bucket with no active subscription',
    example: [100, 120, 150],
  })
  freeUsers: number[];

  @ApiProperty({
    description: 'PAYING users per bucket (active, source=store)',
    example: [20, 30, 40],
  })
  paidUsers: number[];

  @ApiProperty({
    description:
      'Users per bucket with active COMPLIMENTARY access (non-store source). freeUsers + paidUsers + complimentaryUsers = all users in the bucket.',
    example: [1, 0, 2],
  })
  complimentaryUsers: number[];
}

// User list item for paginated user listing - extended from base user fields
export class UserListItemDto {
  @ApiProperty({ example: 'user-123' })
  id: string;

  @ApiProperty({ example: 'parent@example.com' })
  email: string;

  @ApiProperty({ example: 'John Doe', nullable: true })
  name: string | null;

  @ApiProperty({ example: 'parent' })
  role: string;

  @ApiProperty({ example: true })
  isEmailVerified: boolean;

  @ApiProperty({ example: false })
  isDeleted: boolean;

  @ApiProperty({ example: '2023-10-01T12:00:00Z' })
  createdAt: Date;

  @ApiProperty({ example: '2023-10-15T10:30:00Z' })
  updatedAt: Date;

  @ApiProperty({ example: null, required: false, nullable: true })
  deletedAt?: Date | null;

  @ApiProperty({ example: '2023-10-01T12:00:00Z' })
  registrationDate: Date;

  @ApiProperty({ example: 30 })
  activityLength: number;

  @ApiProperty({ example: 50 })
  creditUsed: number;

  @ApiProperty({
    example: 100.0,
    nullable: true,
    type: Number,
    description:
      'Single-currency total, or null when the user paid in several currencies (see spendingByCurrency).',
  })
  amountSpent: number | null;

  @ApiProperty({ example: true })
  isPaidUser: boolean;

  @ApiProperty({ type: () => SubscriptionInfo, nullable: true })
  activeSubscription: Partial<SubscriptionInfo> | null;

  @ApiProperty({ example: 2 })
  kidsCount: number;

  @ApiProperty({ example: 10 })
  sessionsCount: number;

  @ApiProperty({ example: 5 })
  favoritesCount: number;

  @ApiProperty({ example: 1 })
  subscriptionsCount: number;

  @ApiProperty({ example: 1 })
  transactionsCount: number;

  @ApiProperty({ type: () => ProfileInfo, nullable: true })
  profile?: ProfileInfo | null;

  @ApiProperty({ type: () => AvatarInfo, nullable: true })
  avatar?: AvatarInfo | null;

  [key: string]: unknown;
}

// Story list item for paginated story listing
export class StoryListItemDto {
  @ApiProperty({ example: 'story-123' })
  id: string;

  @ApiProperty({ example: 'The Brave Little Tailor' })
  title: string;

  @ApiProperty({ example: 'A classic fairy tale of wit and bravery.' })
  description: string;

  @ApiProperty({ example: 'en' })
  language: string;

  @ApiProperty({ example: 'https://example.com/cover.png' })
  coverImageUrl: string;

  @ApiProperty({ example: null, required: false, nullable: true })
  audioUrl?: string | null;

  @ApiProperty({ example: true })
  isInteractive: boolean;

  @ApiProperty({ example: 3 })
  ageMin: number;

  @ApiProperty({ example: 8 })
  ageMax: number;

  @ApiProperty({ example: '#F0F0F0' })
  backgroundColor: string;

  @ApiProperty({ example: true })
  recommended: boolean;

  @ApiProperty({ example: false })
  aiGenerated: boolean;

  @ApiProperty({ example: true })
  isPublished: boolean;

  @ApiProperty({ example: 2 })
  difficultyLevel: number;

  @ApiProperty({ example: 1200 })
  wordCount: number;

  @ApiProperty({ example: false })
  isDeleted: boolean;

  @ApiProperty({ example: '2023-10-01T12:00:00Z' })
  createdAt: Date;

  @ApiProperty({ example: '2023-10-15T10:30:00Z' })
  updatedAt: Date;

  @ApiProperty({ type: [CategoryInfo] })
  categories: CategoryInfo[];

  @ApiProperty({ type: [ThemeInfo] })
  themes: ThemeInfo[];

  @ApiProperty({ example: 150 })
  favoritesCount: number;

  @ApiProperty({ example: 1200 })
  viewsCount: number;

  @ApiProperty({ example: 45 })
  parentFavoritesCount: number;

  @ApiProperty({ example: 85 })
  downloadsCount: number;

  [key: string]: unknown;
}

// Admin creation response
export class AdminCreatedDto {
  @ApiProperty({ example: 'admin-123' })
  id: string;

  @ApiProperty({ example: 'admin@storytime.com' })
  email: string;

  @ApiProperty({ example: 'Super Admin', nullable: true })
  name: string | null;

  @ApiProperty({ example: 'admin' })
  role: string;

  @ApiProperty({ example: '2023-10-01T12:00:00Z' })
  createdAt: Date;
}

// User update response
export class UserUpdatedDto {
  @ApiProperty({ example: 'user-123' })
  id: string;

  @ApiProperty({ example: 'updated@example.com' })
  email: string;

  @ApiProperty({ example: 'Updated Name', nullable: true })
  name: string | null;

  @ApiProperty({ example: 'parent' })
  role: string;

  @ApiProperty({ example: true })
  isEmailVerified: boolean;

  @ApiProperty({ example: '2023-10-15T10:30:00Z' })
  updatedAt: Date;
}

// Story toggle/update response
export class StoryActionResultDto {
  @ApiProperty({ example: 'story-123' })
  id: string;

  @ApiProperty({ example: 'The Brave Little Tailor' })
  title: string;

  @ApiProperty({ example: true })
  recommended: boolean;

  @ApiProperty({ example: false })
  isDeleted: boolean;

  @ApiProperty({ example: null, nullable: true })
  deletedAt: Date | null;

  @ApiProperty({ example: '2023-10-15T10:30:00Z' })
  updatedAt: Date;
}

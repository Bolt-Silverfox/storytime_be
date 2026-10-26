import { applyDecorators } from '@nestjs/common';
import {
  ApiOperation,
  ApiOkResponse,
  ApiQuery,
  ApiBearerAuth,
} from '@nestjs/swagger';

export function ApiAdminGetDashboardStats() {
  return applyDecorators(
    ApiBearerAuth(),
    ApiOperation({
      summary: 'Get dashboard metrics',
      description:
        'Returns comprehensive platform KPIs including users, stories, subscriptions, and revenue statistics.',
    }),
    ApiOkResponse({
      description: 'Dashboard metrics retrieved successfully',
      schema: {
        example: {
          statusCode: 200,
          message: 'Dashboard metrics retrieved successfully',
          data: {
            totalUsers: 1250,
            totalParents: 800,
            totalKids: 450,
            totalAdmins: 5,
            totalStories: 325,
            totalCategories: 20,
            totalThemes: 18,
            activeUsers24h: 120,
            activeUsers7d: 350,
            newUsersToday: 15,
            newUsersThisWeek: 85,
            newUsersThisMonth: 220,
            totalStoryViews: 12500,
            totalFavorites: 2300,
            averageSessionTime: 15,
            paidUsers: 180,
            unpaidUsers: 1070,
            totalSubscriptions: 200,
            activeSubscriptions: 180,
            subscriptionPlans: [
              { plan: 'monthly', count: 120 },
              { plan: 'yearly', count: 60 },
              { plan: 'family', count: 20 },
            ],
            baseCurrency: 'USD',
            totalRevenue: 12500.5,
            mixedCurrencies: false,
            revenueByCurrency: [
              { currency: 'USD', total: 12500.5, transactions: 240 },
            ],
            convertedRevenueByCurrency: [
              {
                currency: 'USD',
                total: 12500.5,
                transactions: 240,
                usdTotal: 12500.5,
                rateUsed: 1,
              },
            ],
            unconvertedCurrencies: [],
            hasUnconvertedRevenue: false,
            usedEarliestRate: false,
            conversionRate: 14.4,
          },
        },
      },
    }),
  );
}

export function ApiAdminGetUserGrowth() {
  return applyDecorators(
    ApiBearerAuth(),
    ApiOperation({
      summary: 'Get user growth analytics',
      description:
        'Returns day-by-day user growth statistics with paid/unpaid breakdown between optional startDate/endDate.',
    }),
    ApiQuery({
      name: 'startDate',
      required: false,
      type: String,
      description:
        'Start date for analytics (ISO format, default: 30 days ago)',
      example: '2023-10-01',
    }),
    ApiQuery({
      name: 'endDate',
      required: false,
      type: String,
      description: 'End date for analytics (ISO format, default: today)',
      example: '2023-10-31',
    }),
    ApiOkResponse({
      description: 'User growth analytics retrieved successfully',
      schema: {
        example: {
          statusCode: 200,
          message: 'User growth analytics retrieved successfully',
          data: [
            {
              date: '2023-10-01',
              newUsers: 10,
              paidUsers: 2,
              totalUsers: 1000,
              totalPaidUsers: 150,
            },
            {
              date: '2023-10-02',
              newUsers: 8,
              paidUsers: 1,
              totalUsers: 1008,
              totalPaidUsers: 151,
            },
          ],
        },
      },
    }),
  );
}

export function ApiAdminGetSubscriptionAnalytics() {
  return applyDecorators(
    ApiBearerAuth(),
    ApiOperation({
      summary: 'Get subscription analytics',
      description:
        'Returns detailed subscription metrics including growth, revenue, plan breakdown, and churn rate.',
    }),
    ApiQuery({
      name: 'startDate',
      required: false,
      type: String,
      description:
        'Start date for analytics (ISO format, default: 30 days ago)',
      example: '2023-10-01',
    }),
    ApiQuery({
      name: 'endDate',
      required: false,
      type: String,
      description: 'End date for analytics (ISO format, default: today)',
      example: '2023-10-31',
    }),
    ApiOkResponse({
      description: 'Subscription analytics retrieved successfully',
      schema: {
        example: {
          statusCode: 200,
          message: 'Subscription analytics retrieved successfully',
          data: {
            subscriptionGrowth: [
              { date: '2023-10-01', count: 5 },
              { date: '2023-10-02', count: 3 },
            ],
            revenueGrowth: [
              { date: '2023-10-01', amount: 500, byCurrency: { USD: 500 } },
              {
                date: '2023-10-02',
                amount: 21.25,
                byCurrency: { NGN: 25000, USD: 5 },
              },
            ],
            planBreakdown: [
              { plan: 'monthly', count: 120 },
              { plan: 'yearly', count: 60 },
              { plan: 'family', count: 20 },
            ],
            churnRate: 2.5,
          },
        },
      },
    }),
  );
}

export function ApiAdminGetRevenueAnalytics() {
  return applyDecorators(
    ApiBearerAuth(),
    ApiOperation({
      summary: 'Get revenue analytics',
      description:
        "Returns detailed revenue breakdown by day, month, year, and top subscription plans, all in USD (`baseCurrency`). Each succeeded transaction is converted at the admin-managed FX rate (POST /admin/fx-rates) effective on its own date: the latest rate with effectiveFrom <= the transaction date; if the transaction predates the earliest rate, that earliest rate is used and `usedEarliestRate` is true. A currency with NO rate is never guessed: it is excluded from every converted figure and listed in `unconvertedCurrencies` (`hasUnconvertedRevenue`). `totalRevenue` and each series amount (`dailyRevenue[].amount`, `monthlyRevenue[].total_amount`, `yearlyRevenue[].total_amount`, `topPlans[].total_revenue`) are converted USD numbers (0 when empty); `revenueByCurrency` and each point's `byCurrency` keep the ORIGINAL per-currency amounts, `convertedRevenueByCurrency` shows each currency's usdTotal and latest rate used, and a point's `unconvertedByCurrency` lists amounts excluded for lack of a rate. `mixedCurrencies` is informational. `topPlans` is all-time, ranked by converted revenue; `subscription_count` counts active PAYING subscribers (free plan excluded).",
    }),
    ApiQuery({
      name: 'startDate',
      required: false,
      type: String,
      description:
        'Start date for analytics (ISO format, default: 30 days ago)',
      example: '2023-10-01',
    }),
    ApiQuery({
      name: 'endDate',
      required: false,
      type: String,
      description: 'End date for analytics (ISO format, default: today)',
      example: '2023-10-31',
    }),
    ApiOkResponse({
      description: 'Revenue analytics retrieved successfully',
      schema: {
        example: {
          statusCode: 200,
          message: 'Revenue analytics retrieved successfully',
          data: {
            baseCurrency: 'USD',
            totalRevenue: 72.48,
            mixedCurrencies: true,
            revenueByCurrency: [
              { currency: 'NGN', total: 30000, transactions: 6 },
              { currency: 'USD', total: 52.98, transactions: 3 },
            ],
            convertedRevenueByCurrency: [
              {
                currency: 'USD',
                total: 52.98,
                transactions: 3,
                usdTotal: 52.98,
                rateUsed: 1,
              },
              {
                currency: 'NGN',
                total: 30000,
                transactions: 6,
                usdTotal: 19.5,
                rateUsed: 0.00065,
              },
            ],
            unconvertedCurrencies: [],
            hasUnconvertedRevenue: false,
            usedEarliestRate: false,
            dailyRevenue: [
              { date: '2023-10-01', amount: 16.25, byCurrency: { NGN: 25000 } },
              {
                date: '2023-10-02',
                amount: 56.23,
                byCurrency: { NGN: 5000, USD: 52.98 },
              },
            ],
            monthlyRevenue: [
              {
                month: '2023-10',
                total_amount: 72.48,
                byCurrency: { NGN: 30000, USD: 52.98 },
              },
            ],
            yearlyRevenue: [
              {
                year: '2023',
                total_amount: 72.48,
                byCurrency: { NGN: 30000, USD: 52.98 },
              },
            ],
            topPlans: [
              {
                plan: 'yearly',
                subscription_count: 60,
                total_revenue: 52.98,
                byCurrency: { USD: 52.98 },
                transactions: 3,
              },
              {
                plan: 'monthly',
                subscription_count: 120,
                total_revenue: 19.5,
                byCurrency: { NGN: 30000 },
                transactions: 6,
              },
            ],
          },
        },
      },
    }),
  );
}

export function ApiAdminGetStoryStats() {
  return applyDecorators(
    ApiBearerAuth(),
    ApiOperation({
      summary: 'Get story statistics',
      description:
        'Returns comprehensive story metrics including counts, AI-generated stories, recommendations, and engagement.',
    }),
    ApiOkResponse({
      description: 'Story statistics retrieved successfully',
      schema: {
        example: {
          statusCode: 200,
          message: 'Story statistics retrieved successfully',
          data: {
            totalStories: 325,
            publishedStories: 325,
            draftStories: 0,
            aiGeneratedStories: 150,
            recommendedStories: 75,
            deletedStories: 15,
            totalViews: 12500,
            totalFavorites: 2300,
          },
        },
      },
    }),
  );
}

export function ApiAdminGetContentBreakdown() {
  return applyDecorators(
    ApiBearerAuth(),
    ApiOperation({
      summary: 'Get content breakdown',
      description:
        'Returns content distribution by language, age group, category, and theme.',
    }),
    ApiOkResponse({
      description: 'Content breakdown retrieved successfully',
      schema: {
        example: {
          statusCode: 200,
          message: 'Content breakdown retrieved successfully',
          data: {
            byLanguage: [
              { language: 'English', count: 250 },
              { language: 'Spanish', count: 50 },
              { language: 'French', count: 25 },
            ],
            byAgeGroup: [
              { ageRange: '3-5', count: 100 },
              { ageRange: '6-8', count: 150 },
              { ageRange: '9-12', count: 75 },
            ],
            byCategory: [
              { categoryName: 'Animal Stories', count: 80 },
              { categoryName: 'Adventure & Action', count: 70 },
              { categoryName: 'Bedtime Stories', count: 60 },
            ],
            byTheme: [
              { themeName: 'Adventure', count: 120 },
              { themeName: 'Friendship', count: 90 },
              { themeName: 'Courage', count: 70 },
            ],
          },
        },
      },
    }),
  );
}

export function ApiAdminGetAiCreditStats() {
  return applyDecorators(
    ApiBearerAuth(),
    ApiOperation({
      summary: 'Get AI credit analytics',
      description:
        'Returns usage stats for AI services (ElevenLabs, Gemini), grouped by month for the current year',
    }),
    ApiOkResponse({
      description: 'AI credit analytics retrieved successfully',
    }),
  );
}

export function ApiAdminGetUserGrowthMonthly() {
  return applyDecorators(
    ApiBearerAuth(),
    ApiOperation({
      summary: 'Get monthly user growth (Free vs Paid)',
      description:
        'Returns user growth data for the last 12 months, split by subscription status',
    }),
    ApiOkResponse({
      description: 'User growth data retrieved successfully',
    }),
  );
}

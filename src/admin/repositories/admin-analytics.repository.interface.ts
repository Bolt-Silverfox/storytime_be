import { DateRangeDto } from '../dto/admin-filters.dto';
import {
    DashboardStatsDto,
    UserGrowthDto,
    StoryStatsDto,
    ContentBreakdownDto,
    SubscriptionAnalyticsDto,
    RevenueAnalyticsDto,
    AiCreditAnalyticsDto,
    UserGrowthMonthlyDto,
} from '../dto/admin-responses.dto';

export interface IAdminAnalyticsRepository {
    // Statistics
    getDashboardStats(): Promise<DashboardStatsDto>;
    getUserGrowth(dateRange: DateRangeDto): Promise<UserGrowthDto[]>;
    getStoryStats(): Promise<StoryStatsDto>;
    getContentBreakdown(): Promise<ContentBreakdownDto>;

    // Advanced Analytics
    getSubscriptionAnalytics(dateRange?: DateRangeDto): Promise<SubscriptionAnalyticsDto>;
    getRevenueAnalytics(dateRange?: DateRangeDto): Promise<RevenueAnalyticsDto>;
    getAiCreditAnalytics(): Promise<AiCreditAnalyticsDto>;
    getUserGrowthMonthly(): Promise<{ data: UserGrowthMonthlyDto[] }>;
}

export const ADMIN_ANALYTICS_REPOSITORY = Symbol('ADMIN_ANALYTICS_REPOSITORY');

import { MetricWithTrendDto } from '../dto/admin-responses.dto';

export class DashboardUtil {
    static calculateTrend(
        current: number,
        previous: number,
        timeframe: string
    ): MetricWithTrendDto {
        if (previous === 0) {
            return {
                value: current,
                trend: current > 0 ? 100 : 0,
                direction: current > 0 ? 'up' : 'neutral',
                timeframe
            };
        }
        const trend = parseFloat((((current - previous) / previous) * 100).toFixed(1));
        return {
            value: current,
            trend,
            direction: trend > 0 ? 'up' : trend < 0 ? 'down' : 'neutral',
            timeframe
        };
    }
}

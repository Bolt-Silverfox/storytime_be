import { Timeframe, ONE_DAY_MS, ONE_WEEK_MS, THIRTY_DAYS_MS } from '../constants/time.constants';

export interface DateRange {
    start: Date;
    end: Date;
}

export class DateUtil {
    static getRange(timeframe: Timeframe, now: Date = new Date()): DateRange {
        const end = new Date(now);
        let start = new Date(now);

        switch (timeframe) {
            case Timeframe.LAST_24_HOURS:
                start = new Date(now.getTime() - ONE_DAY_MS);
                break;
            case Timeframe.LAST_48_HOURS:
                start = new Date(now.getTime() - (ONE_DAY_MS * 2));
                break;
            case Timeframe.LAST_7_DAYS:
                start = new Date(now.getTime() - ONE_WEEK_MS);
                break;
            case Timeframe.LAST_14_DAYS:
                start = new Date(now.getTime() - (ONE_WEEK_MS * 2));
                break;
            case Timeframe.LAST_30_DAYS:
                start = new Date(now.getTime() - THIRTY_DAYS_MS);
                break;
            case Timeframe.PREVIOUS_30_DAYS:
                // 60 days ago to 30 days ago
                end.setTime(now.getTime() - THIRTY_DAYS_MS);
                start.setTime(now.getTime() - (THIRTY_DAYS_MS * 2));
                break;
            case Timeframe.TODAY:
                start.setHours(0, 0, 0, 0);
                break;
            case Timeframe.YESTERDAY:
                end.setHours(0, 0, 0, 0);
                start.setTime(end.getTime() - ONE_DAY_MS);
                break;
            case Timeframe.THIS_WEEK:
                start = new Date(now.getTime() - now.getDay() * ONE_DAY_MS);
                start.setHours(0, 0, 0, 0);
                break;
            case Timeframe.THIS_MONTH:
                start = new Date(now.getFullYear(), now.getMonth(), 1);
                break;
            case Timeframe.LAST_MONTH:
                start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
                end.setDate(0);
                end.setHours(23, 59, 59, 999);
                break;
        }
        return { start, end };
    }

    static getPreviousPeriod(currentRange: DateRange): DateRange {
        const duration = currentRange.end.getTime() - currentRange.start.getTime();
        const end = new Date(currentRange.start);
        const start = new Date(end.getTime() - duration);
        return { start, end };
    }
}

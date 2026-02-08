export const MILLISECONDS_IN_SECOND = 1000;
export const SECONDS_IN_MINUTE = 60;
export const MINUTES_IN_HOUR = 60;
export const HOURS_IN_DAY = 24;

export const ONE_SECOND_MS = MILLISECONDS_IN_SECOND;
export const ONE_MINUTE_MS = ONE_SECOND_MS * SECONDS_IN_MINUTE;
export const ONE_HOUR_MS = ONE_MINUTE_MS * MINUTES_IN_HOUR;
export const ONE_DAY_MS = ONE_HOUR_MS * HOURS_IN_DAY;
export const ONE_WEEK_MS = ONE_DAY_MS * 7;
export const THIRTY_DAYS_MS = ONE_DAY_MS * 30;

export enum Timeframe {
  LAST_24_HOURS = 'LAST_24_HOURS',
  LAST_48_HOURS = 'LAST_48_HOURS',
  LAST_7_DAYS = 'LAST_7_DAYS',
  LAST_14_DAYS = 'LAST_14_DAYS',
  LAST_30_DAYS = 'LAST_30_DAYS',
  PREVIOUS_30_DAYS = 'PREVIOUS_30_DAYS',
  TODAY = 'TODAY',
  YESTERDAY = 'YESTERDAY',
  THIS_WEEK = 'THIS_WEEK',
  THIS_MONTH = 'THIS_MONTH',
  LAST_MONTH = 'LAST_MONTH',
}

export enum TrendLabel {
  VS_PREV_24H = 'vs previous 24h',
  VS_PREV_7D = 'vs previous 7 days',
  VS_PREV_30D = 'vs previous 30 days',
  VS_LAST_MONTH = 'vs last month',
  VS_YESTERDAY = 'vs yesterday',
}

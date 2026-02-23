/**
 * Shared date formatting utilities.
 * Replaces duplicate getCurrentMonth() methods across quota services.
 */
export class DateFormatUtil {
  /** Returns "YYYY-MM" format for the current month */
  static getCurrentMonthString(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }

  /** Returns "MM-DD" format */
  static getMMDDString(date: Date = new Date()): string {
    const month = date.getMonth() + 1;
    const day = date.getDate();
    return `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
}

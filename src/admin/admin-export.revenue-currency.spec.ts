import { AdminExportService } from './admin-export.service';

describe('AdminExportService revenue CSV with mixed currencies', () => {
  const analytics = {
    getRevenueAnalytics: jest.fn(),
    getSubscriptionAnalytics: jest.fn(),
  };
  const service = new AdminExportService({} as never, analytics as never);

  it('leaves Amount blank for a mixed day and lists each currency in its own column', async () => {
    analytics.getRevenueAnalytics.mockResolvedValue({
      dailyRevenue: [
        { date: '2026-10-01', amount: 5, byCurrency: { USD: 5 } },
        {
          date: '2026-10-02',
          amount: null,
          byCurrency: { NGN: 25000, USD: 5 },
        },
      ],
    });
    const { data } = await service.exportAnalyticsData('revenue', 'csv');
    const lines = String(data).split('\n');
    expect(lines[0]).toBe('Date,Amount,Currency Breakdown');
    expect(lines[1]).toBe('2026-10-01,5,USD:5');
    expect(lines[2]).toBe('2026-10-02,,NGN:25000;USD:5');
  });
});

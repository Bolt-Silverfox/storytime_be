import { AdminExportService } from './admin-export.service';

describe('AdminExportService CSV exports use the converted USD figures', () => {
  const analytics = {
    getRevenueAnalytics: jest.fn(),
    getSubscriptionAnalytics: jest.fn(),
  };
  const users = { getAllUsers: jest.fn() };
  const service = new AdminExportService(users as never, analytics as never);

  it('revenue CSV: Amount is the USD-converted day total; original currencies and unconverted listed in their own columns', async () => {
    analytics.getRevenueAnalytics.mockResolvedValue({
      baseCurrency: 'USD',
      dailyRevenue: [
        { date: '2026-10-01', amount: 5, byCurrency: { USD: 5 } },
        {
          date: '2026-10-02',
          amount: 21.25,
          byCurrency: { NGN: 25000, USD: 5 },
        },
        {
          date: '2026-10-03',
          amount: 5,
          byCurrency: { GHS: 40, USD: 5 },
          unconvertedByCurrency: { GHS: 40 },
        },
      ],
    });
    const { data } = await service.exportAnalyticsData('revenue', 'csv');
    const lines = String(data).split('\n');
    expect(lines[0]).toBe(
      'Date,Amount,Currency Breakdown,Base Currency,Unconverted Breakdown',
    );
    expect(lines[1]).toBe('2026-10-01,5,USD:5,USD,');
    expect(lines[2]).toBe('2026-10-02,21.25,NGN:25000;USD:5,USD,');
    expect(lines[3]).toBe('2026-10-03,5,GHS:40;USD:5,USD,GHS:40');
  });

  it('revenue JSON export is the same analytics payload', async () => {
    const payload = {
      baseCurrency: 'USD',
      totalRevenue: 12.92,
      dailyRevenue: [],
    };
    analytics.getRevenueAnalytics.mockResolvedValue(payload);
    const { data } = await service.exportAnalyticsData('revenue', 'json');
    expect(data).toBe(payload);
  });

  it('users CSV appends the USD-converted amount spent from the same user service', async () => {
    users.getAllUsers.mockResolvedValue({
      data: [
        {
          id: 'u1',
          email: 'a@b.c',
          name: 'A',
          role: 'parent',
          isEmailVerified: true,
          isPaidUser: true,
          activeSubscription: { plan: 'monthly' },
          registrationDate: new Date('2026-01-01T00:00:00Z'),
          isDeleted: false,
          isSuspended: false,
          isComplimentary: false,
          amountSpent: 12.92,
          currency: 'USD',
        },
      ],
    });
    const csv = await service.exportUsersAsCsv({});
    const [header, row] = csv.split('\n');
    expect(header.endsWith(',Is Complimentary,Amount Spent (USD)')).toBe(true);
    expect(row.endsWith(',false,12.92')).toBe(true);
  });
});

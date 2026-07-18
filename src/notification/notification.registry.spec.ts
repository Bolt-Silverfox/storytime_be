import { NotificationRegistry } from './notification.registry';

describe('NotificationRegistry — PaymentSuccess', () => {
  const entry = NotificationRegistry.PaymentSuccess;

  it('requires a currency field', () => {
    expect(entry.validate({ amount: 4.99, plan: 'Monthly' })).toBe(
      'Currency is required',
    );
  });

  it('passes validation when currency is present', () => {
    expect(
      entry.validate({ amount: 4.99, currency: 'USD', plan: 'Monthly' }),
    ).toBeNull();
  });

  it('renders the currency alongside the amount', async () => {
    const message = await entry.getTemplate({
      amount: 4.99,
      currency: 'EUR',
      plan: 'Monthly',
    });
    expect(message).toContain('EUR');
    expect(message).toContain('4.99');
    expect(message).toContain('Monthly');
  });
});

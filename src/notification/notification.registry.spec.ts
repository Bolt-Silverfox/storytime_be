import { NotificationRegistry } from './notification.registry';

jest.mock('@react-email/tailwind', () => ({
  Tailwind: ({ children }: { children: unknown }) => children,
}));

jest.mock('@react-email/render', () => ({
  render: (element: unknown) =>
    jest
      .requireActual<typeof import('react-dom/server')>('react-dom/server')
      .renderToStaticMarkup(element as never),
}));

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

describe('NotificationRegistry — PasswordlessLogin', () => {
  const entry = NotificationRegistry.PasswordlessLogin;
  const data = {
    email: 'a@example.com',
    code: '482913',
    linkUrl: 'https://app.test/auth/magic#t=abcDEF_-123',
  };

  it('requires email, code and link url', () => {
    expect(entry.validate({ ...data, email: '' })).toBe('Email is required');
    expect(entry.validate({ ...data, code: '' })).toBe('Code is required');
    expect(entry.validate({ ...data, linkUrl: '' })).toBe(
      'Link URL is required',
    );
    expect(entry.validate(data)).toBeNull();
  });

  it('keeps the code out of the subject', () => {
    expect(entry.subject).not.toMatch(/\d/);
  });

  it('renders the code, the fragment link and the safety text', async () => {
    const html = await entry.getTemplate(data);
    expect(html).toContain('482913');
    expect(html).toContain('https://app.test/auth/magic#t=abcDEF_-123');
    expect(html).toMatch(/only (for|on) the Storytime/i);
    expect(html).toMatch(/ignore this email/i);
    expect(html).toContain('10 minutes');
  });

  it('is sent by email', () => {
    expect(entry.medium).toBe('email');
  });
});

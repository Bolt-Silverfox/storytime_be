import { Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { EmailProvider } from './email.provider';

jest.mock('nodemailer');

describe('EmailProvider logging', () => {
  const recipient = 'secret.person@example.com';

  it('does not write the recipient address to the logs', async () => {
    const sendMail = jest.fn().mockResolvedValue({ messageId: 'm-1' });
    (nodemailer.createTransport as jest.Mock).mockReturnValue({ sendMail });
    const spies = (['log', 'warn', 'error', 'debug'] as const).map((m) =>
      jest.spyOn(Logger.prototype, m).mockImplementation(),
    );
    const provider = new EmailProvider({ get: () => undefined } as never);

    const result = await provider.send({
      title: 'Hi',
      body: '<p>Hi</p>',
      data: { email: recipient },
    } as never);

    expect(result.success).toBe(true);
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: recipient }),
    );
    const logged = JSON.stringify(spies.flatMap((s) => s.mock.calls));
    expect(logged).not.toContain('secret.person');
    expect(logged).toContain('@example.com');
    jest.restoreAllMocks();
  });
});

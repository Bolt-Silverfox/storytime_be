import { once } from 'node:events';
import * as net from 'node:net';
import { HealthIndicatorService } from '@nestjs/terminus';
import { ConfigService } from '@nestjs/config';
import { SmtpHealthIndicator } from './smtp.health';

describe('SmtpHealthIndicator over a real SMTP socket', () => {
  let server: net.Server;
  let indicator: SmtpHealthIndicator;
  const accepted: net.Socket[] = [];

  const startServer = async (
    reply: (line: string, socket: net.Socket) => void,
  ) => {
    server = net.createServer((socket) => {
      accepted.push(socket);
      socket.write('220 test ESMTP\r\n');
      let buffered = '';
      socket.on('data', (chunk) => {
        buffered += chunk.toString();
        let end: number;
        while ((end = buffered.indexOf('\r\n')) !== -1) {
          reply(buffered.slice(0, end), socket);
          buffered = buffered.slice(end + 2);
        }
      });
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    return (server.address() as net.AddressInfo).port;
  };

  const indicatorFor = (port: number) => {
    const config: Record<string, unknown> = {
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: port,
      SMTP_SECURE: false,
      SMTP_USER: 'user',
      SMTP_PASS: 'pass',
    };
    indicator = new SmtpHealthIndicator(new HealthIndicatorService(), {
      get: (k: string) => config[k],
    } as unknown as ConfigService<never, true>);
    return indicator;
  };

  afterEach(async () => {
    indicator.onModuleDestroy();
    jest.useRealTimers();
    accepted.splice(0).forEach((s) => s.destroy());
    if (server?.listening) {
      server.close();
      await once(server, 'close');
    }
  });

  it('reports up after EHLO and AUTH succeed', async () => {
    const port = await startServer((line, socket) => {
      if (line.startsWith('EHLO'))
        socket.write('250-test\r\n250 AUTH PLAIN\r\n');
      else if (line.startsWith('AUTH')) socket.write('235 ok\r\n');
      else if (line === 'QUIT') socket.end('221 bye\r\n');
    });

    const result = await indicatorFor(port).isHealthy('smtp');

    expect(result.smtp.status).toBe('up');
  });

  it('reports down with the server error when AUTH is rejected', async () => {
    const port = await startServer((line, socket) => {
      if (line.startsWith('EHLO'))
        socket.write('250-test\r\n250 AUTH PLAIN\r\n');
      else if (line.startsWith('AUTH')) socket.write('535 bad credentials\r\n');
    });

    const result = await indicatorFor(port).isHealthy('smtp');

    expect(result.smtp).toEqual(
      expect.objectContaining({
        status: 'down',
        error: expect.stringContaining('535 bad credentials'),
      }),
    );
  });

  it('reports down when nothing listens on the port', async () => {
    const port = await startServer(() => undefined);
    server.close();
    await once(server, 'close');

    const result = await indicatorFor(port).isHealthy('smtp');

    expect(result.smtp).toEqual(
      expect.objectContaining({
        status: 'down',
        error: expect.stringContaining('ECONNREFUSED'),
      }),
    );
  });

  it('closes the SMTP connection when the probe deadline expires', async () => {
    jest.useFakeTimers({
      doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'],
    });
    let onEhlo: () => void = () => undefined;
    const ehloReceived = new Promise<void>((resolve) => (onEhlo = resolve));
    const port = await startServer((line) => {
      if (line.startsWith('EHLO')) onEhlo();
    });

    const result = indicatorFor(port).isHealthy('smtp');
    await ehloReceived;
    const closed = once(accepted[0], 'close');

    await jest.advanceTimersByTimeAsync(15_000);

    expect((await result).smtp.status).toBe('down');
    await closed;
  });
});

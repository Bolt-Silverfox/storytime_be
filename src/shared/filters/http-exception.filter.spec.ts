import { ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { HttpExceptionFilter } from './http-exception.filter';

jest.mock('../../sentry-setup', () => ({ captureException: jest.fn() }));

/**
 * These cover two defects that used to live in this filter. Both matter more than
 * their size suggests, because a filter is the last thing that can handle an
 * error: when it throws, Nest falls back to its own handler and the client gets a
 * generic 500 instead of the real status, with the original error lost.
 */
describe('HttpExceptionFilter', () => {
  let filter: HttpExceptionFilter;
  let json: jest.Mock;
  let status: jest.Mock;
  let host: ArgumentsHost;

  beforeEach(() => {
    filter = new HttpExceptionFilter();
    json = jest.fn();
    status = jest.fn().mockReturnValue({ json });
    host = {
      switchToHttp: () => ({
        getResponse: () => ({ status }),
        getRequest: () => ({ method: 'GET', url: '/api/v1/thing' }),
      }),
    } as unknown as ArgumentsHost;
    jest.spyOn(filter['logger'], 'warn').mockImplementation(() => undefined);
    jest.spyOn(filter['logger'], 'error').mockImplementation(() => undefined);
  });

  const body = () => json.mock.calls[0][0];

  it('names a status that IS in the HttpStatus enum', () => {
    filter.catch(new HttpException('nope', HttpStatus.BAD_REQUEST), host);
    expect(body().error).toBe('Bad Request');
    expect(body().message).toBe('nope');
  });

  // Was: `HttpStatus[499]` is undefined, so `.toString()` threw a TypeError
  // INSIDE the filter. These three are genuinely absent from Nest's enum —
  // verified against @nestjs/common rather than assumed. 499 is Nginx's
  // client-closed-request and 52x are Cloudflare's, so all are reachable from a
  // proxy in front of this service. (418 is NOT a valid case here: it IS in the
  // enum as I_AM_A_TEAPOT. An earlier version of this test asserted otherwise and
  // failed, which is the test doing its job.)
  it.each([499, 520, 599])(
    'does not throw for status %i, which is absent from the HttpStatus enum',
    (statusCode) => {
      expect(() =>
        filter.catch(new HttpException('upstream said no', statusCode), host),
      ).not.toThrow();
      expect(status).toHaveBeenCalledWith(statusCode);
      expect(body().error).toBe(`HTTP ${statusCode}`);
      expect(typeof body().error).toBe('string');
    },
  );

  // Was: `resObj.message || 'An error occurred.'` — an empty array is TRUTHY, so
  // `message: []` reached the client as `[]`, i.e. no message at all.
  it('falls back to a real message when the response carries an empty array', () => {
    filter.catch(
      new HttpException(
        { message: [], statusCode: 400 },
        HttpStatus.BAD_REQUEST,
      ),
      host,
    );
    expect(body().message).toBe('An error occurred.');
  });

  it('keeps a non-empty message array, which is the validation-pipe shape', () => {
    filter.catch(
      new HttpException(
        { message: ['email must be an email'], statusCode: 400 },
        HttpStatus.BAD_REQUEST,
      ),
      host,
    );
    expect(body().message).toEqual(['email must be an email']);
  });

  // Was: `error = resObj.error || HttpStatus[statusCode]` assigned
  // `string | undefined` to a `string` field, so an unknown status put
  // `undefined` in the response body.
  it('never puts undefined in the error field for an unknown status', () => {
    filter.catch(
      new HttpException({ message: 'x', statusCode: 499 }, 499),
      host,
    );
    expect(body().error).toBe('HTTP 499');
  });

  it('still replaces the message on a 429', () => {
    filter.catch(
      new HttpException(
        'ThrottlerException: Too Many Requests',
        HttpStatus.TOO_MANY_REQUESTS,
      ),
      host,
    );
    expect(body().message).toBe(
      'Too many requests. Please wait a moment and try again.',
    );
  });

  it('strips a framework exception prefix from a plain string message', () => {
    filter.catch(
      new HttpException('SomeException: it broke', HttpStatus.BAD_REQUEST),
      host,
    );
    expect(body().message).toBe('it broke');
  });
});

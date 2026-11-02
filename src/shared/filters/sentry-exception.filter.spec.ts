import {
  ArgumentsHost,
  BadGatewayException,
  BadRequestException,
} from '@nestjs/common';
import { SentryExceptionFilter } from './sentry-exception.filter';
import { captureException } from '../../sentry-setup';

jest.mock('../../sentry-setup', () => ({ captureException: jest.fn() }));

describe('SentryExceptionFilter', () => {
  let filter: SentryExceptionFilter;
  const host = {} as ArgumentsHost;

  beforeEach(() => {
    jest.clearAllMocks();
    filter = new SentryExceptionFilter();
    // Delegation to Nest's default handler needs a real HTTP adapter; the
    // reporting decision is what is under test here.
    jest
      .spyOn(Object.getPrototypeOf(SentryExceptionFilter.prototype), 'catch')
      .mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  const httpError = (status: number, message: string, type?: string) =>
    Object.assign(new Error(message), {
      status,
      statusCode: status,
      expose: true,
      type,
    });

  it('does not report a client-aborted request (body-parser "request aborted")', () => {
    filter.catch(httpError(400, 'request aborted', 'request.aborted'), host);
    expect(captureException).not.toHaveBeenCalled();
  });

  it('does not report other client errors raised by http-errors (e.g. 413)', () => {
    filter.catch(httpError(413, 'request entity too large'), host);
    expect(captureException).not.toHaveBeenCalled();
  });

  it('still does not report Nest 4xx', () => {
    filter.catch(new BadRequestException('x'), host);
    expect(captureException).not.toHaveBeenCalled();
  });

  it('still reports Nest 5xx', () => {
    filter.catch(new BadGatewayException('x'), host);
    expect(captureException).toHaveBeenCalledTimes(1);
  });

  it('still reports errors that carry only .status (AxiosError, genai ApiError)', () => {
    filter.catch(Object.assign(new Error('Not Found'), { status: 404 }), host);
    filter.catch(
      Object.assign(new Error('x'), { statusCode: null, status: 404 }),
      host,
    );
    expect(captureException).toHaveBeenCalledTimes(2);
  });

  it('still reports a non-integer statusCode', () => {
    filter.catch(httpError(404.5, 'odd'), host);
    expect(captureException).toHaveBeenCalledTimes(1);
  });

  it('still reports http-errors 5xx and plain errors', () => {
    filter.catch(httpError(500, 'boom'), host);
    filter.catch(new Error('unexpected'), host);
    expect(captureException).toHaveBeenCalledTimes(2);
  });
});

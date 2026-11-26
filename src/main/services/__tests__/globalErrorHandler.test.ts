import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TelemetryService } from '../TelemetryService';
import { reportMainProcessError, installGlobalErrorHandlers } from '../globalErrorHandler';

describe('reportMainProcessError', () => {
  let captureException: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    captureException = vi
      .spyOn(TelemetryService, 'captureException')
      .mockImplementation(() => true);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => vi.restoreAllMocks());

  it('logs the error and reports it as an exception with its source', () => {
    const err = new TypeError('boom');
    reportMainProcessError('uncaughtException', err);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('[globalError] uncaughtException'),
      err,
    );
    expect(captureException).toHaveBeenCalledWith(err, {
      source: 'uncaughtException',
      severity: 'error',
    });
  });

  it('coerces a non-Error rejection reason into an Error', () => {
    reportMainProcessError('unhandledRejection', 'plain string reason');
    const [err, props] = captureException.mock.calls[0]!;
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe('plain string reason');
    expect(props).toMatchObject({ source: 'unhandledRejection' });
  });
});

describe('installGlobalErrorHandlers', () => {
  afterEach(() => vi.restoreAllMocks());

  it('registers uncaughtException and unhandledRejection listeners, and is idempotent', () => {
    const on = vi.spyOn(process, 'on');
    installGlobalErrorHandlers();
    installGlobalErrorHandlers(); // second call must be a no-op

    const channels = on.mock.calls.map((c) => c[0]);
    expect(channels.filter((c) => c === 'uncaughtException')).toHaveLength(1);
    expect(channels.filter((c) => c === 'unhandledRejection')).toHaveLength(1);
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TelemetryService } from '../TelemetryService';
import {
  reportMainProcessError,
  installGlobalErrorHandlers,
  __resetErrorThrottleForTest,
} from '../globalErrorHandler';

describe('reportMainProcessError', () => {
  let capture: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    __resetErrorThrottleForTest();
    capture = vi.spyOn(TelemetryService, 'capture').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => vi.restoreAllMocks());

  it('logs and reports a $exception with sanitizable, PII-bounded props', () => {
    reportMainProcessError('uncaughtException', new TypeError('boom at /Users/x/secret'));

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('[globalError] uncaughtException'),
      expect.any(Error),
    );
    expect(capture).toHaveBeenCalledTimes(1);
    const [event, props] = capture.mock.calls[0]!;
    expect(event).toBe('$exception');
    expect(props).toMatchObject({
      $exception_type: 'TypeError',
      $exception_message: 'boom at /Users/x/secret',
      $exception_list: [{ type: 'TypeError', value: 'boom at /Users/x/secret' }],
      source: 'uncaughtException',
      severity: 'error',
    });
  });

  it('coerces a non-Error rejection reason into a reported Error', () => {
    reportMainProcessError('unhandledRejection', 'plain string reason');
    expect(capture).toHaveBeenCalledTimes(1);
    const props = capture.mock.calls[0]![1] as Record<string, unknown>;
    expect(props.$exception_message).toBe('plain string reason');
    expect(props.source).toBe('unhandledRejection');
  });

  it('throttles duplicate reports within the dedupe window', () => {
    const err = new Error('repeated');
    reportMainProcessError('uncaughtException', err);
    reportMainProcessError('uncaughtException', err);
    reportMainProcessError('uncaughtException', err);
    // Logged every time, but reported once.
    expect(console.error).toHaveBeenCalledTimes(3);
    expect(capture).toHaveBeenCalledTimes(1);
  });

  it('reports distinct errors separately', () => {
    reportMainProcessError('uncaughtException', new Error('one'));
    reportMainProcessError('uncaughtException', new Error('two'));
    expect(capture).toHaveBeenCalledTimes(2);
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

import { describe, it, expect, vi, afterEach } from 'vitest';
import { formatTokens, formatDuration, formatResetTime } from '../format';

describe('formatTokens', () => {
  it('returns raw number below 1000', () => {
    expect(formatTokens(0)).toBe('0');
    expect(formatTokens(999)).toBe('999');
  });

  it('formats thousands with one decimal when < 10k', () => {
    expect(formatTokens(1000)).toBe('1.0k');
    expect(formatTokens(1500)).toBe('1.5k');
    expect(formatTokens(9999)).toBe('10.0k');
  });

  it('formats thousands without decimal when >= 10k', () => {
    expect(formatTokens(10000)).toBe('10k');
    expect(formatTokens(50000)).toBe('50k');
    expect(formatTokens(999999)).toBe('1000k');
  });

  it('formats millions', () => {
    expect(formatTokens(1000000)).toBe('1.0m');
    expect(formatTokens(1500000)).toBe('1.5m');
    expect(formatTokens(2345678)).toBe('2.3m');
  });
});

describe('formatDuration', () => {
  it('formats seconds', () => {
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(59000)).toBe('59s');
  });

  it('formats minutes and seconds', () => {
    expect(formatDuration(60000)).toBe('1m 0s');
    expect(formatDuration(90000)).toBe('1m 30s');
    expect(formatDuration(3599000)).toBe('59m 59s');
  });

  it('formats hours and minutes', () => {
    expect(formatDuration(3600000)).toBe('1h 0m');
    expect(formatDuration(7261000)).toBe('2h 1m');
  });
});

describe('formatResetTime', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns empty string for 0', () => {
    expect(formatResetTime(0)).toBe('');
  });

  it('returns "now" for past timestamps', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2000000000000);
    expect(formatResetTime(1000000000)).toBe('now');
  });

  it('formats minutes for < 60 min', () => {
    const now = 1000000000000;
    vi.spyOn(Date, 'now').mockReturnValue(now);
    // 30 minutes from now in epoch seconds
    const future = now / 1000 + 30 * 60;
    expect(formatResetTime(future)).toBe('in 30m');
  });

  it('formats hours and minutes for < 24 hours', () => {
    const now = 1000000000000;
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const future = now / 1000 + 2 * 3600 + 15 * 60;
    expect(formatResetTime(future)).toBe('in 2h 15m');
  });

  it('formats days and hours for >= 24 hours', () => {
    const now = 1000000000000;
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const future = now / 1000 + 2 * 86400 + 3 * 3600;
    expect(formatResetTime(future)).toBe('in 2d 3h');
  });

  it('formats days without hours when remainder is 0', () => {
    const now = 1000000000000;
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const future = now / 1000 + 3 * 86400;
    expect(formatResetTime(future)).toBe('in 3d');
  });
});

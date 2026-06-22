import { describe, it, expect, vi, afterEach } from 'vitest';
import { formatTokens, formatCost, formatDuration, formatResetTime } from '../format';

describe('formatTokens', () => {
  it('formats <1000 as a plain integer', () => {
    expect(formatTokens(0)).toBe('0');
    expect(formatTokens(42)).toBe('42');
    expect(formatTokens(999)).toBe('999');
  });

  it('formats thousands with one decimal + k suffix', () => {
    expect(formatTokens(1_000)).toBe('1.0k');
    expect(formatTokens(12_345)).toBe('12.3k');
  });

  it('formats millions with one decimal + M suffix', () => {
    expect(formatTokens(1_000_000)).toBe('1.0M');
    expect(formatTokens(2_400_000)).toBe('2.4M');
    expect(formatTokens(18_000_000)).toBe('18.0M');
  });
});

describe('formatCost', () => {
  it('formats zero as "$0.00"', () => {
    expect(formatCost(0)).toBe('$0.00');
  });

  it('formats small amounts to 2 decimals', () => {
    expect(formatCost(0.123)).toBe('$0.12');
    expect(formatCost(4.32)).toBe('$4.32');
    expect(formatCost(63.1)).toBe('$63.10');
  });

  it('formats >=100 without cents', () => {
    expect(formatCost(123.45)).toBe('$123');
    expect(formatCost(1500)).toBe('$1500');
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
